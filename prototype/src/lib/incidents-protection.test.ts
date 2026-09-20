import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  guardedPrisma: { incident: mocks },
}));

import { _resetThrottle, recordIncident } from "./incidents";
import { snapshotAll } from "./resilience";

/** Each call gets a different message, so the per-fingerprint throttle cannot be what stops the writes. */
const distinct = (n: number) => recordIncident({ kind: "error", source: "request", route: `/api/x${n}`, message: `boom ${"abcdefghij"[n % 10]}${n}x` });
const breaker = () => snapshotAll().find((s) => s.name === "incident-db");

describe("the incident recorder protects a failing database instead of piling onto it", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-20T10:00:00Z"));
    _resetThrottle();
    Object.values(mocks).forEach((m) => m.mockReset());
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("stops writing after a run of failures, then recovers by itself", async () => {
    mocks.updateMany.mockRejectedValue(new Error("Can't reach database server"));

    // Ten different errors arrive while the database is down.
    for (let i = 0; i < 10; i++) await distinct(i);

    // The breaker tripped at 4 failures; the other 6 never touched the database.
    expect(mocks.updateMany).toHaveBeenCalledTimes(4);
    expect(breaker()).toMatchObject({ state: "open", rejected: 6 });

    // Still inside the pause: still not touching the database.
    vi.advanceTimersByTime(29_000);
    await distinct(20);
    expect(mocks.updateMany).toHaveBeenCalledTimes(4);

    // The pause ends and the database is back: ONE probe goes through and recording resumes.
    vi.advanceTimersByTime(2_000);
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findUnique.mockResolvedValue(null);
    mocks.create.mockResolvedValue({});
    await distinct(30);

    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(breaker()).toMatchObject({ state: "closed", consecutiveFailures: 0 });
  });

  it("never throws into the request that hit the error, however the database behaves", async () => {
    mocks.updateMany.mockRejectedValue(new Error("boom"));
    await expect(distinct(50)).resolves.toBeUndefined();
  });
});
