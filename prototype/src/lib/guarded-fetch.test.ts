import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Each test gets fresh breakers: they are module singletons, so re-import per test.
async function load() {
  vi.resetModules();
  return import("./guarded-fetch");
}
const res = (status: number, body = "{}") => new Response(body, { status });

describe("guardedFetch", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("is a plain fetch while the provider is healthy", async () => {
    const { guardedFetch } = await load();
    fetchMock.mockResolvedValue(res(200, '{"ok":true}'));
    const response = await guardedFetch("paystack", "https://api.paystack.co/x", { method: "POST" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
  });

  it("does NOT count a 4xx: a customer's bad input must never switch payments off", async () => {
    const { guardedFetch, isCircuitOpen } = await load();
    fetchMock.mockResolvedValue(res(400));
    for (let i = 0; i < 20; i++) expect((await guardedFetch("paystack", "https://p")).status).toBe(400);
    fetchMock.mockResolvedValue(res(200));
    // Still closed: this call goes through instead of being refused.
    await expect(guardedFetch("paystack", "https://p")).resolves.toBeInstanceOf(Response);
    expect(isCircuitOpen(undefined)).toBe(false);
  });

  it("counts 5xx, still hands the caller the response, and then fails fast without calling", async () => {
    const { guardedFetch, isCircuitOpen } = await load();
    // A fresh Response per call, like the real fetch — a body can only be read once.
    fetchMock.mockImplementation(() => Promise.resolve(res(503, "unavailable")));
    for (let i = 0; i < 4; i++) {
      const response = await guardedFetch("paystack", "https://p");
      expect(response.status).toBe(503); // callers keep their ordinary `!response.ok` handling
      expect(await response.text()).toBe("unavailable");
    }
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const refused = await guardedFetch("paystack", "https://p").catch((e) => e);
    expect(isCircuitOpen(refused)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4); // not even attempted
  });

  it("counts a 429 (throttled) but a 401 is the caller's problem", async () => {
    const { guardedFetch, isCircuitOpen } = await load();
    fetchMock.mockResolvedValue(res(401));
    for (let i = 0; i < 10; i++) await guardedFetch("groq", "https://g");
    fetchMock.mockResolvedValue(res(429));
    for (let i = 0; i < 5; i++) await guardedFetch("groq", "https://g");
    expect(isCircuitOpen(await guardedFetch("groq", "https://g").catch((e) => e))).toBe(true);
  });

  it("counts network errors and rethrows them as before", async () => {
    const { guardedFetch, isCircuitOpen } = await load();
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    for (let i = 0; i < 4; i++) await expect(guardedFetch("paystack", "https://p")).rejects.toThrow("fetch failed");
    expect(isCircuitOpen(await guardedFetch("paystack", "https://p").catch((e) => e))).toBe(true);
  });

  it("gives every call a deadline, so a HANG becomes a failure the breaker can count", async () => {
    const { guardedFetch } = await load();
    // A fetch that never answers on its own, but honours the abort signal like the real one.
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason))),
    );
    await expect(guardedFetch("paystack", "https://p", {}, { timeoutMs: 20 })).rejects.toBeTruthy();
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("still honours the caller's own cancel signal alongside the deadline", async () => {
    const { guardedFetch } = await load();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason))),
    );
    const controller = new AbortController();
    const pending = guardedFetch("openai", "https://o", { signal: controller.signal });
    controller.abort(new Error("caller gave up"));
    await expect(pending).rejects.toThrow("caller gave up");
  });

  it("keeps each provider's circuit separate: Groq being down does not stop payments", async () => {
    const { guardedFetch, isCircuitOpen } = await load();
    fetchMock.mockResolvedValue(res(503));
    for (let i = 0; i < 5; i++) await guardedFetch("groq", "https://g");
    expect(isCircuitOpen(await guardedFetch("groq", "https://g").catch((e) => e))).toBe(true);

    fetchMock.mockResolvedValue(res(200));
    expect((await guardedFetch("paystack", "https://p")).status).toBe(200);
  });

  it("closes again by itself once the provider is back (one probe after the pause)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-20T10:00:00Z"));
    const { guardedFetch, isCircuitOpen } = await load();
    fetchMock.mockResolvedValue(res(503));
    for (let i = 0; i < 4; i++) await guardedFetch("paystack", "https://p");
    expect(isCircuitOpen(await guardedFetch("paystack", "https://p").catch((e) => e))).toBe(true);

    vi.advanceTimersByTime(16_000);
    fetchMock.mockResolvedValue(res(200));
    expect((await guardedFetch("paystack", "https://p")).status).toBe(200);
    expect((await guardedFetch("paystack", "https://p")).status).toBe(200);
  });

  it("registers every provider's breaker so the console can show them at zero", async () => {
    await load();
    const { snapshotAll } = await import("./resilience");
    const names = snapshotAll().map((s) => s.name);
    for (const expected of ["ai-groq", "ai-anthropic", "ai-deepseek", "ai-openai", "paystack"]) expect(names).toContain(expected);
  });
});
