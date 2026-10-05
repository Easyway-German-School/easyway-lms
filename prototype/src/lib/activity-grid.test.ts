import { describe, expect, it } from "vitest";

import { buildActivityGrid, GRID_WEEKS } from "@/lib/activity-grid";

// Wednesday 7 October 2026, UTC.
const NOW = new Date("2026-10-07T10:00:00Z");

describe("buildActivityGrid", () => {
  it("is always a full 12 weeks of 7 days, ending on this week's Saturday", () => {
    const grid = buildActivityGrid([], NOW);
    expect(grid.weeks).toHaveLength(GRID_WEEKS);
    for (const week of grid.weeks) expect(week).toHaveLength(7);
    const last = grid.weeks[GRID_WEEKS - 1];
    expect(last[0].date).toBe("2026-10-04"); // Sunday
    expect(last[6].date).toBe("2026-10-10"); // Saturday
  });

  it("draws the rest of this week as future, not as missed days", () => {
    const last = buildActivityGrid([], NOW).weeks.at(-1)!;
    expect(last.map((c) => c.future)).toEqual([false, false, false, false, true, true, true]);
    expect(last.filter((c) => c.future).every((c) => c.count === 0)).toBe(true);
  });

  it("counts several actions on one day and raises the level", () => {
    const grid = buildActivityGrid(
      ["2026-10-06T08:00:00Z", "2026-10-06T12:00:00Z", "2026-10-06T23:59:00Z"],
      NOW,
    );
    const cell = grid.weeks.at(-1)!.find((c) => c.date === "2026-10-06")!;
    expect(cell.count).toBe(3);
    expect(cell.level).toBe(3);
    expect(grid.total).toBe(3);
    expect(grid.activeDays).toBe(1);
  });

  it("ignores events outside the window, in the future, or unreadable", () => {
    const grid = buildActivityGrid(
      ["2025-01-01", "2026-10-09T00:00:00Z", "garbage", null, undefined, "2026-10-05T09:00:00Z"],
      NOW,
    );
    expect(grid.total).toBe(1);
  });

  it("finds the longest run of consecutive active days", () => {
    const grid = buildActivityGrid(
      ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"],
      NOW,
    );
    expect(grid.longestRun).toBe(5);
    expect(grid.activeDays).toBe(8);
  });

  it("accepts Date objects as well as strings", () => {
    const grid = buildActivityGrid([new Date("2026-10-07T01:00:00Z")], NOW);
    expect(grid.total).toBe(1);
  });
});
