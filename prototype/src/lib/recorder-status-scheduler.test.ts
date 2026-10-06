import { describe, expect, it } from "vitest";
import type { SchedulerBeat } from "./recorder-control";
import { buildRecorderStatus } from "./recorder-status";

const now = new Date("2026-10-05T09:00:00Z");
const policy = { mode: "delayed" as const, afterMinutes: 12, monthlyCapMinutes: 600 };
const base = { mode: "recorder" as const, fleet: true, now, policy, liveKitMinutesThisMonth: 0, ownRecordings: 0, liveKitRecordings: 0 };
const dir = { version: 1 as const, updatedAt: new Date(now.getTime() - 30_000).toISOString(), servers: [{ id: "s1", url: "https://x", capacity: 5, active: 0 }] };
const soon = { liveNow: 0, buckets: [{ start: "2026-10-05T10:00:00Z", end: "2026-10-05T12:00:00Z", classes: 4 }] };
const quiet = { liveNow: 0, buckets: [] };
const beat = (ageSeconds: number, over: Partial<SchedulerBeat> = {}): SchedulerBeat => ({
  at: new Date(now.getTime() - ageSeconds * 1000).toISOString(), role: "primary", holder: "p", acting: true, servers: 0, needSoon: 0, actions: 0, failed: 0, timetable: "", paused: false, notes: [], recent: [], ...over,
});
const ok = { ...base, directory: dir, forecast: soon };

describe("the scheduler and the office's controls, in the status", () => {
  it("a scheduler reporting every few minutes is healthy", () => {
    const s = buildRecorderStatus({ ...ok, beats: { primary: beat(120), standby: beat(100, { role: "standby", acting: false }) } });
    expect(s.health).toBe("ok");
    expect(s.scheduler).toMatchObject({ primaryAgeSeconds: 120, standbyActing: false, paused: false });
  });

  it("a silent scheduler with classes due is CRITICAL", () => {
    const s = buildRecorderStatus({ ...ok, beats: { primary: beat(900), standby: null } });
    expect(s.health).toBe("critical");
    expect(s.headline).toMatch(/stopped reporting/);
    expect(s.warnings[0]).toMatch(/15 minutes/);
  });

  it("a scheduler that has NEVER reported is critical when classes are due, and quiet when none are", () => {
    expect(buildRecorderStatus({ ...ok, beats: { primary: null, standby: null } }).health).toBe("critical");
    expect(buildRecorderStatus({ ...base, directory: dir, forecast: quiet, beats: { primary: null, standby: null } }).health).toBe("ok");
  });

  it("when no heartbeat information is passed at all, nothing is claimed about the scheduler", () => {
    expect(buildRecorderStatus({ ...ok }).health).toBe("ok");
  });

  it("the standby taking over is a warning, not an emergency", () => {
    const s = buildRecorderStatus({ ...ok, beats: { primary: beat(1500), standby: beat(60, { role: "standby", acting: true }) } });
    expect(s.health).toBe("warning");
    expect(s.scheduler.standbyActing).toBe(true);
    expect(s.warnings.join(" ")).toMatch(/standby scheduler has taken over/);
  });

  it("paused: a visible warning that says who and why", () => {
    const control = { version: 1 as const, updatedAt: now.toISOString(), updatedBy: "Mary", paused: true, pauseNote: "checking the bill", skipDates: [], boost: null, spareClasses: null, maxServers: null, stopAllAt: null };
    const s = buildRecorderStatus({ ...ok, beats: { primary: beat(60), standby: null }, control });
    expect(s.health).toBe("warning");
    expect(s.warnings.join(" ")).toMatch(/PAUSED \(by Mary\): checking the bill/);
  });

  it("merges both schedulers' logs, oldest first", () => {
    const s = buildRecorderStatus({
      ...ok,
      beats: {
        primary: beat(60, { recent: [{ at: "2026-10-05T08:00:00Z", text: "started a" }] }),
        standby: beat(60, { role: "standby", recent: [{ at: "2026-10-05T07:00:00Z", text: "took over" }] }),
      },
    });
    expect(s.scheduler.log.map((l) => l.text)).toEqual(["took over", "started a"]);
  });
});
