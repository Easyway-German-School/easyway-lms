/**
 * The school's CURRENT INTAKE — the one month a new student joins by default.
 *
 * "Batch" has never been a real object in this system: it is a bare month name
 * ("September") kept in each student's admission blob, and it is set — or not —
 * at three separate doorways (the public sign-up form, the office's Add-student
 * form, the CSV import). Optional at all three, so a student can land with no
 * batch at all, and then the timetable generator, the promotion engine and any
 * "message the September cohort" send have nothing to work from.
 *
 * This is the fix that costs nothing at the doorways: one value the office
 * sets on /admin/settings — "we are currently taking people into the September
 * 2026 intake" — that every doorway falls back to when a batch was not chosen.
 * Nobody has to type a month, and nothing lands blank.
 *
 * A school that has never opened the setting gets the current calendar month,
 * which is what "this intake" almost always means anyway.
 *
 * Pure module (no prisma, no next) so the sign-up form's client bundle can
 * import the shape and the label helper. The database read lives in
 * intake-server.ts.
 */

import { MONTH_NAMES, monthNameToIndex } from "@/lib/batch";

export const CURRENT_INTAKE_KEY = "intake.current";

export type CurrentIntake = {
  /** Bare month name, exactly as it is stored on `admission.batch`. */
  month: string;
  year: number;
};

/** What a school runs on before it has ever set this: the month we are in. */
export function defaultCurrentIntake(now: Date = new Date()): CurrentIntake {
  return { month: MONTH_NAMES[now.getMonth()], year: now.getFullYear() };
}

/**
 * Read a stored value back into a known shape.
 *
 * Two callers, opposite needs — the same pattern as parseSessionSettings.
 * Reading from the database must never throw: a row hand-edited into nonsense
 * degrades to "the current month", it does not take down the sign-up form.
 * Accepting a POST is strict, because that is the moment to reject nonsense
 * rather than store it.
 */
export function parseCurrentIntake(value: unknown): CurrentIntake;
export function parseCurrentIntake(value: unknown, options: { strict: true }): CurrentIntake | null;
export function parseCurrentIntake(
  value: unknown,
  options?: { strict?: boolean },
): CurrentIntake | null {
  const strict = options?.strict === true;
  const fallback = strict ? null : defaultCurrentIntake();

  if (!value || typeof value !== "object") return fallback;

  const rawMonth = (value as { month?: unknown }).month;
  const monthIndex = monthNameToIndex(rawMonth);
  if (monthIndex === null) return fallback;

  const rawYear = Number((value as { year?: unknown }).year);
  const thisYear = new Date().getFullYear();
  // A generous but real window — a typo of "2206" (which is in the September
  // import data) should not be storable as an intake year.
  const year =
    Number.isInteger(rawYear) && rawYear >= thisYear - 5 && rawYear <= thisYear + 5
      ? rawYear
      : strict
        ? NaN
        : thisYear;

  if (Number.isNaN(year)) return null;

  return { month: MONTH_NAMES[monthIndex], year };
}

/** "September 2026" — how the office says it out loud. */
export function currentIntakeLabel(intake: CurrentIntake): string {
  return `${intake.month} ${intake.year}`;
}
