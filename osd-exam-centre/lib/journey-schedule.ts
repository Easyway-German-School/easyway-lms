import { calendarDaysBetween } from "@/lib/exam-time";
import { JOURNEY_ORDER, type JourneyStep } from "@/lib/journey-emails";

/**
 * WHEN each journey email is due — pure, so the pacing that makes the journey
 * feel orderly rather than spammy is unit-tested rather than trusted.
 *
 * Two kinds of step:
 *  - EVENT steps (booking_received, payment_confirmed, admission,
 *    result_released, certificate_ready) are fired immediately by the action
 *    that causes them. They appear here too, as a safety net: if the immediate
 *    send failed (SMTP hiccup), the daily sweep retries it.
 *  - TIMED steps (reminder, info check, prep invite, guide, exam reminders,
 *    result-pending) only ever come from the sweep.
 *
 * `dueStep` returns AT MOST ONE step per candidate per sweep, the earliest in
 * journey order. A candidate who was missed for a few days therefore gets the
 * next email tomorrow and the one after the day after, never four at once.
 */

export type ScheduleFacts = {
  status: string; // booked | confirmed | cancelled | no_show
  paymentStatus: string;
  createdAt: Date;
  verifiedAt: Date | null;
  infoConfirmedAt: Date | null;
  admittedAt: Date | null;
  examCompletedAt: Date | null;
  resultReleasedAt: Date | null;
  certificateReadyAt: Date | null;
  prepInterestAt: Date | null;
  missingFields: string[];
  examStart: Date;
};

/** A verification older than this is history, not a missed send — the safety net won't resurrect it. */
const SAFETY_NET_DAYS = 3;

export function dueStep(facts: ScheduleFacts, sent: ReadonlySet<JourneyStep>, now: Date): JourneyStep | null {
  if (facts.status === "cancelled" || facts.status === "no_show") return null;
  // refund_pending / refund_failed: money is in flux and a human is handling it — never automate at them.
  if (!["unpaid", "pending_verification", "paid"].includes(facts.paymentStatus)) return null;

  const daysToExam = calendarDaysBetween(now, facts.examStart);
  const since = (d: Date | null) => (d ? calendarDaysBetween(d, now) : null);
  const paid = facts.paymentStatus === "paid";

  const rules: Record<JourneyStep, () => boolean> = {
    booking_received: () => !paid,
    // One calendar day of silence — the cron runs at 09:00 Lagos, so a candidate keyed in on Monday hears from us Tuesday morning — and only while the exam is still ahead. Not to someone who
    // has already sent us a slip — they've done their part; the office is the one who's behind.
    payment_reminder: () => facts.paymentStatus === "unpaid" && sent.has("booking_received") && (since(facts.createdAt) ?? 0) >= 1 && daysToExam > 0,
    payment_confirmed: () => paid && (since(facts.verifiedAt) ?? 99) <= SAFETY_NET_DAYS,
    // A day after paying, if they still owe us details or a confirmation. Skipped when they've already done it.
    info_check: () =>
      paid && sent.has("payment_confirmed") && !facts.admittedAt && daysToExam > 0 &&
      (facts.missingFields.length > 0 || !facts.infoConfirmedAt) && (since(facts.verifiedAt) ?? 0) >= 1,
    // The one soft sell: after the admin chores, a few days after payment, and only when there is
    // still time for a class to matter. Never to someone who already raised their hand.
    prep_invite: () =>
      paid && sent.has("payment_confirmed") && (sent.has("info_check") || Boolean(facts.infoConfirmedAt)) &&
      !facts.prepInterestAt && (since(facts.verifiedAt) ?? 0) >= 3 && daysToExam >= 10,
    admission: () => Boolean(facts.admittedAt) && daysToExam >= 0,
    // The guide follows the letter by a day — or straight away when the exam is close.
    exam_guide: () =>
      Boolean(facts.admittedAt) && sent.has("admission") && daysToExam >= 0 &&
      ((since(facts.admittedAt) ?? 0) >= 1 || daysToExam <= 3),
    // Catch-up window, not an exact day: a candidate admitted at day 5 still gets a "one week" reminder.
    reminder_7day: () => Boolean(facts.admittedAt) && sent.has("admission") && daysToExam >= 2 && daysToExam <= 7,
    reminder_24h: () => Boolean(facts.admittedAt) && sent.has("admission") && daysToExam === 1,
    result_pending: () => Boolean(facts.examCompletedAt) && !facts.resultReleasedAt && (since(facts.examCompletedAt) ?? 0) >= 10,
    result_released: () => Boolean(facts.resultReleasedAt),
    certificate_ready: () => Boolean(facts.certificateReadyAt),
  };

  for (const step of JOURNEY_ORDER) {
    if (sent.has(step)) continue;
    if (rules[step]()) return step;
  }
  return null;
}
