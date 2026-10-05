import { MONTH_NAMES, monthNameToIndex, resolveBatchWindow } from "@/lib/batch";
import { instantToZonedParts, zonedTimeToInstant } from "@/lib/school-time";
import { intakeMonthKey, startDayFor, type IntakeStartDayOverrides } from "@/lib/intake";
import { nextLevelAfter, sessionDurationMonths } from "@/lib/levels";

/**
 * Graduation — the rules for "this batch has finished, move them on".
 *
 * Pure (no Prisma) so the desk's tests and the browser can use it. The server
 * half is graduation-server.ts.
 *
 * Until now finishing a level was three separate screens run in the right
 * order by a human: sign-off (/admin/journey), certificates (issued lazily,
 * only when the student happened to open the page), promotion
 * (/admin/promotions). Skipping or reordering them lost things — a student
 * promoted before they opened /certificates never got the certificate for the
 * level they had just finished, because the issuer reads the student's CURRENT
 * level. The desk does the steps in the one safe order, and this file decides
 * who is eligible and where they land.
 */

/** How far ahead of a batch's last day the office may already graduate it. */
export const GRADUATE_LEAD_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

export type CohortTiming = {
  startsOn: Date;
  endsOn: Date;
  /** Whole days until the last day; 0 once it has passed. */
  daysToEnd: number;
  ended: boolean;
  /** "August – September 2026" */
  label: string;
  /** True once the office may graduate this batch (ended, or within the lead window). */
  graduatable: boolean;
};

/**
 * When this student's batch runs and whether it is time to graduate it. Same
 * window function the timetable, the promotion report and the certificate use,
 * so the desk cannot disagree with the calendar. Null when the batch is
 * unreadable — those learners are simply not on the desk.
 */
export function cohortTiming(input: {
  batch: string | null | undefined;
  sessionSlot?: string | null;
  registeredAt?: Date | null;
  now?: Date;
}): CohortTiming | null {
  const now = input.now ?? new Date();
  const window = resolveBatchWindow(input.batch, {
    registeredAt: input.registeredAt ?? null,
    now,
    months: sessionDurationMonths(input.sessionSlot),
  });
  if (!window) return null;

  const ended = now.getTime() > window.endsOn.getTime();
  const daysToEnd = ended ? 0 : Math.max(0, Math.ceil((window.endsOn.getTime() - now.getTime()) / DAY_MS));
  return {
    startsOn: window.startsOn,
    endsOn: window.endsOn,
    daysToEnd,
    ended,
    label: window.label,
    // A batch that has not even begun is never graduatable, however the maths lands.
    graduatable: window.hasBegun && (ended || daysToEnd <= GRADUATE_LEAD_DAYS),
  };
}

export type NextPlacement = {
  /** Bare month name, as stored on `admission.batch`. */
  month: string;
  year: number;
  /** "October 2026" */
  label: string;
  /** First teaching day, school timezone. */
  startsOn: Date;
  /** True when that first day has already passed (a late graduation). */
  hasStarted: boolean;
};

/**
 * The intake a graduate lands in: the month AFTER their session ends. A batch
 * that finishes 30 September moves into October's intake. When the office is
 * late and that month is already behind us, the current month is used — a
 * learner is never placed in the past.
 */
export function nextPlacement(input: {
  batch: string | null | undefined;
  sessionSlot?: string | null;
  registeredAt?: Date | null;
  now?: Date;
  startDayOverrides?: IntakeStartDayOverrides;
  /**
   * The level they are MOVING INTO. Intakes can open on a different day per
   * level (A1 Oct 5, A2–B2 Oct 12); without this the month's default day was
   * used, so a graduate was stamped with a start date that had already passed
   * and their portal opened before their level did.
   */
  level?: string | null;
  /**
   * The intake month the learner chose for themselves on the next-level journey
   * (a bare month name). Honoured only when it is the default month or one of the
   * next two; anything else (an old choice, a closed month) falls back to the
   * default, so nobody is placed in a batch that has already closed.
   */
  preferredMonth?: string | null;
}): NextPlacement | null {
  const now = input.now ?? new Date();
  const window = resolveBatchWindow(input.batch, {
    registeredAt: input.registeredAt ?? null,
    now,
    months: sessionDurationMonths(input.sessionSlot),
  });
  if (!window) return null;

  const today = instantToZonedParts(now);
  const currentAbsolute = today.year * 12 + (today.month - 1);
  let absolute = Math.max(window.absolute + sessionDurationMonths(input.sessionSlot), currentAbsolute);
  const preferred = monthNameToIndex(input.preferredMonth);
  // Only the three intakes the journey offers (default month + the next two): a
  // choice gone stale because the move happened late must fall back to the
  // default, never wrap round to the same month next year.
  if (preferred !== null) {
    const ahead = (preferred - (absolute % 12) + 12) % 12;
    if (ahead <= 2) absolute += ahead;
  }

  const year = Math.floor(absolute / 12);
  const monthIndex = absolute % 12;
  const monthKey = intakeMonthKey(year, monthIndex);
  const day = startDayFor(input.startDayOverrides, monthKey, input.level);
  const startsOn = zonedTimeToInstant(`${monthKey}-${String(day).padStart(2, "0")}`, "00:00");

  return {
    month: MONTH_NAMES[monthIndex],
    year,
    label: `${MONTH_NAMES[monthIndex]} ${year}`,
    startsOn,
    hasStarted: startsOn.getTime() <= now.getTime(),
  };
}

export type GraduationVerdict =
  | { state: "ready" }
  | { state: "blocked"; reason: "fees" | "never_started" | "held_back" | "top_of_ladder"; detail: string };

/**
 * Can this learner be moved on right now?
 *
 * Deliberately conservative — this is also what the automatic run uses, and an
 * earlier version of the app that derived "level finished" from the calendar
 * alone congratulated learners who had never attended a lesson. So the
 * calendar says WHEN, and these say WHO:
 *
 *   held back      the office withheld sign-off on purpose — never overridden
 *   never started  no confirmed first day and no attendance on the register
 *   fees           owes on a level they have already been in (the same gate
 *                  promoteStudents enforces); collected first, or promoted by a
 *                  super admin with an override on /admin/promotions
 *   top of ladder  nothing above C2
 */
export function graduationVerdict(input: {
  level: string;
  heldBackAt: Date | string | null;
  heldBackReason?: string | null;
  hasStarted: boolean;
  priorLevelOwed: number;
  formatMoney?: (value: number) => string;
}): GraduationVerdict {
  if (input.heldBackAt) {
    return {
      state: "blocked",
      reason: "held_back",
      detail: input.heldBackReason ? `Held back: ${input.heldBackReason}` : "Held back by the office",
    };
  }
  if (!nextLevelAfter(input.level)) {
    return { state: "blocked", reason: "top_of_ladder", detail: `Already at ${input.level}` };
  }
  if (!input.hasStarted) {
    return { state: "blocked", reason: "never_started", detail: "Never marked present — check before moving up" };
  }
  if (input.priorLevelOwed > 0) {
    const money = input.formatMoney ? input.formatMoney(input.priorLevelOwed) : String(input.priorLevelOwed);
    return { state: "blocked", reason: "fees", detail: `Owes ${money} on ${input.level}` };
  }
  return { state: "ready" };
}
