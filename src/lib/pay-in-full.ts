import { WEEKS_OF_TEACHING, weeksOfTeachingFor } from "@/lib/levels";
import { DEPOSIT_RATE, MIN_PART_PAYMENT, REGISTRATION_FEE } from "@/lib/payment";

/**
 * The pay-in-full offer.
 *
 * The school lets a student start class on a 60% deposit, and most of them
 * never come back for the balance — the office spends the rest of the term
 * chasing it. This module is the persuasion layer that pushes students to
 * settle 100% up front, and every number it produces is derived from real data.
 *
 * The mechanisms, and why each one is here:
 *
 *  1. DEFAULT EFFECT       full payment is the pre-selected, primary action;
 *                          part-payment is a quiet secondary link. People take
 *                          the path laid out for them.
 *  2. LOSS FRAMING         the part-payment option is labelled by what will
 *                          still be OWED and when, not by the 60% being paid.
 *                          "₦72,000 due by 12 Aug" lands harder than "pay 60%".
 *  3. GOAL GRADIENT        an obviously unfinished progress ring. An
 *                          incomplete bar is uncomfortable to look at, and the
 *                          discomfort is the point (Zeigarnik).
 *  4. BUNDLING/ENDOWMENT   perks are itemised and shown as already allocated,
 *                          pending payment, so declining reads as giving
 *                          something up rather than not gaining it.
 *  5. REAL DEADLINE        the bonus window genuinely closes and is genuinely
 *                          enforced below. No resetting countdown.
 *  6. HONEST SOCIAL PROOF  the share of students at THEIR branch who paid in
 *                          full, computed from the database, and withheld
 *                          entirely when the sample is too small to mean
 *                          anything.
 *  7. CONCRETE CONSEQUENCE an open balance stamps their certificate
 *                          PROVISIONAL. See `src/lib/certificates.ts`.
 *  8. PAIN OF PAYING       the fee re-expressed per week of teaching, which
 *                          shrinks the perceived size of one big number.
 *
 * Deliberately NOT here: fake urgency, invented "3 slots left", fabricated
 * peer statistics, or a discount dressed up as a limited offer. Those work
 * once and cost the school its word, and a student who feels tricked into
 * ₦180,000 tells the next twenty.
 */

/** Days from enrolment in which paying in full earns the bonus bundle. */
export const FULL_PAYMENT_WINDOW_DAYS = 14;

/** Below this many students at a branch, the "% paid in full" figure is withheld. */
const MIN_SOCIAL_PROOF_SAMPLE = 8;

const DAY_MS = 86_400_000;

export type Perk = {
  id: string;
  label: string;
  detail: string;
  /**
   * True when code actually enforces this. The rest are operational promises
   * the branch office has to honour — they are listed for the office on the
   * admin full-payers report rather than being silently unkept.
   */
  enforced: boolean;
};

export const PAY_IN_FULL_PERKS: Perk[] = [
  {
    id: "certificate-clean",
    label: "Certificate issued clean, not provisional",
    detail:
      "Students with an open balance still get their certificate, but it carries a PROVISIONAL stamp and the balance on its face. Paying in full removes both.",
    enforced: true,
  },
  {
    id: "no-reminders",
    label: "No fee reminders, ever",
    detail: "The 14, 30 and 45 day balance notices never fire for a fully paid student.",
    enforced: true,
  },
  {
    id: "materials-full",
    label: "The whole material library, from day one",
    detail: "Every document for the level unlocks immediately instead of following the balance.",
    enforced: true,
  },
  {
    id: "mock-exam",
    label: "A free full mock exam sitting",
    detail: "One full marked mock at the branch before the real sitting.",
    enforced: false,
  },
  {
    id: "priority-tutor",
    label: "Priority tutor allocation",
    detail: "First pick of session slot and tutor when the batch is assigned.",
    enforced: false,
  },
];

export type FullPaymentOffer = {
  tuitionFee: number;
  requiredDeposit: number;
  totalPaid: number;
  /** Still owed on the full fee. */
  outstanding: number;
  /** Owed before class opens. Zero once the deposit is in. */
  outstandingToStart: number;
  fullPaid: boolean;
  depositPaid: boolean;
  /** Progress toward 100%, which is what the ring shows. */
  progressPercent: number;
  /** Mechanism 3 — the gap the ring leaves visible. */
  remainingPercent: number;

  /** Mechanism 5 — the bonus window. */
  windowEndsAt: string;
  daysLeftInWindow: number;
  windowOpen: boolean;
  /** Earned the bundle: paid in full while the window was open. */
  bonusEarned: boolean;
  /** Window closed with a balance still open — the bundle is gone. */
  bonusForfeited: boolean;

  /** Mechanism 2 — when the balance is expected if they part-pay. */
  balanceDueAt: string;

  /** Mechanism 8 — the fee spread over the weeks of teaching. */
  perWeek: number;
  weeksOfTeaching: number;

  perks: Perk[];
};

/**
 * Everything the UI needs to make the case for 100%.
 *
 * `fullPaidAt` is when the payment that crossed the full fee actually landed —
 * not "now" — so the bonus is judged on when the student paid rather than on
 * when this function happens to run. Without that, re-rendering the page after
 * the window closed would retroactively strip a bonus that was properly earned.
 */
export function deriveFullPaymentOffer({
  enrolledAt,
  tuitionFee,
  totalPaid,
  fullPaidAt,
  now = new Date(),
  sessionSlot = null,
}: {
  enrolledAt: Date | string;
  tuitionFee: number;
  totalPaid: number;
  fullPaidAt?: Date | string | null;
  now?: Date;
  sessionSlot?: string | null;
}): FullPaymentOffer {
  const weeksOfTeaching = weeksOfTeachingFor(sessionSlot);
  const fee = Math.max(0, Math.round(Number(tuitionFee) || 0));
  const paid = Math.max(0, Math.round(Number(totalPaid) || 0));
  const deposit = Math.round(fee * DEPOSIT_RATE);
  const start = new Date(enrolledAt);
  const enrolMs = Number.isNaN(start.getTime()) ? now.getTime() : start.getTime();

  const windowEnds = new Date(enrolMs + FULL_PAYMENT_WINDOW_DAYS * DAY_MS);
  // Ceil so a student inside the last 24 hours sees "1 day left", not "0".
  const daysLeftInWindow = Math.max(0, Math.ceil((windowEnds.getTime() - now.getTime()) / DAY_MS));
  const windowOpen = now.getTime() < windowEnds.getTime();

  const fullPaid = fee > 0 && paid >= fee;
  const settledAt = fullPaidAt ? new Date(fullPaidAt) : null;
  const settledInWindow =
    fullPaid &&
    // No timestamp on record means we cannot prove it was late, and the student
    // should not lose a bonus to missing data.
    (!settledAt || Number.isNaN(settledAt.getTime()) || settledAt.getTime() <= windowEnds.getTime());

  return {
    tuitionFee: fee,
    requiredDeposit: deposit,
    totalPaid: paid,
    outstanding: Math.max(0, fee - paid),
    outstandingToStart: Math.max(0, deposit - paid),
    fullPaid,
    depositPaid: paid >= deposit,
    progressPercent: fee > 0 ? Math.min(100, Math.round((paid / fee) * 100)) : 0,
    remainingPercent: fee > 0 ? Math.max(0, 100 - Math.min(100, Math.round((paid / fee) * 100))) : 0,

    windowEndsAt: windowEnds.toISOString(),
    daysLeftInWindow,
    windowOpen,
    bonusEarned: settledInWindow,
    bonusForfeited: !fullPaid && !windowOpen,

    // The office expects the balance by the end of the teaching period.
    balanceDueAt: new Date(enrolMs + weeksOfTeaching * 7 * DAY_MS).toISOString(),

    perWeek: weeksOfTeaching > 0 ? Math.round(fee / weeksOfTeaching) : fee,
    weeksOfTeaching,

    perks: PAY_IN_FULL_PERKS,
  };
}

/**
 * The naira figure to charge for each option, and the wording for each.
 *
 * Mechanism 1 and 2 live here rather than in the page so the copy cannot drift
 * between the checkout, the dashboard nudge and the payments page.
 */
export function paymentOptionsFor(offer: FullPaymentOffer, opts?: { now?: Date }) {
  const now = opts?.now ?? new Date();
  const fullAmount = Math.max(0, offer.tuitionFee - offer.totalPaid);
  const depositAmount = Math.max(0, offer.requiredDeposit - offer.totalPaid);
  const dueDate = new Date(offer.balanceDueAt).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "long",
  });

  /**
   * Bounds for the "choose your own amount" field. `min` is whatever it takes
   * to clear the 60% deposit (the school's enrolment gate); once that is in it
   * drops to MIN_PART_PAYMENT so top-ups are free-form. `max` is the balance —
   * paying it all through this field is just paying in full. The server
   * re-checks all of this in resolvePartialPaymentAmount; these are for the UI.
   */
  const customMax = fullAmount;
  const customMin = depositAmount > 0 ? depositAmount : Math.min(MIN_PART_PAYMENT, customMax);
  const clampToRange = (value: number) => Math.min(customMax, Math.max(customMin, Math.round(value)));
  const custom = {
    min: customMin,
    max: customMax,
    depositFloor: offer.requiredDeposit,
    // Honest waypoints between the 60% floor and the full balance — not
    // discounts, just round fractions of the fee the student can tap instead
    // of doing the arithmetic.
    suggested: Array.from(
      new Set([
        clampToRange(offer.tuitionFee * 0.75 - offer.totalPaid),
        clampToRange(offer.tuitionFee * 0.9 - offer.totalPaid),
      ]),
    ).filter((value) => value > customMin && value < customMax),
    available: customMax > 0,
  };

  return {
    full: {
      id: "full" as const,
      amount: fullAmount,
      /** Anchored on the whole fee — the number every other option refers back to. */
      headline: offer.totalPaid > 0 ? "Clear the balance in full" : "Pay tuition in full",
      subline: `Nothing further to pay for this level. ${offer.perks.length} extras included.`,
      recommended: true,
    },
    deposit: {
      id: "deposit" as const,
      amount: depositAmount,
      /** Named by the debt it leaves, not the 60% it settles. */
      headline: `Part-payment — leaves ₦${(offer.tuitionFee - offer.requiredDeposit).toLocaleString()} owing`,
      subline: `Balance expected by ${dueDate}. Certificate stamped provisional until it is cleared, and reminders start after 14 days.`,
      recommended: false,
      available: depositAmount > 0,
    },
    custom,
    registrationFee: REGISTRATION_FEE,
    windowNote: offer.windowOpen
      ? `${offer.daysLeftInWindow} day${offer.daysLeftInWindow === 1 ? "" : "s"} left to claim the pay-in-full extras`
      : "The pay-in-full extras window has closed for this enrolment",
    now: now.toISOString(),
  };
}

export type BranchFullPaymentRate = { percent: number; sample: number };

/**
 * Mechanism 6 — the honesty rule for the social-proof figure.
 *
 * The query lives in `/api/student/tuition-offer` (it needs prisma, which
 * cannot cross into the browser); this is the gate it applies. A branch with a
 * handful of students produces figures like "100% pay in full" off two people —
 * a claim a student disproves by asking one classmate, taking the credibility
 * of every other number on the page with it.
 */
export function isSocialProofPublishable(sample: number): boolean {
  return sample >= MIN_SOCIAL_PROOF_SAMPLE;
}
