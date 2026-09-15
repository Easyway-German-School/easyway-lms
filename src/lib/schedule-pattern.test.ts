import { describe, it, expect } from "vitest";
import {
  parseSchedulePatternSettings,
  resolvePatternDays,
  emptySchedulePatternSettings,
  patternLabel,
} from "@/lib/schedule-pattern";
import { generatePersonalizedSchedule } from "@/lib/schedule";

describe("schedule-pattern", () => {
  it("falls back to the batch alternation when nothing is overridden", () => {
    expect(resolvePatternDays(null, "A1", "morning", 5)).toEqual([1, 5, 6]); // odd index → Mon/Fri/Sat
    expect(resolvePatternDays(null, "A1", "morning", 6)).toEqual([2, 3, 4]); // even index → Tue/Wed/Thu
    expect(resolvePatternDays(null, "A1", "weekend", 5)).toEqual([6]); // weekend ignores the alternation
  });

  it("an override replaces the default for that level+slot only", () => {
    const settings = parseSchedulePatternSettings(
      { levels: [{ level: "A1", grid: { morning: [1, 3, 5] } }] },
      { strict: true },
    );
    expect(settings).not.toBeNull();
    expect(resolvePatternDays(settings, "A1", "morning", 5)).toEqual([1, 3, 5]);
    // A different slot on the same level still falls back to the built-in default.
    expect(resolvePatternDays(settings, "A1", "evening", 5)).toEqual([1, 5, 6]);
    // A different level is untouched.
    expect(resolvePatternDays(settings, "A2", "morning", 5)).toEqual([1, 5, 6]);
  });

  it("rejects junk under strict parsing", () => {
    expect(parseSchedulePatternSettings({ levels: [{ level: "A1", grid: { morning: [] } }] }, { strict: true })).toBeNull();
    expect(parseSchedulePatternSettings({ levels: [{ level: "A1", grid: { morning: [1, 1, 5] } }] }, { strict: true })).toBeNull();
    expect(parseSchedulePatternSettings({ levels: [{ level: "ZZ", grid: {} }] }, { strict: true })).toBeNull();
    expect(parseSchedulePatternSettings("nonsense", { strict: true })).toBeNull();
  });

  it("silently drops junk under lenient (read-path) parsing instead of throwing", () => {
    expect(parseSchedulePatternSettings(undefined)).toEqual(emptySchedulePatternSettings());
    expect(parseSchedulePatternSettings({ levels: [{ level: "A1", grid: { morning: "nope" } }] })).toEqual({
      levels: [{ level: "A1", grid: {} }],
    });
  });

  it("patternLabel reads Mon-first regardless of stored order", () => {
    expect(patternLabel([6, 1, 5])).toBe("Mon · Fri · Sat");
    expect(patternLabel([])).toBe("—");
  });

  it("generatePersonalizedSchedule actually meets on the overridden days", () => {
    const settings = parseSchedulePatternSettings(
      { levels: [{ level: "A1", grid: { morning: [2, 4] } }] }, // Tue/Thu only
      { strict: true },
    );
    const schedule = generatePersonalizedSchedule({
      level: "A1",
      batch: "August",
      now: new Date("2026-08-01T00:00:00Z"),
      months: 1,
      sessionSlot: "morning",
      patternSettings: settings,
    });
    const weekdays = new Set(schedule.months[0].sessions.map((s) => s.weekday));
    expect(weekdays).toEqual(new Set(["Tue", "Thu"]));
  });
});
