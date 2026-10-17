import { describe, expect, it } from "vitest";

import {
  STUDY_GROUP_CAPACITY,
  STUDY_GROUP_DURATION_MS,
  studyGroupName,
  studyGroupTiming,
} from "@/lib/study-groups";

describe("study group sessions", () => {
  const now = new Date("2026-10-17T09:00:00.000Z");

  it("uses a fixed, student-safe focus label for the group name", () => {
    expect(studyGroupName("A1", "vocabulary")).toBe("A1 Vocabulary sprint");
    expect(STUDY_GROUP_CAPACITY).toBe(8);
  });

  it("starts immediately by default and expires after 90 minutes", () => {
    const timing = studyGroupTiming(undefined, now);
    expect(timing.ok).toBe(true);
    if (!timing.ok) return;
    expect(timing.startsAt).toEqual(now);
    expect(timing.expiresAt.getTime() - now.getTime()).toBe(STUDY_GROUP_DURATION_MS);
  });

  it("accepts a future schedule with minimum notice", () => {
    const timing = studyGroupTiming("2026-10-17T09:10:00.000Z", now);
    expect(timing.ok).toBe(true);
  });

  it("rejects invalid, too-soon, and over-a-week schedules", () => {
    expect(studyGroupTiming("not a date", now).ok).toBe(false);
    expect(studyGroupTiming("2026-10-17T09:04:00.000Z", now).ok).toBe(false);
    expect(studyGroupTiming("2026-10-25T09:00:01.000Z", now).ok).toBe(false);
  });
});
