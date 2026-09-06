import { SCHOOL_TIMEZONE, formatWhen, zonedDateKey } from "@/lib/school-time";

/**
 * Everything the app needs to answer about WHEN an exam sitting is — in one
 * place, so the admin list, the candidate's My Exams screen, the hall ticket,
 * the reminder emails and the booking logic all agree.
 *
 * An exam is a physical seat at a centre. Its time is the centre's local time —
 * `SCHOOL_TIMEZONE`, always — for everyone, including a diaspora candidate
 * flying in. There is deliberately no per-exam timezone and no exam duration:
 * the physical seat gives one correct answer without them.
 *
 * Prisma-free (types only) so `MyExamsPanel` and friends can import it.
 */

/** How far before the sitting registration closes when no explicit deadline is set. */
export const DEFAULT_REGISTRATION_LEAD_DAYS = 3;

const DAY = 86_400_000;

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * The moment registration actually closes: the explicit `registrationDeadline`
 * if the office set one, otherwise `DEFAULT_REGISTRATION_LEAD_DAYS` before the
 * sitting — a paid sitting with seat allocation can't take walk-up registrations
 * the night before.
 */
export function registrationClosesAt(exam: { examDate: Date | string; registrationDeadline: Date | string | null }): Date {
  if (exam.registrationDeadline) return toDate(exam.registrationDeadline);
  return new Date(toDate(exam.examDate).getTime() - DEFAULT_REGISTRATION_LEAD_DAYS * DAY);
}

/** "Fri 15 Nov 2026, 09:00 WAT" — an exam time, always in the centre's zone. */
export function examWhen(examDate: Date | string, tz: string = SCHOOL_TIMEZONE): string {
  return formatWhen(toDate(examDate), tz);
}

/** "Fri 15 Nov" — short, for a tight card where the full string won't fit. */
export function examDateLabel(examDate: Date | string, tz: string = SCHOOL_TIMEZONE): string {
  return toDate(examDate).toLocaleDateString("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" });
}

/**
 * How long until the sitting, phrased for a person: "in 3 days", "tomorrow",
 * "today", "started". `days` is signed (negative once it has started) and
 * rounded on the calendar-day boundary, not the 24-hour one.
 */
export function examCountdown(
  examDate: Date | string,
  now: Date = new Date(),
): { days: number; label: string; started: boolean } {
  const exam = toDate(examDate);
  const started = exam.getTime() <= now.getTime();
  // Difference in whole school-zone calendar days, so "tomorrow" flips at
  // midnight WAT rather than 24h before the exam time.
  const asUTCDay = (key: string) => Date.parse(`${key}T00:00:00.000Z`);
  const days = Math.round((asUTCDay(zonedDateKey(exam)) - asUTCDay(zonedDateKey(now))) / DAY);
  const label = started
    ? "started"
    : days <= 0
      ? "today"
      : days === 1
        ? "tomorrow"
        : `in ${days} days`;
  return { days, label, started };
}

export type ExamRegistrationState = {
  isOpen: boolean;
  reason: null | "closed" | "full" | "past";
  closesAt: Date;
  closesLabel: string;
  seatsLeft: number | null;
};

/**
 * One answer to "can this still be booked, and if not why" — folds together the
 * deadline, the seat count and whether the sitting has already happened.
 */
export function registrationState(
  exam: {
    examDate: Date | string;
    registrationDeadline: Date | string | null;
    capacity: number | null;
    published?: boolean;
  },
  seatsTaken: number,
  now: Date = new Date(),
): ExamRegistrationState {
  const examDate = toDate(exam.examDate);
  const closesAt = registrationClosesAt(exam);
  const seatsLeft = exam.capacity === null ? null : Math.max(0, exam.capacity - seatsTaken);
  const full = exam.capacity !== null && seatsTaken >= exam.capacity;

  let reason: ExamRegistrationState["reason"] = null;
  if (examDate <= now) reason = "past";
  else if (full) reason = "full";
  else if (now > closesAt) reason = "closed";

  return {
    isOpen: reason === null && exam.published !== false,
    reason,
    closesAt,
    closesLabel: examWhen(closesAt),
    seatsLeft,
  };
}
