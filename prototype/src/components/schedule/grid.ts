/**
 * Month-grid maths shared by every schedule calendar (tutor timetable, admin
 * schedule). Pure date helpers, no React, no data fetching — the same 42-cell
 * grid the Work Drive staff calendar draws by hand in app/admin/calendar, lifted
 * so the class calendars don't each reinvent it.
 *
 * The week starts on MONDAY here, matching how a school reads a timetable (and
 * the reference design Jason sent). Days are addressed by a local `yyyy-mm-dd`
 * key so they line up with `dayKey` in lib/class-sessions.ts, which also reads
 * local date components.
 */

/** Local `yyyy-mm-dd` — the key every `days` map in the calendars uses. */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Monday=0 … Sunday=6, from JS `getDay()` (Sunday=0). */
export function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Midnight-local first day of `cursor`'s month. */
export function monthStart(cursor: Date): Date {
  return new Date(cursor.getFullYear(), cursor.getMonth(), 1);
}

/** Last day of `cursor`'s month, end of day. */
export function monthEnd(cursor: Date): Date {
  return new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59, 999);
}

/**
 * The grid as rows of 7 `Date`s: from the Monday on or before the 1st to the
 * Sunday on or after month end. Always whole weeks; 5 rows for a short month,
 * 6 for a long one.
 */
export function monthGrid(cursor: Date): Date[][] {
  const first = monthStart(cursor);
  first.setDate(first.getDate() - mondayIndex(first));
  const end = monthEnd(cursor);

  const rows: Date[][] = [];
  const d = new Date(first);
  // Guard at 6 weeks so a bad `cursor` can never spin forever.
  for (let week = 0; week < 6; week += 1) {
    const row: Date[] = [];
    for (let i = 0; i < 7; i += 1) {
      row.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
    rows.push(row);
    if (d > end) break;
  }
  return rows;
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function addMonths(cursor: Date, delta: number): Date {
  return new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1);
}

export function monthLabel(cursor: Date): string {
  return cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
