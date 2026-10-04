/**
 * THE STUDY GRID — a GitHub-style "contributions" picture of the last weeks.
 *
 * One square per day, one column per week, darker the more the student did.
 * It counts anything a student actively did that left a dated record: a class
 * attended, homework handed in, a daily mission or quest done, a live quiz
 * played. It is a picture of showing up, so it is deliberately forgiving: any
 * single action lights the square, and it never shows a red "missed" day.
 *
 * Days are UTC calendar days, the same convention `calculateStreak` in
 * gamification.ts uses, so the streak number and the grid never disagree about
 * which day something happened on.
 *
 * Pure — dates in, grid out — and unit-tested without a database.
 */

export const GRID_WEEKS = 12;

export type GridCell = {
  /** YYYY-MM-DD, UTC. */
  date: string;
  count: number;
  /** 0 = nothing, 4 = a very full day. Drives the colour. */
  level: 0 | 1 | 2 | 3 | 4;
  /** True for days after today in the current week, which are drawn blank. */
  future: boolean;
};

export type ActivityGrid = {
  /** Oldest week first; each week is Sunday → Saturday. */
  weeks: GridCell[][];
  /** Actions in the whole window. */
  total: number;
  /** Days with at least one action. */
  activeDays: number;
  /** Longest run of consecutive active days inside the window. */
  longestRun: number;
};

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

function levelFor(count: number): GridCell["level"] {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count <= 4) return 3;
  return 4;
}

export function buildActivityGrid(
  events: Array<Date | string | null | undefined>,
  now: Date = new Date(),
  weeks: number = GRID_WEEKS,
): ActivityGrid {
  const today = startOfUtcDay(now);

  // The grid ends on the Saturday of this week, so the current week is a full column.
  const lastDay = new Date(today);
  lastDay.setUTCDate(lastDay.getUTCDate() + (6 - today.getUTCDay()));
  const firstDay = new Date(lastDay);
  firstDay.setUTCDate(firstDay.getUTCDate() - (weeks * 7 - 1));

  const counts = new Map<string, number>();
  for (const event of events) {
    if (!event) continue;
    const date = event instanceof Date ? event : new Date(event);
    if (Number.isNaN(date.getTime())) continue;
    const day = startOfUtcDay(date);
    if (day < firstDay || day > today) continue;
    const key = dayKey(day);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const grid: GridCell[][] = [];
  let total = 0;
  let activeDays = 0;
  let longestRun = 0;
  let run = 0;

  const cursor = new Date(firstDay);
  for (let w = 0; w < weeks; w += 1) {
    const column: GridCell[] = [];
    for (let d = 0; d < 7; d += 1) {
      const key = dayKey(cursor);
      const future = cursor > today;
      const count = future ? 0 : counts.get(key) ?? 0;
      column.push({ date: key, count, level: levelFor(count), future });
      if (!future) {
        total += count;
        if (count > 0) {
          activeDays += 1;
          run += 1;
          longestRun = Math.max(longestRun, run);
        } else {
          run = 0;
        }
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    grid.push(column);
  }

  return { weeks: grid, total, activeDays, longestRun };
}
