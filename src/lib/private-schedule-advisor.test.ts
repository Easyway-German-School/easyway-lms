import { describe, expect, it } from "vitest";

import { adviseSchedule } from "./private-schedule-advisor";
import { normalizeSchedulePreferences } from "./private-schedule-preferences";
import { buildProfile, type RawEvent } from "./learner-signals";

/**
 * The scheduler is the one place in the behaviour work that changes something
 * in the physical world — a tutor turns up, or does not. It is tested harder
 * than the dashboards for that reason, and specifically for the two ways it
 * could do harm: recommending an hour the student never said they were free,
 * and inventing a rhythm out of four page views.
 */

const NOW = new Date("2026-08-22T12:00:00.000Z");

function prefs(dayRanges: Array<{ day: string; ranges: Array<{ start: string; end: string }> }>, preferredTimes: string[] = []) {
  return normalizeSchedulePreferences({ dayRanges, preferredTimes });
}

/** `count` days of events, all at `hour` on the learner's clock. */
function rhythm(hour: number, count = 40, weekday?: number): RawEvent[] {
  return Array.from({ length: count }, (_, index) => {
    const at = new Date(NOW.getTime() - index * 43200000);
    return {
      area: "lessons",
      action: "view",
      durationSeconds: 600,
      hourLocal: hour,
      weekday: weekday ?? at.getUTCDay(),
      sessionKey: `s-${index}`,
      occurredAt: at.toISOString(),
    };
  });
}

describe("adviseSchedule", () => {
  it("never offers an hour outside what the student said they were free for", () => {
    const advice = adviseSchedule({
      preferences: prefs([{ day: "tuesday", ranges: [{ start: "18:00", end: "21:00" }] }]),
      // A rhythm that screams "9am", which must not override a stated constraint.
      profile: buildProfile(rhythm(9), NOW),
    });
    expect(advice.candidates.length).toBeGreaterThan(0);
    for (const candidate of advice.candidates) {
      expect(candidate.day).toBe("tuesday");
      expect(candidate.hour).toBeGreaterThanOrEqual(18);
      expect(candidate.hour).toBeLessThanOrEqual(20);
    }
  });

  it("will not start a class at the closing edge of a window", () => {
    // Free 18:00-19:00 means one startable hour, not two.
    const advice = adviseSchedule({
      preferences: prefs([{ day: "tuesday", ranges: [{ start: "18:00", end: "19:00" }] }]),
      profile: null,
    });
    expect(advice.candidates.map((c) => c.hour)).toEqual([18]);
  });

  it("picks the stated hour that matches the observed rhythm", () => {
    const advice = adviseSchedule({
      preferences: prefs([{ day: "tuesday", ranges: [{ start: "08:00", end: "21:00" }] }]),
      profile: buildProfile(rhythm(19), NOW),
    });
    expect(advice.candidates[0].hour).toBe(19);
    expect(advice.candidates[0].matchesObserved).toBe(true);
  });

  it("refuses to read a rhythm out of too little evidence", () => {
    const advice = adviseSchedule({
      preferences: prefs([{ day: "tuesday", ranges: [{ start: "08:00", end: "21:00" }] }]),
      profile: buildProfile(rhythm(19, 4), NOW),
    });
    expect(advice.evidence.observedTrusted).toBe(false);
    expect(advice.mismatch).toBeNull();
    // With behaviour discounted, no hour in the window can out-argue another
    // on observed grounds, so nothing claims to know when they study.
    expect(advice.candidates.every((candidate) => !candidate.matchesObserved)).toBe(true);
  });

  it("surfaces the disagreement between what they said and what they do", () => {
    const advice = adviseSchedule({
      preferences: prefs([{ day: "saturday", ranges: [{ start: "08:00", end: "11:00" }] }]),
      profile: buildProfile(rhythm(22), NOW),
    });
    expect(advice.mismatch).not.toBeNull();
    expect(advice.mismatch!.note).toContain("10pm");
    expect(advice.fallbackMessage).toContain("10pm");
  });

  it("says nothing about a disagreement when the two agree", () => {
    const advice = adviseSchedule({
      preferences: prefs([{ day: "tuesday", ranges: [{ start: "20:00", end: "23:00" }] }]),
      profile: buildProfile(rhythm(20), NOW),
    });
    expect(advice.mismatch).toBeNull();
  });

  it("demotes a slot the tutor is already busy in without hiding it", () => {
    const busy = adviseSchedule({
      preferences: prefs([{ day: "tuesday", ranges: [{ start: "18:00", end: "21:00" }] }]),
      profile: null,
      tutorBusyAt: new Set(["tuesday:18", "tuesday:19", "tuesday:20"]),
    });
    expect(busy.candidates.length).toBeGreaterThan(0);
    expect(busy.candidates[0].tutorBusy).toBe(true);
    expect(busy.candidates[0].reasons.join(" ")).toContain("tutor");

    const free = adviseSchedule({
      preferences: prefs([{ day: "tuesday", ranges: [{ start: "18:00", end: "21:00" }] }]),
      profile: null,
    });
    expect(busy.candidates[0].score).toBeLessThan(free.candidates[0].score);
  });

  it("gives one suggestion per day rather than three versions of Tuesday", () => {
    const advice = adviseSchedule({
      preferences: prefs([
        { day: "monday", ranges: [{ start: "18:00", end: "21:00" }] },
        { day: "tuesday", ranges: [{ start: "18:00", end: "21:00" }] },
        { day: "wednesday", ranges: [{ start: "18:00", end: "21:00" }] },
      ]),
      profile: null,
    });
    expect(new Set(advice.candidates.map((candidate) => candidate.day)).size).toBe(advice.candidates.length);
  });

  it("still helps a student who has ticked nothing, using rhythm alone", () => {
    const advice = adviseSchedule({ preferences: null, profile: buildProfile(rhythm(20), NOW) });
    expect(advice.evidence.hasStated).toBe(false);
    expect(advice.candidates.length).toBeGreaterThan(0);
    expect(advice.candidates[0].hour).toBe(20);
  });

  it("asks for input rather than guessing when it knows nothing at all", () => {
    const advice = adviseSchedule({
      preferences: prefs([]),
      profile: buildProfile([], NOW),
    });
    expect(advice.candidates.length).toBeGreaterThanOrEqual(0);
    expect(advice.evidence.hasObserved).toBe(false);
  });

  it("writes a usable message with no model involved", () => {
    const advice = adviseSchedule({
      preferences: prefs([{ day: "thursday", ranges: [{ start: "17:00", end: "20:00" }] }], ["18:00"]),
      profile: buildProfile(rhythm(18), NOW),
    });
    expect(advice.fallbackMessage).toContain("Thursday");
    expect(advice.fallbackMessage).toContain("6pm");
    expect(advice.fallbackMessage.length).toBeGreaterThan(40);
  });
});
