/**
 * "Your level is finished — here is the next one."
 *
 * A student who completes A1 and hears nothing simply stops coming. This is the
 * moment the school either keeps them or loses them, and until now nothing in
 * the portal marked it at all: the promotion report existed for the OFFICE, and
 * the student's own dashboard said nothing.
 *
 * The honesty rules from the pay-in-full work apply here too, because the same
 * people see both and one invented discount would poison the lot:
 *
 *   - no fake urgency. The window is the real gap before the next batch starts.
 *   - no invented discount. The next level costs what the price table says.
 *   - the outstanding balance on the CURRENT level is shown, not hidden. A
 *     student who still owes cannot cleanly advance, and finding that out at
 *     the counter after being told to "continue to A2" is worse than knowing.
 *
 * No prisma import — the dashboard and the modal both read these types.
 */

import { SESSION_MONTHS, WEEKS_OF_TEACHING } from "@/lib/levels";

export type AdvancePerk = {
  label: string;
  detail: string;
};

/**
 * Why continuing straight away is better than coming back in six months.
 *
 * All of these are true of how the school already works — they describe
 * continuity, not a promotion invented to close a sale.
 */
export const ADVANCE_PERKS: AdvancePerk[] = [
  {
    label: "Keep your class, your tutor and your slot",
    detail:
      "Continuing students move up with their cohort. Coming back later means whichever batch has room, with a tutor you have not met.",
  },
  {
    label: "No second registration fee",
    detail: "Registration is paid once. Restarting after a break means paying it again.",
  },
  {
    label: "Your streak, XP and community access carry over",
    detail: "Everything you have built stays. A lapsed account rejoins the community as a new member.",
  },
  {
    label: "Your certificate keeps moving",
    detail:
      "Each completed level adds to your record. Stopping at A1 means an A1 certificate is where your file ends.",
  },
];

export type LevelAdvanceOffer = {
  /** True once the level's teaching months have elapsed. */
  eligible: boolean;
  currentLevel: string;
  nextLevel: string | null;
  /** C2 — finished the ladder, so this is congratulations, not an upsell. */
  atTopOfLadder: boolean;

  branchName: string | null;
  batch: string | null;
  monthsElapsed: number;
  /** How long the student has been finished. Drives the copy's urgency, honestly. */
  monthsSinceFinishing: number;
  sessionMonths: number;
  weeksOfTeaching: number;

  /** Price of the NEXT level at this student's branch. */
  tuitionFee: number;
  requiredDeposit: number;
  /** Fee spread over the teaching weeks — the number that makes it feel affordable. */
  perWeek: number;
  /** False for C1/C2, which the branch office quotes by hand. */
  sellableOnline: boolean;

  /** Still owed on the level they have just finished. Blocks a clean advance. */
  currentLevelOutstanding: number;

  perks: AdvancePerk[];
};

export function perWeekCost(tuitionFee: number, weeks: number = WEEKS_OF_TEACHING): number {
  return Math.round((Number(tuitionFee) || 0) / (weeks || WEEKS_OF_TEACHING));
}

export { SESSION_MONTHS, WEEKS_OF_TEACHING };

/** Money, the way the school writes it. */
export function naira(amount: number): string {
  return `₦${Math.max(0, Math.round(Number(amount) || 0)).toLocaleString()}`;
}

/**
 * The headline the student reads first.
 *
 * Split out so the dashboard card, the modal and the notification email cannot
 * drift apart — three different congratulations for the same event reads like
 * three different schools.
 */
export function advanceHeadline(offer: Pick<LevelAdvanceOffer, "currentLevel" | "nextLevel" | "atTopOfLadder">): string {
  if (offer.atTopOfLadder) return `You have finished ${offer.currentLevel} — the top of the ladder.`;
  return `You have finished ${offer.currentLevel}. ${offer.nextLevel} is next.`;
}

export function advanceSubheading(offer: LevelAdvanceOffer): string {
  if (offer.atTopOfLadder) {
    return "There is no higher level to move up to. Talk to your branch about exam registration and your certificate.";
  }
  if (offer.currentLevelOutstanding > 0) {
    return `Clear the ${naira(offer.currentLevelOutstanding)} still open on ${offer.currentLevel}, and your place in ${offer.nextLevel} is confirmed.`;
  }
  // No per-week figure. EasyWay does not take weekly payments, so quoting one
  // sets an expectation the office then has to argue somebody out of.
  return `${offer.nextLevel} runs for ${offer.sessionMonths} months — ${offer.weeksOfTeaching} weeks of teaching.`;
}
