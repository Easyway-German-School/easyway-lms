/**
 * What a batch month actually MEANS.
 *
 * A student picks one month at signup — "August". That month is the FIRST of
 * the level's teaching months, not the month before them: an August batch is
 * taught across August AND September, and finishes at the end of September.
 * Nothing counts backwards from the chosen month.
 *
 *     batch "August"  →  August + September   →  ends 30 September
 *     batch "January" →  January + February   →  ends 28/29 February
 *
 * WHICH August, though, is the part that was wrong. The old rule — used in
 * three places, each with its own copy — was "the most recent occurrence at or
 * before now". That is right for a student looking back at a batch they are
 * sitting in, and badly wrong for the case the signup form explicitly invites:
 *
 *     "You can select a future batch — payments for future batches are
 *      recorded and your access will be activated when the batch begins."
 *
 * Somebody signing up on 1 August 2026 for the September batch was read as
 * having started in September 2025 — eleven months ago — so the portal
 * congratulated them on finishing a level they had not attended one day of.
 *
 * The fix is to anchor on the date they REGISTERED. A batch month can never
 * be before the month a student walked in, so the batch is the first
 * occurrence of that month at or after their registration month. Where the
 * registration date is unknown (imported rows, old data) it falls back to the
 * old backwards-looking rule, which is still the right answer for a student
 * who is mid-course.
 */

import { SESSION_MONTHS } from "@/lib/levels";

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/**
 * "August" → 7. Case- and space-tolerant, because this reads month names that
 * came from a signup form, a spreadsheet import and an admin edit box.
 *
 * Lives here rather than in `schedule.ts` (where it used to) so that every
 * batch question has one home and `schedule.ts` can depend on this file
 * instead of the other way round.
 */
export function monthNameToIndex(name: unknown): number | null {
  if (typeof name !== "string") return null;
  const index = MONTH_NAMES.findIndex((m) => m.toLowerCase() === name.trim().toLowerCase());
  return index >= 0 ? index : null;
}

export type BatchWindow = {
  /** The month name as the student chose it. */
  batch: string;
  monthIndex: number;
  year: number;
  /** year * 12 + monthIndex — makes month arithmetic wrap years for free. */
  absolute: number;
  /** Midnight on the 1st of the batch month. */
  startsOn: Date;
  /** The last instant of the final teaching month. */
  endsOn: Date;
  /** Every teaching month, e.g. ["August 2026", "September 2026"]. */
  months: string[];
  /** "August – September 2026" — how the office says it out loud. */
  label: string;
  /** Whole months since the batch began. Negative before it starts. */
  monthsElapsed: number;
  hasBegun: boolean;
  hasEnded: boolean;
  /** Days until the first teaching day. 0 once it has begun. */
  daysUntilStart: number;
};

function absoluteOf(date: Date): number {
  return date.getFullYear() * 12 + date.getMonth();
}

/**
 * Which calendar occurrence of a batch month a student means.
 *
 * Exported because the promotion report and the journey both need the raw
 * number without building a whole window around it.
 */
export function resolveBatchAbsolute(
  batch: string | null | undefined,
  { registeredAt, now = new Date() }: { registeredAt?: Date | null; now?: Date } = {},
): number | null {
  const monthIndex = monthNameToIndex(batch);
  if (monthIndex === null) return null;

  if (registeredAt instanceof Date && !Number.isNaN(registeredAt.getTime())) {
    // Forwards from registration: the first occurrence at or after the month
    // they signed up in. A student registering in August for "July" means next
    // July, not the July that had already gone when they walked in.
    const year =
      monthIndex >= registeredAt.getMonth() ? registeredAt.getFullYear() : registeredAt.getFullYear() + 1;
    return year * 12 + monthIndex;
  }

  // No registration date to anchor on. Fall back to the most recent occurrence
  // at or before now, which is the right reading for a student already
  // mid-course and the only reading available for an imported row.
  const year = monthIndex <= now.getMonth() ? now.getFullYear() : now.getFullYear() - 1;
  return year * 12 + monthIndex;
}

export function resolveBatchWindow(
  batch: string | null | undefined,
  {
    registeredAt,
    now = new Date(),
    months = SESSION_MONTHS,
  }: { registeredAt?: Date | null; now?: Date; months?: number } = {},
): BatchWindow | null {
  const absolute = resolveBatchAbsolute(batch, { registeredAt, now });
  if (absolute === null) return null;

  const year = Math.floor(absolute / 12);
  const monthIndex = absolute % 12;

  const startsOn = new Date(year, monthIndex, 1, 0, 0, 0, 0);
  // Day 0 of the month AFTER the last teaching month is the last day of it.
  const endsOn = new Date(year, monthIndex + months, 0, 23, 59, 59, 999);

  const monthLabels: string[] = [];
  for (let i = 0; i < months; i += 1) {
    const d = new Date(year, monthIndex + i, 1);
    monthLabels.push(`${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`);
  }

  const first = new Date(year, monthIndex, 1);
  const last = new Date(year, monthIndex + months - 1, 1);
  const label =
    months <= 1
      ? monthLabels[0]
      : first.getFullYear() === last.getFullYear()
        ? `${MONTH_NAMES[first.getMonth()]} – ${MONTH_NAMES[last.getMonth()]} ${last.getFullYear()}`
        : `${monthLabels[0]} – ${monthLabels[monthLabels.length - 1]}`;

  const monthsElapsed = absoluteOf(now) - absolute;
  const msPerDay = 24 * 60 * 60 * 1000;

  return {
    batch: MONTH_NAMES[monthIndex],
    monthIndex,
    year,
    absolute,
    startsOn,
    endsOn,
    months: monthLabels,
    label,
    monthsElapsed,
    hasBegun: now >= startsOn,
    hasEnded: now > endsOn,
    daysUntilStart: Math.max(0, Math.ceil((startsOn.getTime() - now.getTime()) / msPerDay)),
  };
}

/**
 * Whole months since a student's batch began, or null when the batch name is
 * unusable. Negative while the batch is still ahead of them.
 */
export function monthsSinceBatch(
  batch: string | null | undefined,
  opts: { registeredAt?: Date | null; now?: Date } = {},
): number | null {
  const absolute = resolveBatchAbsolute(batch, opts);
  if (absolute === null) return null;
  return absoluteOf(opts.now ?? new Date()) - absolute;
}

/** Read the batch month off an admission JSON payload. */
export function batchFromAdmission(admission: unknown): string | null {
  if (!admission || typeof admission !== "object") return null;
  const value = (admission as Record<string, unknown>).batch;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
