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

export type BatchOption = { value: string; label: string };

/**
 * The batch months a NEW signup may choose today: this calendar month plus the
 * next `count` — never a past one. `value` stays a bare month name (what
 * `admission.batch` has always stored, and what `resolveBatchAbsolute`
 * resolves forward from the registration date), while `label` spells out the
 * year so the student is never guessing which "July" they are picking.
 *
 * Twelve options (this month + 11) is deliberate: one full year, so no month
 * name repeats and `value` alone is never ambiguous.
 */
export function availableBatchOptions(now: Date = new Date(), count = 11): BatchOption[] {
  const options: BatchOption[] = [];
  for (let i = 0; i <= count; i++) {
    const monthIndex = (now.getMonth() + i) % 12;
    const year = now.getFullYear() + Math.floor((now.getMonth() + i) / 12);
    options.push({ value: MONTH_NAMES[monthIndex], label: `${MONTH_NAMES[monthIndex]} ${year}` });
  }
  return options;
}

/**
 * A specific batch does not always open on the 1st — a public holiday, a venue
 * clash, an office decision can push the first teaching day a few days out.
 * `resolveBatchStart` (lib/batch-reservation.ts) defaults every batch to the
 * 1st; this is the override list on top of that, one entry per calendar month
 * that opens on a different day. Keyed "YYYY-MM" so October 2026 and a future
 * October 2027 never collide.
 */
export const INTAKE_START_DAYS_KEY = "intake.startDays";

/** "YYYY-MM" -> the day of that month (1-28) the batch actually opens. */
export type IntakeStartDayOverrides = Record<string, number>;

const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function isValidStartDay(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 28;
}

/** "2026-10" for October 2026 — the same key `resolveBatchStart` looks up. */
export function intakeMonthKey(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

/**
 * Reading from storage must never throw — a hand-edited row degrades to "every
 * batch opens on the 1st", not a broken countdown or a 500 on the sign-up form.
 */
export function parseIntakeStartDayOverrides(value: unknown): IntakeStartDayOverrides {
  if (!value || typeof value !== "object") return {};
  const out: IntakeStartDayOverrides = {};
  for (const [key, day] of Object.entries(value as Record<string, unknown>)) {
    if (MONTH_KEY_PATTERN.test(key) && isValidStartDay(day)) out[key] = day;
  }
  return out;
}
