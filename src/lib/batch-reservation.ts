/**
 * Reserving a seat in a FUTURE batch.
 *
 * A learner can be placed in an intake that has not started yet — the signup
 * form invites it ("payments for future batches are recorded and your access
 * will be activated when the batch begins"), and the office does it by hand
 * when someone books early. Until that batch's first day the portal is a
 * waiting room: paid in full, part-paid, registration-only or nothing at all,
 * the classroom is closed and a countdown runs to the opening.
 *
 * This file answers ONE question — "is this student's batch an upcoming
 * reservation, and when does it open?" — and it is deliberately separate from
 * `resolveBatchWindow` in `batch.ts`, which drives the timetable, promotions
 * and certificates. Those callers must keep reading a batch the way they
 * always have; this one is stricter, because being wrong here padlocks a real
 * student's portal.
 *
 * TWO GUARDS AGAINST LOCKING SOMEBODY BY MISTAKE
 *
 *   1. A bare month name ("July") resolves FORWARDS from the registration
 *      date, so an ongoing student imported in August with batch "July" reads
 *      as "next July" — ten months away. That is not a reservation, it is a
 *      stale label. A bare month more than `MAX_BARE_MONTH_LEAD_MONTHS` ahead
 *      of TODAY is therefore NOT treated as a future batch. (Measured from
 *      today rather than from registration so that an older learner the office
 *      deliberately moves to October still locks.) A month that carries its own
 *      year ("October 2026") is unambiguous and is never second-guessed.
 *   2. A confirmed `classesStartedAt` in the past means classes demonstrably
 *      began for this student, whatever the batch label says.
 *
 * Pure, no Prisma and no server-only imports — the lock screen's countdown and
 * the admin roster both use it in the browser.
 */

import { MONTH_NAMES, resolveBatchAbsolute } from "@/lib/batch";
import { instantToZonedParts, zonedTimeToInstant } from "@/lib/school-time";
import { intakeMonthKey, type IntakeStartDayOverrides } from "@/lib/intake";

/**
 * How far ahead of today a bare month name may sit and still count as a
 * deliberate reservation. Six months covers "I signed up in September for
 * March"; anything further is almost always a mislabelled ongoing student.
 */
export const MAX_BARE_MONTH_LEAD_MONTHS = 6;

const DAY_MS = 24 * 60 * 60 * 1000;

const MONTH_ABBREVIATIONS = MONTH_NAMES.map((name) => name.slice(0, 3).toLowerCase());

export type ParsedBatchLabel = {
  monthIndex: number;
  /** Four-digit year when the label carried one ("October 2026"), else null. */
  year: number | null;
};

/**
 * "October", "october", "Oct", "Sept", "October 2026", "Oct '26" → month + year.
 * Anything else (blank, "TBC", a sentence) → null, and null never locks.
 */
export function parseBatchLabel(raw: unknown): ParsedBatchLabel | null {
  if (typeof raw !== "string") return null;
  const match = raw
    .trim()
    .toLowerCase()
    .match(/^([a-z]+)\.?(?:[\s,'’-]*(\d{4}|\d{2}))?$/);
  if (!match) return null;

  const word = match[1];
  let monthIndex = MONTH_NAMES.findIndex((name) => name.toLowerCase() === word);
  if (monthIndex < 0 && (word.length === 3 || word === "sept")) {
    monthIndex = MONTH_ABBREVIATIONS.indexOf(word.slice(0, 3));
  }
  if (monthIndex < 0) return null;

  let year: number | null = null;
  if (match[2]) {
    const parsed = Number(match[2]);
    year = match[2].length === 2 ? 2000 + parsed : parsed;
  }
  return { monthIndex, year };
}

function validDate(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

export type BatchStart = {
  /** "October" */
  batch: string;
  /** "October 2026" */
  monthLabel: string;
  monthIndex: number;
  year: number;
  /** "2026-10" — matches an IntakeStartDayOverrides key. */
  monthKey: string;
  /** The first instant of the first teaching day, in the school's own timezone. */
  startsOn: Date;
  /** "2026-10-05" once an override moves it off the 1st. */
  startsOnKey: string;
};

/**
 * When a student's batch starts — whether or not that is still ahead of today.
 * Null when the label is unusable or is a stale bare month (guard 1 above).
 *
 * Defaults every batch to the 1st of the month. Pass `startDayOverrides` (see
 * lib/intake.ts) to move specific months — a school-wide decision, not a
 * per-student one, so it is the caller's job to fetch it once and hand it in.
 */
export function resolveBatchStart(
  batch: unknown,
  {
    registeredAt,
    now = new Date(),
    startDayOverrides,
  }: { registeredAt?: unknown; now?: Date; startDayOverrides?: IntakeStartDayOverrides } = {},
): BatchStart | null {
  const parsed = parseBatchLabel(batch);
  if (!parsed) return null;

  const registered = validDate(registeredAt);
  let absolute: number;
  if (parsed.year !== null) {
    absolute = parsed.year * 12 + parsed.monthIndex;
  } else {
    const resolved = resolveBatchAbsolute(MONTH_NAMES[parsed.monthIndex], { registeredAt: registered, now });
    if (resolved === null) return null;
    absolute = resolved;

    const today = instantToZonedParts(now);
    const lead = absolute - (today.year * 12 + (today.month - 1));
    if (lead > MAX_BARE_MONTH_LEAD_MONTHS) return null;
  }

  const year = Math.floor(absolute / 12);
  const monthIndex = absolute % 12;
  const monthKey = intakeMonthKey(year, monthIndex);
  const overrideDay = startDayOverrides?.[monthKey];
  const startDay = overrideDay && overrideDay >= 1 && overrideDay <= 28 ? overrideDay : 1;
  const startsOnKey = `${monthKey}-${String(startDay).padStart(2, "0")}`;
  return {
    batch: MONTH_NAMES[monthIndex],
    monthLabel: `${MONTH_NAMES[monthIndex]} ${year}`,
    monthIndex,
    year,
    monthKey,
    startsOn: zonedTimeToInstant(startsOnKey, "00:00"),
    startsOnKey,
  };
}

export type UpcomingBatch = BatchStart & {
  /** Whole days until the first day, rounded up. Never below 1 while upcoming. */
  daysUntilStart: number;
};

/**
 * The batch this student is waiting for, or null when they are not waiting for
 * one (no batch, unreadable batch, already begun, or already confirmed in class).
 */
export function resolveUpcomingBatch(
  batch: unknown,
  {
    registeredAt,
    classesStartedAt,
    now = new Date(),
    startDayOverrides,
  }: {
    registeredAt?: unknown;
    classesStartedAt?: unknown;
    now?: Date;
    startDayOverrides?: IntakeStartDayOverrides;
  } = {},
): UpcomingBatch | null {
  // Guard 2: a confirmed first day that has already passed beats the label.
  const confirmed = validDate(classesStartedAt);
  if (confirmed && confirmed.getTime() <= now.getTime()) return null;

  const start = resolveBatchStart(batch, { registeredAt, now, startDayOverrides });
  if (!start || start.startsOn.getTime() <= now.getTime()) return null;

  return {
    ...start,
    daysUntilStart: Math.max(1, Math.ceil((start.startsOn.getTime() - now.getTime()) / DAY_MS)),
  };
}

/**
 * The earliest the 30-day part-payment clock may start.
 *
 * `deriveStudentAccess`, the fee reminders and the receivables report each
 * anchor that clock on "the oldest open charge, else classes-started, else
 * enrolment". For somebody who enrolled in September into an October batch,
 * that anchors on September — so the balance lock would land four days after
 * classes open, and the "balance due" reminders would start before a single
 * class has been taught. The clock must not begin before the batch does.
 *
 * Null when it does not apply: no readable batch, or a confirmed first day
 * exists (the office has said when class really began — that wins).
 */
export function batchLockFloor(
  batch: unknown,
  {
    registeredAt,
    classesStartedAt,
    now = new Date(),
    startDayOverrides,
  }: {
    registeredAt?: unknown;
    classesStartedAt?: unknown;
    now?: Date;
    startDayOverrides?: IntakeStartDayOverrides;
  } = {},
): Date | null {
  if (validDate(classesStartedAt)) return null;
  return resolveBatchStart(batch, { registeredAt, now, startDayOverrides })?.startsOn ?? null;
}

/** The later of an anchor date and the batch floor. */
export function withBatchFloor(anchor: Date, floor: Date | null): Date {
  return floor && floor.getTime() > anchor.getTime() ? floor : anchor;
}

/** Days from today to a school-timezone calendar day, for display. */
export function schoolDaysUntil(startsOn: Date, now: Date = new Date()): number {
  const today = instantToZonedParts(now);
  const todayStart = zonedTimeToInstant(
    `${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`,
    "00:00",
  );
  return Math.max(0, Math.round((startsOn.getTime() - todayStart.getTime()) / DAY_MS));
}

/**
 * Where a learner stands on their seat. One vocabulary for the lock screen,
 * the admin roster and Becca's nudges, so they cannot disagree.
 *
 *   paid_in_full      nothing owed on the current level
 *   deposit_paid      cleared the deposit; a balance is still open
 *   registration_only registration fee (and/or part of the deposit) received,
 *                     but not yet enough to hold the seat
 *   unpaid            nothing received yet
 */
export type SeatStatus = "paid_in_full" | "deposit_paid" | "registration_only" | "unpaid";

export function seatStatusFor({
  tuitionPaid,
  registrationPaid,
  depositPaid,
  fullyPaid,
}: {
  /** Tuition received — the registration fee is NOT part of this (see receivedPaymentFilter). */
  tuitionPaid: number;
  /** Whether the registration fee has been received. */
  registrationPaid: boolean;
  depositPaid: boolean;
  fullyPaid: boolean;
}): SeatStatus {
  if (tuitionPaid > 0 && fullyPaid) return "paid_in_full";
  if (tuitionPaid > 0 && depositPaid) return "deposit_paid";
  if (tuitionPaid > 0 || registrationPaid) return "registration_only";
  return "unpaid";
}

export const SEAT_STATUS_LABEL: Record<SeatStatus, string> = {
  paid_in_full: "Paid in full",
  deposit_paid: "Deposit paid",
  registration_only: "Registered — deposit pending",
  unpaid: "Nothing paid yet",
};
