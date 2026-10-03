import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJsonShared } from "./shared-fetch";

const jsonResponse = (body: unknown, ok = true) =>
  ({ ok, status: ok ? 200 : 500, json: async () => body }) as unknown as Response;

describe("fetchJsonShared", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends one request when two callers ask at the same moment", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ total: 3 }));
    const [a, b] = await Promise.all([fetchJsonShared("/a"), fetchJsonShared("/a")]);
    expect(a).toEqual({ total: 3 });
    expect(b).toEqual({ total: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks again once the answer is older than the window", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ total: 1 }));
    await fetchJsonShared("/b", { ttlMs: 5_000 });
    vi.advanceTimersByTime(5_001);
    await fetchJsonShared("/b", { ttlMs: 5_000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("goes to the network when forced, so a cleared badge clears now", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ total: 1 }));
    await fetchJsonShared("/c");
    await fetchJsonShared("/c", { force: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not serve a failure to the next caller", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, false));
    await expect(fetchJsonShared("/d")).rejects.toThrow();
    fetchMock.mockResolvedValueOnce(jsonResponse({ total: 9 }));
    await expect(fetchJsonShared("/d")).resolves.toEqual({ total: 9 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps different URLs apart", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    await Promise.all([fetchJsonShared("/e1"), fetchJsonShared("/e2")]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
