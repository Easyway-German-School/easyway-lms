import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth/react", () => ({ useSession: vi.fn() }));

import { BACKOFF_MS } from "./session-confirm";
import { _internals, markIntentionalSignOut } from "./useConfirmedSession";

type Call = { url: string; body?: string };

/** A tiny browser: just what the episode runner touches. */
function installBrowser(sessionAnswers: Array<"alive" | "signed_out" | "down">) {
  const calls: Call[] = [];
  const queue = [...sessionAnswers];
  vi.stubGlobal("window", {
    location: { pathname: "/live", reload: vi.fn() },
  });
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("document", { hidden: false });
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: () => {} });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string | undefined });
      if (url === "/api/auth/session") {
        const next = queue.shift() ?? "down";
        if (next === "down") throw new TypeError("Failed to fetch");
        return { ok: true, json: async () => (next === "alive" ? { user: { id: "u1" } } : {}) };
      }
      return { ok: true, json: async () => ({}) };
    }),
  );
  return calls;
}

const reports = (calls: Call[]) =>
  calls.filter((c) => c.url === "/api/client/auth-report").map((c) => JSON.parse(c.body ?? "{}"));

describe("session episode", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _internals.reset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("a dropped request mid-class is recovered, not turned into a logout", async () => {
    const calls = installBrowser(["down", "down", "alive"]);
    _internals.setWasAuthenticated(true);
    const refresh = vi.fn(async () => ({ user: { id: "u1" } }));

    const done = _internals.runEpisode(refresh);
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0] + BACKOFF_MS[1] + 10);
    await done;

    expect(_internals.getPhase()).toBe("idle"); // never "signed_out"
    expect(refresh).toHaveBeenCalledTimes(1); // the client's copy was resynced
    expect(reports(calls)).toEqual([
      expect.objectContaining({ outcome: "recovered", attempts: 3, portal: "student", onLivePage: true }),
    ]);
  });

  it("an unexpected real sign-out is reported, and only after the server says so", async () => {
    const calls = installBrowser(["signed_out"]);
    _internals.setWasAuthenticated(true);

    await _internals.runEpisode(async () => null);

    expect(_internals.getPhase()).toBe("signed_out");
    expect(reports(calls)).toEqual([expect.objectContaining({ outcome: "signed_out", attempts: 1 })]);
  });

  it("pressing Sign out signs out without filing a fault", async () => {
    const calls = installBrowser(["signed_out"]);
    _internals.setWasAuthenticated(true);
    markIntentionalSignOut();

    await _internals.runEpisode(async () => null);

    expect(_internals.getPhase()).toBe("signed_out");
    expect(reports(calls)).toEqual([]);
  });

  it("a visitor who never had a session is sent to sign-in quietly", async () => {
    const calls = installBrowser(["signed_out"]);

    await _internals.runEpisode(async () => null);

    expect(_internals.getPhase()).toBe("signed_out");
    expect(reports(calls)).toEqual([]);
  });

  it("when nothing answers it stays put, says so once, and keeps asking", async () => {
    const calls = installBrowser(["down", "down", "down", "down", "down", "alive"]);
    _internals.setWasAuthenticated(true);
    const refresh = vi.fn(async () => ({ user: { id: "u1" } }));

    const done = _internals.runEpisode(refresh);
    await vi.advanceTimersByTimeAsync(BACKOFF_MS.reduce((a, b) => a + b, 0) + 10);
    expect(_internals.getPhase()).toBe("checking"); // not signed_out, not redirected
    expect(reports(calls).map((r) => r.outcome)).toEqual(["unreachable"]);

    await vi.advanceTimersByTimeAsync(30_000 + BACKOFF_MS[0] + 10);
    await done;

    expect(_internals.getPhase()).toBe("idle");
    expect(reports(calls).map((r) => r.outcome)).toEqual(["unreachable", "recovered"]);
  });
});
