import { describe, expect, it, vi } from "vitest";

import {
  BACKOFF_MS,
  confirmSession,
  parseAuthReport,
  probeSession,
  reportPortalFromPath,
  severityForOutcome,
  type SessionProbe,
} from "./session-confirm";

const sequence = (...results: SessionProbe[]) => {
  const queue = [...results];
  return vi.fn(async () => queue.shift() ?? "unreachable");
};

const respond = (body: unknown, init: { ok?: boolean; json?: () => Promise<unknown> } = {}) =>
  vi.fn(async () => ({
    ok: init.ok ?? true,
    json: init.json ?? (async () => body),
  })) as unknown as typeof fetch;

describe("probeSession", () => {
  it("treats an answer carrying a user as alive", async () => {
    expect(await probeSession(respond({ user: { id: "u1" }, expires: "x" }))).toBe("alive");
  });

  it("treats an empty object as the server saying there is no session", async () => {
    expect(await probeSession(respond({}))).toBe("signed_out");
  });

  it("never reads a 5xx as 'signed out'", async () => {
    expect(await probeSession(respond({}, { ok: false }))).toBe("unreachable");
  });

  it("never reads a non-JSON gateway page as 'signed out'", async () => {
    const html = respond(null, {
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    });
    expect(await probeSession(html)).toBe("unreachable");
  });

  it("never reads a network failure as 'signed out'", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await probeSession(down)).toBe("unreachable");
  });

  it("gives up on a request that hangs", async () => {
    vi.useFakeTimers();
    try {
      const hang = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      ) as unknown as typeof fetch;
      const pending = probeSession(hang, 8_000);
      await vi.advanceTimersByTimeAsync(8_001);
      expect(await pending).toBe("unreachable");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("confirmSession", () => {
  it("a real 'no session' answer ends it at once, with no waiting", async () => {
    const sleep = vi.fn(async () => {});
    const out = await confirmSession({ probe: sequence("signed_out"), sleep });
    expect(out).toEqual({ verdict: "signed_out", attempts: 1 });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("a blip then a good answer is alive — the logout that used to happen", async () => {
    const sleep = vi.fn(async () => {});
    const out = await confirmSession({ probe: sequence("unreachable", "unreachable", "alive"), sleep });
    expect(out).toEqual({ verdict: "alive", attempts: 3 });
    expect(sleep.mock.calls.map((c) => (c as unknown as number[])[0])).toEqual([BACKOFF_MS[0], BACKOFF_MS[1]]);
  });

  it("a blip then a real 'no session' answer still signs out", async () => {
    const out = await confirmSession({ probe: sequence("unreachable", "signed_out"), sleep: async () => {} });
    expect(out).toEqual({ verdict: "signed_out", attempts: 2 });
  });

  it("stays unreachable (not signed out) when nothing ever answers", async () => {
    const out = await confirmSession({ probe: sequence(), sleep: async () => {} });
    expect(out).toEqual({ verdict: "unreachable", attempts: BACKOFF_MS.length + 1 });
  });

  it("stops asking once the page has moved on", async () => {
    let cancelled = false;
    const probe = vi.fn(async () => {
      cancelled = true;
      return "unreachable" as const;
    });
    const out = await confirmSession({ probe, sleep: async () => {}, cancelled: () => cancelled });
    expect(out.verdict).toBe("cancelled");
    expect(probe).toHaveBeenCalledTimes(1);
  });
});

describe("parseAuthReport", () => {
  const good = { outcome: "recovered", portal: "student", attempts: 3, online: true, hidden: false, onLivePage: true };

  it("accepts the exact shape the browser sends", () => {
    expect(parseAuthReport(good)).toEqual(good);
  });

  it("rejects an unknown outcome or portal rather than storing free text", () => {
    expect(parseAuthReport({ ...good, outcome: "<script>" })).toBeNull();
    expect(parseAuthReport({ ...good, portal: "root" })).toBeNull();
    expect(parseAuthReport(null)).toBeNull();
    expect(parseAuthReport("signed_out")).toBeNull();
  });

  it("clamps attempts so a forged number cannot be huge", () => {
    expect(parseAuthReport({ ...good, attempts: 1e9 })?.attempts).toBe(99);
    expect(parseAuthReport({ ...good, attempts: -5 })?.attempts).toBe(0);
    expect(parseAuthReport({ ...good, attempts: "NaN" })?.attempts).toBe(0);
  });
});

describe("severity and portal", () => {
  it("only a real unexpected sign-out is high", () => {
    expect(severityForOutcome("signed_out")).toBe("high");
    expect(severityForOutcome("unreachable")).toBe("medium");
    expect(severityForOutcome("recovered")).toBe("low");
  });

  it("names the portal from the path", () => {
    expect(reportPortalFromPath("/admin/live")).toBe("admin");
    expect(reportPortalFromPath("/lecturer/dashboard")).toBe("tutor");
    expect(reportPortalFromPath("/parent")).toBe("parent");
    expect(reportPortalFromPath("/live")).toBe("student");
    expect(reportPortalFromPath("/dashboard")).toBe("student");
  });
});
