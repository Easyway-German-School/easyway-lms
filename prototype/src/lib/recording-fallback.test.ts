import { describe, expect, it } from "vitest";
import { decideFallback, fallbackPolicy, liveKitMinutes, monthStartUtc, type FallbackPolicy } from "./recording-fallback";

describe("reading the fallback settings", () => {
  it("defaults to the original behaviour: fall back at once, no cap", () => {
    expect(fallbackPolicy({ RECORDING_BACKEND: "recorder" })).toEqual({ mode: "immediate", afterMinutes: 12, monthlyCapMinutes: null });
  });

  it("understands delayed, never, the wait and the cap", () => {
    expect(fallbackPolicy({ RECORDING_BACKEND: "recorder", RECORDER_FALLBACK: "Delayed", RECORDER_FALLBACK_AFTER_MINUTES: "8", RECORDER_FALLBACK_MONTHLY_CAP_MINUTES: "600" }))
      .toEqual({ mode: "delayed", afterMinutes: 8, monthlyCapMinutes: 600 });
    expect(fallbackPolicy({ RECORDER_FALLBACK: "never" }).mode).toBe("never");
  });

  it("recorder-only still means no LiveKit recording, whatever else is set", () => {
    expect(fallbackPolicy({ RECORDING_BACKEND: "recorder-only", RECORDER_FALLBACK: "immediate" }).mode).toBe("never");
  });

  it("ignores nonsense values instead of guessing", () => {
    expect(fallbackPolicy({ RECORDER_FALLBACK: "sometimes", RECORDER_FALLBACK_AFTER_MINUTES: "-3", RECORDER_FALLBACK_MONTHLY_CAP_MINUTES: "lots" }))
      .toEqual({ mode: "immediate", afterMinutes: 12, monthlyCapMinutes: null });
    expect(fallbackPolicy({ RECORDER_FALLBACK_AFTER_MINUTES: "9999" }).afterMinutes).toBe(120);
  });

  it("a cap of zero is a real setting (no LiveKit recording at all, but by budget)", () => {
    expect(fallbackPolicy({ RECORDER_FALLBACK_MONTHLY_CAP_MINUTES: "0" }).monthlyCapMinutes).toBe(0);
  });
});

describe("deciding whether to pay LiveKit", () => {
  const policy = (over: Partial<FallbackPolicy> = {}): FallbackPolicy => ({ mode: "immediate", afterMinutes: 12, monthlyCapMinutes: null, ...over });

  it("immediate: yes, straight away (the original behaviour)", () => {
    expect(decideFallback({ policy: policy(), classLiveMinutes: 0, liveKitMinutesThisMonth: 0 })).toEqual({ allow: true });
  });

  it("never: no, ever", () => {
    expect(decideFallback({ policy: policy({ mode: "never" }), classLiveMinutes: 90, liveKitMinutesThisMonth: 0 })).toMatchObject({ allow: false, reason: "policy-never" });
  });

  it("delayed: waits while the class is young, then allows", () => {
    const p = policy({ mode: "delayed" });
    expect(decideFallback({ policy: p, classLiveMinutes: 3, liveKitMinutesThisMonth: 0 })).toMatchObject({ allow: false, reason: "waiting" });
    expect(decideFallback({ policy: p, classLiveMinutes: 11.9, liveKitMinutesThisMonth: 0 })).toMatchObject({ allow: false, reason: "waiting" });
    expect(decideFallback({ policy: p, classLiveMinutes: 12, liveKitMinutesThisMonth: 0 })).toEqual({ allow: true });
  });

  it("delayed: a class of unknown age (a webinar) is not made to wait", () => {
    expect(decideFallback({ policy: policy({ mode: "delayed" }), classLiveMinutes: null, liveKitMinutesThisMonth: 0 })).toEqual({ allow: true });
  });

  it("the monthly budget stops LiveKit recording once used, in every mode", () => {
    for (const mode of ["immediate", "delayed"] as const) {
      const p = policy({ mode, monthlyCapMinutes: 600 });
      expect(decideFallback({ policy: p, classLiveMinutes: 60, liveKitMinutesThisMonth: 599 })).toEqual({ allow: true });
      expect(decideFallback({ policy: p, classLiveMinutes: 60, liveKitMinutesThisMonth: 600 })).toMatchObject({ allow: false, reason: "budget" });
    }
  });

  it("a zero budget never allows it", () => {
    expect(decideFallback({ policy: policy({ monthlyCapMinutes: 0 }), classLiveMinutes: 60, liveKitMinutesThisMonth: 0 })).toMatchObject({ allow: false, reason: "budget" });
  });
});

describe("counting LiveKit minutes this month", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  it("adds finished recordings by duration and a running one by how long it has run", () => {
    const rows = [
      { durationSeconds: 3600, startedAt: new Date("2026-10-02T09:00:00Z"), status: "completed" },
      { durationSeconds: 1800, startedAt: new Date("2026-10-03T09:00:00Z"), status: "completed" },
      { durationSeconds: null, startedAt: new Date("2026-10-15T11:30:00Z"), status: "active" },
    ];
    expect(liveKitMinutes(rows, now)).toBe(60 + 30 + 30);
  });
  it("ignores failed recordings with no duration", () => {
    expect(liveKitMinutes([{ durationSeconds: null, startedAt: new Date("2026-10-02T09:00:00Z"), status: "failed" }], now)).toBe(0);
  });
  it("the month starts on the 1st (UTC)", () => {
    expect(monthStartUtc(now).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});
