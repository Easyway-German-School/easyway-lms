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
 * The fix is to anchor on the date they REGISTERED: the batch is the first
 * occurrence of that month at or after one session before their registration
 * month (a returning student re-added mid-batch was already in it). A label
 * that carries its own year ("September 2026") always wins. Where the
 * registration date is unknown (imported rows, old data) it falls back to the
 * old backwards-looking rule, which is still the right answer for a student
 * who is mid-course.
 */

import { SESSION_MONTHS, WEEKEND_SESSION_MONTHS } from "@/lib/levels";
import { instantToZonedParts } from "@/lib/school-time";

/**
 * How far BEFORE the registration month a bare batch month may sit and still
 * mean the batch the student was already in. One full (weekend-length) session:
 * a returning student re-added by hand in November for the "September" batch
 * was in September of THIS year, not next year. Without this window that
 * student read as September 2027, and moving them up placed them in
 * November 2027.
 */
export const RECENT_BATCH_LOOKBACK_MONTHS = WEEKEND_SESSION_MONTHS;

/** Furthest ahead a batch can sensibly be booked; matches MAX_BARE_MONTH_LEAD_MONTHS. */
export const MAX_BATCH_LEAD_MONTHS = 6;

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/**
 * "August" → 7. Case- and space-tolerant, because this reads month names that
 * came from a signup form, a spreadsheet import and an admin edit box.
 *
 * Also tolerates a trailing year — "September 2026" — which is exactly what
 * `resolveBatchWindow` below prints back out as a teaching month label, and
 * what a bulk import or an admin typing the label back in produces. Without
 * stripping it this returned null for anything written that way, which
 * silently zeroed out `batchOfAdmission` for the student: on production this
 * was 229 of 789 active students with a batch set, each invisibly dropped out
 * of every batch-pinned material, notification and live-room check that reads
 * their own admission record (see /api/student/materials, belongsToLecturer).
 * The admission JSON itself is left alone — this only widens what the reader
 * accepts.
 *
 * Lives here rather than in `schedule.ts` (where it used to) so that every
 * batch question has one home and `schedule.ts` can depend on this file
 * instead of the other way round.
 */
export function monthNameToIndex(name: unknown): number | null {
  if (typeof name !== "string") return null;
  const cleaned = name.trim().replace(/\s+\d{4}$/, "");
  const index = MONTH_NAMES.findIndex((m) => m.toLowerCase() === cleaned.toLowerCase());
  return index >= 0 ? index : null;
}

/** "September 2026" → 2026. A bare month, or a year outside 1900–2200, → null. */
export function yearFromBatchLabel(label: unknown): number | null {
  if (typeof label !== "string") return null;
  const match = label.trim().match(/\s(\d{4})$/);
  if (!match) return null;
  const year = Number(match[1]);
  return year >= 1900 && year <= 2200 ? year : null;
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

  // A label that carries its own year ("September 2026") is unambiguous.
  const explicitYear = yearFromBatchLabel(batch);
  if (explicitYear !== null) return explicitYear * 12 + monthIndex;

  if (registeredAt instanceof Date && !Number.isNaN(registeredAt.getTime())) {
    // Forwards from registration, allowing one session of look-back: the first
    // occurrence at or after RECENT_BATCH_LOOKBACK_MONTHS before the month they
    // registered in. Registering in November for "September" means the
    // September just gone (a returning student re-added mid-flight), while
    // registering in December for "July" still means next July.
    const floor = absoluteOf(registeredAt) - RECENT_BATCH_LOOKBACK_MONTHS;
    let absolute = floor + ((monthIndex - (floor % 12) + 12) % 12);

    /**
     * STALE-REGISTRATION GUARD.
     *
     * The rule above only looks at the MONTH a student registered in, never
     * at how long ago that was. Correct for a brand-new signup (registeredAt
     * is basically `now`). Wrong for anyone whose account predates the batch
     * label now on their record by a year or more — every A2+ student, since
     * their account carries their ORIGINAL registration date (from A1, or
     * earlier), not when they were placed in their current batch. Without
     * this guard, a student who paid for "October" this year could resolve
     * to October of whatever year she originally registered — a batch the
     * system then believes ended long ago, producing exactly the "my
     * dashboard says I've completed a level I haven't started" complaint.
     *
     * A batch label never means something more than about a year stale (the
     * same ceiling `batch-reservation.ts`'s MAX_BARE_MONTH_LEAD_MONTHS applies
     * looking the other way, into the future). Once the naive result falls
     * more than 11 months behind `now`, roll it forward by whole years until
     * it lands within one cycle of today — the occurrence the label plainly
     * means right now, not the one nearest a long-past registration date.
     */
    const nowAbsolute = now.getFullYear() * 12 + now.getMonth();
    if (nowAbsolute - absolute > 11) {
      absolute += 12 * Math.ceil((nowAbsolute - absolute - 11) / 12);
    }
    return absolute;
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

/** Read the batch as a month plus its explicitly selected year, when present. */
export function batchLabelFromAdmission(
  admission: unknown,
  currentEnrolment?: { batchMonth?: string | null; batchYear?: number | null } | null,
): string | null {
  const batch = currentEnrolment?.batchMonth?.trim() || batchFromAdmission(admission);
  if (!batch || /\b\d{4}\b/.test(batch)) return batch;
  const admissionYear =
    admission && typeof admission === "object" && !Array.isArray(admission)
      ? (admission as Record<string, unknown>).batchYear
      : null;
  const year =
    currentEnrolment?.batchYear ??
    (typeof admissionYear === "number" ? admissionYear : null);
  return typeof year === "number" && Number.isInteger(year) && year >= 1900 && year <= 2200
    ? `${batch} ${year}`
    : batch;
}

function zonedAbsolute(date: Date): number {
  const parts = instantToZonedParts(date);
  return parts.year * 12 + (parts.month - 1);
}

/**
 * The one occurrence of a batch month inside the twelve-month window that runs
 * from (12 - 1 - MAX_BATCH_LEAD_MONTHS) months ago to MAX_BATCH_LEAD_MONTHS
 * ahead — the batch a month name plainly means today, whether it is running,
 * just finished or booked ahead. School timezone, like the intake calendar.
 */
export function nearestBatchAbsolute(batch: unknown, now: Date = new Date()): number | null {
  const monthIndex = monthNameToIndex(batch);
  if (monthIndex === null) return null;
  const lowest = zonedAbsolute(now) - (11 - MAX_BATCH_LEAD_MONTHS);
  return lowest + ((monthIndex - (lowest % 12) + 12) % 12);
}

export function nearestBatchYear(batch: unknown, now: Date = new Date()): number | null {
  const absolute = nearestBatchAbsolute(batch, now);
  return absolute === null ? null : Math.floor(absolute / 12);
}

export type BatchYearAssessment = {
  /** Bare month name. */
  month: string;
  /** Year on the admission record (its own label first, then `batchYear`). */
  admissionYear: number | null;
  /** Year on the ongoing enrolment, when it is for the same month. */
  enrolmentYear: number | null;
  /** The year the portal lock, roster and payment clock read today. */
  effectiveYear: number | null;
  /** The year this batch should carry. */
  correctYear: number;
  /** Plain-language reasons the recorded year is wrong. Empty when it is right. */
  issues: string[];
};

/**
 * Is the YEAR on this student's batch right?
 *
 * The month is what people choose; the year is derived, and a wrong one
 * scatters a student: the roster prints "November 2027", the portal either
 * padlocks them for a year or never locks at all, the 30-day payment clock
 * anchors on the wrong date and they land in the wrong cohort's class.
 *
 * The right year, in order of trust:
 *   1. A confirmed first day in the same month, within the sensible window.
 *   2. A recorded year (admission or enrolment) within the sensible window —
 *      the LATEST of them, because moves only go forward and a stale year
 *      always lags behind.
 *   3. The nearest occurrence of the month (see nearestBatchAbsolute).
 *
 * A non-returning student booked further ahead than the window is left alone:
 * a new signup can genuinely reserve a seat that far out.
 */
export function assessBatchYear(input: {
  admissionBatch: string | null;
  admissionYear: number | null;
  enrolment: { batchMonth: string | null; batchYear: number | null } | null;
  classesStartedAt: Date | null;
  /** Moved up before, or above A1 — a booking a year ahead is never deliberate for them. */
  returning: boolean;
  now?: Date;
}): BatchYearAssessment | null {
  const now = input.now ?? new Date();
  // The admission record is what the office edits and promotion writes, so its
  // month leads; a different month on the enrolment is a separate drift.
  const monthIndex = monthNameToIndex(input.admissionBatch) ?? monthNameToIndex(input.enrolment?.batchMonth);
  if (monthIndex === null) return null;
  const month = MONTH_NAMES[monthIndex];

  const admissionYear =
    monthNameToIndex(input.admissionBatch) === monthIndex
      ? yearFromBatchLabel(input.admissionBatch) ?? validYear(input.admissionYear)
      : null;
  const enrolmentYear =
    input.enrolment && monthNameToIndex(input.enrolment.batchMonth) === monthIndex
      ? yearFromBatchLabel(input.enrolment.batchMonth) ?? validYear(input.enrolment.batchYear)
      : null;
  const effectiveLabel = batchLabelFromAdmission(
    { batch: input.admissionBatch, batchYear: input.admissionYear },
    input.enrolment,
  );
  const effectiveYear = monthNameToIndex(effectiveLabel) === monthIndex ? yearFromBatchLabel(effectiveLabel) : null;

  const nowAbsolute = zonedAbsolute(now);
  const inWindow = (absolute: number) =>
    absolute - nowAbsolute <= MAX_BATCH_LEAD_MONTHS && nowAbsolute - absolute <= 11 - MAX_BATCH_LEAD_MONTHS;

  let confirmedYear: number | null = null;
  if (input.classesStartedAt && !Number.isNaN(input.classesStartedAt.getTime())) {
    const started = zonedAbsolute(input.classesStartedAt);
    if (started % 12 === monthIndex && inWindow(started)) confirmedYear = Math.floor(started / 12);
  }

  const recorded = [admissionYear, enrolmentYear].filter((year): year is number => year !== null);
  const plausible = recorded.filter((year) => inWindow(year * 12 + monthIndex));
  // Long past is not proof of a wrong year — a student nobody has moved up yet
  // is still in the batch they started in. Only "too far ahead" is.
  const notTooFarAhead = recorded.filter((year) => year * 12 + monthIndex - nowAbsolute <= MAX_BATCH_LEAD_MONTHS);
  const nearest = Math.floor((nearestBatchAbsolute(month, now) as number) / 12);

  const correctYear =
    confirmedYear ??
    (plausible.length
      ? Math.max(...plausible)
      : notTooFarAhead.length
        ? Math.max(...notTooFarAhead)
        : recorded.length && !input.returning
          ? Math.max(...recorded)
          : nearest);

  const issues: string[] = [];
  if (admissionYear !== null && enrolmentYear !== null && admissionYear !== enrolmentYear) {
    issues.push(`the admission record says ${month} ${admissionYear} but the current enrolment says ${month} ${enrolmentYear}`);
  }
  if (effectiveYear !== null && effectiveYear !== correctYear) {
    const ahead = effectiveYear * 12 + monthIndex - nowAbsolute;
    if (confirmedYear !== null) {
      issues.push(`their confirmed first day is in ${month} ${confirmedYear}, but the batch reads ${month} ${effectiveYear}`);
    } else if (ahead > MAX_BATCH_LEAD_MONTHS) {
      issues.push(`${month} ${effectiveYear} is ${ahead} months away — a moved-up or returning student is never booked that far ahead`);
    } else if (!issues.length) {
      issues.push(`the batch reads ${month} ${effectiveYear}, but ${month} ${correctYear} is the batch they are in`);
    }
  }
  for (const year of [admissionYear, enrolmentYear]) {
    if (year !== null && year !== correctYear && issues.length === 0) {
      issues.push(`a saved year (${year}) disagrees with ${month} ${correctYear}`);
    }
  }

  return { month, admissionYear, enrolmentYear, effectiveYear, correctYear, issues };
}

function validYear(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1900 && value <= 2200 ? value : null;
}
