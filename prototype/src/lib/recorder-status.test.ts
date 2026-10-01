import { describe, expect, it } from "vitest";
import { buildRecorderStatus } from "./recorder-status";

const now = new Date("2026-10-05T09:00:00Z");
const policy = { mode: "delayed" as const, afterMinutes: 12, monthlyCapMinutes: 600 };
const base = { mode: "recorder" as const, fleet: true, now, policy, liveKitMinutesThisMonth: 0, ownRecordings: 0, liveKitRecordings: 0 };
const dir = (ageSeconds: number, capacity = 5, active = 0) => ({
  version: 1 as const,
  updatedAt: new Date(now.getTime() - ageSeconds * 1000).toISOString(),
  servers: [{ id: "s1", url: "https://x", capacity, active }],
});
const soon = { liveNow: 0, buckets: [{ start: "2026-10-05T10:00:00Z", end: "2026-10-05T12:00:00Z", classes: 4 }] };
const quiet = { liveNow: 0, buckets: [] };

describe("recorder status", () => {
  it("healthy: a fresh server list", () => {
    const s = buildRecorderStatus({ ...base, directory: dir(30), forecast: soon });
    expect(s.health).toBe("ok");
    expect(s.forecast).toEqual({ liveNow: 0, peakNext24h: 4, nextClassAt: "2026-10-05T10:00:00Z" });
    expect(s.warnings).toEqual([]);
  });

  it("no server and nothing due is normal, not an alarm", () => {
    const s = buildRecorderStatus({ ...base, directory: null, forecast: quiet });
    expect(s.health).toBe("idle");
    expect(s.warnings).toEqual([]);
  });

  it("no server while a class is due is a warning; while one is live it is critical", () => {
    expect(buildRecorderStatus({ ...base, directory: null, forecast: soon }).health).toBe("warning");
    expect(buildRecorderStatus({ ...base, directory: null, forecast: { ...soon, liveNow: 1 } }).health).toBe("critical");
  });

  it("more live classes than capacity is critical", () => {
    const s = buildRecorderStatus({ ...base, directory: dir(30, 2), forecast: { ...soon, liveNow: 3 } });
    expect(s.health).toBe("critical");
    expect(s.headline).toMatch(/3 classes are live.*only 2/);
  });

  it("a stale server list warns", () => {
    const s = buildRecorderStatus({ ...base, directory: dir(400), forecast: soon });
    expect(s.health).toBe("warning");
    expect(s.warnings[0]).toMatch(/7 minutes old/);
  });

  it("the LiveKit budget: cost estimate, and a warning once it is used up", () => {
    const s = buildRecorderStatus({ ...base, directory: dir(30), forecast: soon, liveKitMinutesThisMonth: 600 });
    expect(s.fallback.estimatedCostUsd).toBe(12);
    expect(s.health).toBe("warning");
    expect(s.warnings.join(" ")).toMatch(/budget for this month is used up/);
  });

  it("tells the admins about the costly settings", () => {
    const open = buildRecorderStatus({ ...base, directory: dir(30), forecast: soon, policy: { mode: "immediate", afterMinutes: 12, monthlyCapMinutes: null } });
    expect(open.warnings.join(" ")).toMatch(/starts at once/);
    expect(open.warnings.join(" ")).toMatch(/no monthly cap/);
  });

  it("recorder switched off says so", () => {
    expect(buildRecorderStatus({ ...base, mode: "livekit", directory: null, forecast: soon }).health).toBe("off");
  });
});
