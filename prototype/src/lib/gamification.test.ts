import { describe, expect, it } from "vitest";

import {
  ATTENDANCE_XP_PER_SESSION,
  calculateAttendanceStreak,
  calculateXp,
  gradeRewardXp,
  XP_FLOOR,
} from "@/lib/gamification";

describe("learning journey rewards", () => {
  it("adds a score-based reward for each finalized grade", () => {
    expect(gradeRewardXp(0)).toBe(10);
    expect(gradeRewardXp(85)).toBe(19);
    expect(gradeRewardXp(120)).toBe(20);
    expect(calculateXp({ gradeXp: gradeRewardXp(85) })).toBe(XP_FLOOR + 19);
    expect(calculateXp({ averageGrade: 0, gradeXp: gradeRewardXp(0) })).toBe(XP_FLOOR + 10);
  });

  it("keeps attendance rewards aligned with the shared XP formula", () => {
    expect(calculateXp({ sessionsAttended: 2 })).toBe(XP_FLOOR + 2 * ATTENDANCE_XP_PER_SESSION);
  });

  it("counts consecutive attended sessions and ignores excused sessions", () => {
    const records = [
      { date: "2026-11-07", status: "present", present: true },
      { date: "2026-11-06", status: "excused", present: false },
      { date: "2026-11-05", status: "late", present: true },
      { date: "2026-11-04", status: "absent", present: false },
      { date: "2026-11-03", status: "present", present: true },
    ];

    expect(calculateAttendanceStreak(records)).toBe(2);
  });

  it("starts a new attendance streak after the latest recorded absence", () => {
    expect(
      calculateAttendanceStreak([
        { date: "2026-11-07", status: "absent", present: false },
        { date: "2026-11-06", status: "present", present: true },
      ]),
    ).toBe(0);
  });
});
