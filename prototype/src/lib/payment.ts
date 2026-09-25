export type PaymentStatus = "Pending" | "Partial" | "Completed";

/**
 * `Payment.status` is a per-TRANSACTION lifecycle field, distinct from the
 * per-STUDENT aggregate that `derivePaymentStatus` returns (capitalised
 * `PaymentStatus` above).
 *
 *   pending    recorded but the money is not in yet
 *   partial    a cleared DEPOSIT — the 60% the school enrols on. The cash is
 *              real and counts towards everything, but the student still owes
 *              the balance, so the ledger keeps it visually distinct from a
 *              fully-settled account.
 *   completed  a cleared payment that settles the account (full fee, or a
 *              registration fee, or the balance after a deposit)
 *   failed     the charge did not go through
 *
 * `partial` and `completed` are the two statuses that mean "money received".
 * Every sum of what a student has paid must count BOTH — see
 * `receivedPaymentFilter` / `isReceivedPayment`, which are the single source
 * of truth for that set.
 */
export const PAYMENT_STATUSES = ["pending", "partial", "completed", "failed"] as const;
export type TransactionStatus = (typeof PAYMENT_STATUSES)[number];

export const RECEIVED_PAYMENT_STATUSES: string[] = ["completed", "partial"];

/**
 * Prisma `where` fragment: payments that count towards a student's paid total
 * **for tuition** — received status AND not the ₦5,000 registration fee.
 *
 * The registration fee is recorded as its own `completed` Payment (see
 * `REGISTRATION_PAYMENT_DESCRIPTION_PREFIX` below) so the portal never
 * re-charges it, but it is not tuition: counting it netted ₦5,000 off every
 * ref-signup student's balance and pushed them ₦5,000 toward the deposit gate
 * the instant they signed up. Every deposit / balance / "paid in full" / lock
 * calculation reads through this, so excluding it here fixes all of them.
 *
 * For "how much cash actually arrived" (the accountant's revenue trend) use
 * `allReceivedPaymentFilter()` instead — that one keeps the registration fee.
 *
 * A getter, so every call site receives a fresh plain object — a shared
 * `as const` literal is a readonly tuple that Prisma's `in` type rejects, and a
 * shared mutable singleton risks being spread into and mutated.
 */
export function receivedPaymentFilter() {
  return {
    status: { in: [...RECEIVED_PAYMENT_STATUSES] },
    // NULL-safe exclusion: `{ not: { startsWith } }` alone drops rows with a
    // NULL description (front-desk cash entries often have none), which would
    // wrongly un-count real tuition. The explicit `null` arm keeps them.
    OR: [
      { description: null },
      { description: { not: { startsWith: REGISTRATION_PAYMENT_DESCRIPTION_PREFIX } } },
    ],
  };
}

/**
 * Received payments of EVERY kind, registration fee included — for cash-in
 * reporting where the question is "what money came in", not "what has this
 * student paid toward tuition".
 */
export function allReceivedPaymentFilter() {
  return { status: { in: [...RECEIVED_PAYMENT_STATUSES] } };
}

/**
 * In-memory status check — is this a received (completed / partial) payment?
 * Status ONLY: unlike `receivedPaymentFilter` it says nothing about whether the
 * row is a registration fee, so a caller summing tuition must also test
 * `!isRegistrationFeePayment(description)` (or use `isTuitionPayment`).
 */
export function isReceivedPayment(status?: string | null): boolean {
  return RECEIVED_PAYMENT_STATUSES.includes(String(status ?? ""));
}

export function isValidPaymentStatus(status: unknown): status is TransactionStatus {
  return typeof status === "string" && (PAYMENT_STATUSES as readonly string[]).includes(status);
}

/**
 * REGISTRATION FEE IS NOT TUITION.
 *
 * The ₦5,000 registration fee is paid on the marketing site before the student
 * has an LMS account, then mirrored into the LMS as a `completed` Payment so the
 * portal never asks for it again (`recordRegistrationFeeFromRef`, and the
 * `registration` branch of `persistPaystackTransaction` — both in
 * src/lib/paystack-verify.ts). Every one of those writers sets `description` to
 * exactly `Registration fee for <pathway>`.
 *
 * That row must never net down a tuition balance, move the "paid in full" line,
 * or count toward the 60% deposit gate. Before this guard existed, a
 * ref-signup student showed ₦145,000 outstanding on a ₦150,000 fee and ₦5,000
 * "toward the deposit" the moment they signed up. So every sum of what a
 * student has paid TOWARD TUITION excludes these rows, via the `where` fragment
 * or the in-memory predicate below.
 */
export const REGISTRATION_PAYMENT_DESCRIPTION_PREFIX = "Registration fee";

export function isRegistrationFeePayment(description?: string | null): boolean {
  return String(description ?? "").startsWith(REGISTRATION_PAYMENT_DESCRIPTION_PREFIX);
}

/**
 * Prisma `where` fragment: drop registration-fee rows from a tuition sum,
 * NULL-safe (see the note in `receivedPaymentFilter`). A getter, for the same
 * reason `receivedPaymentFilter` is one. Spread it into a `where` alongside a
 * status filter; do not combine with a sibling `OR`.
 */
export function excludeRegistrationFeeWhere() {
  return {
    OR: [
      { description: null },
      { description: { not: { startsWith: REGISTRATION_PAYMENT_DESCRIPTION_PREFIX } } },
    ],
  };
}

/** In-memory: does this payment count toward a student's TUITION total? */
export function isTuitionPayment(payment: { status?: string | null; description?: string | null }): boolean {
  return isReceivedPayment(payment.status) && !isRegistrationFeePayment(payment.description);
}

/**
 * Tuition pricing.
 *
 * Two things decide a fee: the level and the BRANCH. Abuja charges more than
 * Lagos and Port Harcourt for the same level, so a level-only lookup silently
 * undercharges every Abuja student by ₦20,000–₦30,000. That is why the public
 * API here takes a branch and there is no level-only shortcut — if a call site
 * genuinely has no branch it has to say so with `branch: null`, which is a
 * deliberate choice rather than a forgotten argument.
 *
 * This table used to be copy-pasted into seven files. A price change had to be
 * made in all of them or the portal quoted two different fees for one level.
 * Everything now reads from here.
 */

import { getActivePriceBook, type FeeTier, type PriceBook } from "@/lib/price-book";

export type { FeeTier };

/**
 * Branch name → fee tier. Matched on a normalised substring rather than an
 * exact name because branches are created by hand in the admin ("Abuja",
 * "Abuja Branch", "EasyWay Abuja" have all been typed at some point).
 * Anything unrecognised falls to `standard`, which is the cheaper of the two
 * campus tiers — a misspelled branch undercharges rather than overcharges, and
 * an office chasing ₦20k is a better failure than a student overbilled at
 * checkout.
 */
const PREMIUM_BRANCH_KEYWORDS = ["abuja"] as const;
const ONLINE_BRANCH_KEYWORDS = ["online", "virtual", "remote"] as const;

/**
 * THE PRICES THEMSELVES ARE NOT IN THIS FILE.
 *
 * Group tuition per tier and level, private (one-to-one) tuition per level, and
 * the Travel Package price all live in the price book — see price-book.ts. The
 * office edits them on /admin/settings/pricing and they go live within seconds,
 * with no deploy. `DEFAULT_PRICE_BOOK` holds only what applies until somebody
 * saves a change.
 *
 * Every lookup below takes an optional `book`, and otherwise reads the ACTIVE
 * book: the server keeps that fresh from the database (price-book-refresh.ts)
 * and the browser fills it from /api/pricing (use-price-book.ts). Pass a book
 * explicitly only in tests, or when the caller already holds one.
 *
 * There is deliberately no exported price constant any more. One used to exist
 * (`PRIVATE_CLASS_UPGRADE_PRICE`), and anything importing it would have kept
 * quoting the old number after an edit. Ask for a price by level instead.
 *
 * The rule that made the earlier flat-price change necessary still holds: a
 * QUOTED price and a BILLED price must come from the same lookup. The upsell
 * card, the paywall's second option, the checkout and the ledger charge all
 * call `privateClassPriceForLevel`, so they cannot disagree.
 */

/** Online-tier prices were confirmed for launch (2026-09), no longer provisional. */
export const ONLINE_PRICES_ARE_PLACEHOLDER = false;

/**
 * PRIVATE (one-to-one) TUITION — priced by level, whatever the branch.
 *
 * A level with no entry of its own (junk input, retired C2) falls back to the
 * C1 price, the top of the ladder, so an advanced level is never under-quoted —
 * the same rule the group table follows.
 */
export function privateClassPriceForLevel(level?: string | null, book: PriceBook = getActivePriceBook()): number {
  return book.private[normaliseLevel(level)] ?? book.private.C1;
}

/** Private tuition price was confirmed for launch (2026-09), no longer provisional. */
export const PRIVATE_PRICES_ARE_PLACEHOLDER = false;

/**
 * TRAVEL PACKAGE — a premium, admin-onboarded-only product that REPLACES the
 * per-level tuition ladder entirely, not a level on top of it. One flat price
 * covers the whole program, whatever level or branch the student is in, so a
 * Travel Package student never also owes A1/A2/B1/... fees. The minimum first
 * payment is a flat floor rather than the usual 60% deposit — after that floor
 * is met, top-ups are free-form down to MIN_PART_PAYMENT like any other
 * account. There is no self-service checkout for this pathway; staff set
 * `Student.pathway` to this value by hand in the admin. Both figures are in the
 * price book (default ₦980,000 / ₦200,000).
 */
export const TRAVEL_PACKAGE_PATHWAY = "Travel Package";

/** The flat Travel Package price, from the price book. */
export function travelPackagePrice(book: PriceBook = getActivePriceBook()): number {
  return book.travelPackage.price;
}

/** The smallest first payment that opens a Travel Package student's portal. */
export function travelPackageMinFirstPayment(book: PriceBook = getActivePriceBook()): number {
  return book.travelPackage.minFirstPayment;
}

export function isTravelPackagePathway(pathway?: string | null): boolean {
  return String(pathway ?? "").trim().toLowerCase() === TRAVEL_PACKAGE_PATHWAY.toLowerCase();
}

/**
 * EXAM PREPARATORY — its own per-level ladder (A1–B2, see price-book.ts),
 * layered on top of the ordinary group/private fee the same way Travel
 * Package overrides it, just level-keyed instead of flat. A student on this
 * pathway pays this table's figure for their level regardless of branch or
 * class type; the ₦5,000 registration fee and the signup workflow are
 * unchanged — this only changes which number `tuitionFeeFor` returns.
 */
export const EXAM_PREPARATORY_PATHWAY = "Exam Preparatory";

export function isExamPreparatoryPathway(pathway?: string | null): boolean {
  return String(pathway ?? "").trim().toLowerCase() === EXAM_PREPARATORY_PATHWAY.toLowerCase();
}

/**
 * A level outside A1–B2 (junk input, or a level this package does not run)
 * falls back to the B2 price, the top of this ladder — same rule
 * `privateClassPriceForLevel` follows against C1.
 */
export function examPreparatoryPriceForLevel(level?: string | null, book: PriceBook = getActivePriceBook()): number {
  return book.examPrep[normaliseLevel(level)] ?? book.examPrep.B2;
}

/**
 * Levels a student may buy through the portal. A1–C1 are all self-service now —
 * C1 runs as private / online tuition at the flat ₦350,000 in FEE_TABLE. C2 is
 * retired: not offered (see OFFERED_LEVELS in levels.ts) and not sold here.
 */
export const SELLABLE_LEVELS = ["A1", "A2", "B1", "B2", "C1"] as const;

export const REGISTRATION_FEE = 5000;

/** Share of tuition that must be paid before classes open. */
export const DEPOSIT_RATE = 0.6;

/**
 * Smallest top-up we will take once the 60% deposit is already in. A student
 * past the gate can pay any amount toward the balance, but a ₦5 "payment" is
 * just noise in the ledger and below what Paystack itself will process.
 */
export const MIN_PART_PAYMENT = 1000;

export function isLevelSellable(level?: string | null): boolean {
  return (SELLABLE_LEVELS as readonly string[]).includes(normaliseLevel(level));
}

function normaliseLevel(level?: string | null): string {
  return String(level ?? "").trim().toUpperCase();
}

export function feeTierForBranch(branchName?: string | null): FeeTier {
  const name = String(branchName ?? "").toLowerCase();
  // Online is checked first: a branch named "Abuja (Online)" is an online
  // cohort that happens to be run by the Abuja team, not a premium campus
  // seat, and charging it the campus rate would be wrong in the expensive
  // direction.
  if (ONLINE_BRANCH_KEYWORDS.some((keyword) => name.includes(keyword))) return "online";
  return PREMIUM_BRANCH_KEYWORDS.some((keyword) => name.includes(keyword)) ? "premium" : "standard";
}

export type FeeLookup = {
  level?: string | null;
  /** Branch name. Pass `null` explicitly when the caller truly has no branch. */
  branch?: string | null;
  /**
   * group | private. Optional, and omitting it means group — so every call
   * site written before private tuition existed keeps quoting what it did.
   */
  classType?: string | null;
  /**
   * `Student.pathway` — "Travel Package" overrides the entire fee below with
   * a flat price; "Exam Preparatory" overrides it with its own per-level
   * ladder.
   */
  pathway?: string | null;
};

export function isPrivateClassType(classType?: string | null): boolean {
  return String(classType ?? "").trim().toLowerCase() === "private";
}

export function tuitionFeeFor(
  { level, branch, classType, pathway }: FeeLookup,
  book: PriceBook = getActivePriceBook(),
): number {
  // Travel Package is a flat whole-program price that replaces the per-level
  // ladder outright, so it is checked before even the private-class price.
  if (isTravelPackagePathway(pathway)) return travelPackagePrice(book);

  // Exam Preparatory has its own per-level ladder that overrides the ordinary
  // group/private fee for its level, the same way Travel Package overrides —
  // checked next, and before the private-class branch, since a pathway is a
  // stronger signal than delivery mode.
  if (isExamPreparatoryPathway(pathway)) return examPreparatoryPriceForLevel(level, book);

  // One-to-one is priced by level at every branch — the same figure the upsell
  // quotes and the checkout charges (see the note at the top of this section).
  if (isPrivateClassType(classType)) return privateClassPriceForLevel(level, book);

  const tier = book.group[feeTierForBranch(branch)];
  // A level not in the table is either junk input or retired C2. Fall back to
  // the C1 price rather than A1 so an advanced level is never under-quoted.
  return tier[normaliseLevel(level)] ?? tier.C1 ?? tier.A1;
}

export function requiredDepositFor(lookup: FeeLookup, book: PriceBook = getActivePriceBook()): number {
  // Travel Package's minimum first payment is a flat floor, not 60% of the
  // package price — this must short-circuit BEFORE the multiply.
  if (isTravelPackagePathway(lookup.pathway)) return travelPackageMinFirstPayment(book);
  return Math.round(tuitionFeeFor(lookup, book) * DEPOSIT_RATE);
}

const naira = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;

export type PartialPaymentResolution =
  | { ok: true; amount: number; settlesAccount: boolean }
  | { ok: false; error: string };

/**
 * THE ONE GATE FOR A STUDENT-CHOSEN PART-PAYMENT AMOUNT.
 *
 * A student may now type how much of their tuition to pay, not just take the
 * 60% deposit. This decides what that request is actually worth, and it is the
 * only thing standing between "pay what you like" and "pay less than the 60%
 * the school enrols on".
 *
 * Rules, in order:
 *   - The account must have something outstanding. Nothing owing → reject.
 *   - CEILING: never more than the balance. A request over it is clamped down,
 *     not rejected — paying the whole balance through this field is fine.
 *   - FLOOR: on the payment that has to clear the 60% gate (i.e. the running
 *     total is still under the deposit), the request must at least reach it.
 *     Anything short is rejected with a message that states the figure. Once
 *     the deposit is in, the floor drops to MIN_PART_PAYMENT so top-ups are
 *     free-form.
 *
 * Every figure is caller-supplied and must be SERVER-DERIVED from the student's
 * own level, branch and payment history — never a number off the request body.
 * `requestedAmount` is the only client value, and it is treated purely as a
 * ceiling-clamped ask that has to clear the floor.
 */
export function resolvePartialPaymentAmount({
  requestedAmount,
  tuitionFee,
  requiredDeposit,
  alreadyPaid,
}: {
  requestedAmount: unknown;
  tuitionFee: number;
  requiredDeposit: number;
  alreadyPaid: number;
}): PartialPaymentResolution {
  const fee = Math.max(0, Math.round(Number(tuitionFee) || 0));
  const deposit = Math.min(fee, Math.max(0, Math.round(Number(requiredDeposit) || 0)));
  const paid = Math.max(0, Math.round(Number(alreadyPaid) || 0));
  const requested = Math.max(0, Math.round(Number(requestedAmount) || 0));

  const outstanding = Math.max(0, fee - paid);
  if (outstanding <= 0) {
    return { ok: false, error: "There is nothing outstanding on your tuition for this level." };
  }

  const depositShortfall = Math.max(0, deposit - paid);
  const floor = depositShortfall > 0 ? depositShortfall : Math.min(MIN_PART_PAYMENT, outstanding);

  if (requested < floor) {
    const reason =
      depositShortfall > 0
        ? `The smallest payment we can accept right now is ${naira(floor)} — that brings you to the ${Math.round(
            DEPOSIT_RATE * 100,
          )}% deposit (${naira(deposit)} of ${naira(fee)}) the school starts classes on. To arrange anything less, please speak to your branch office.`
        : `The smallest top-up we can accept is ${naira(floor)}.`;
    return { ok: false, error: reason };
  }

  const amount = Math.min(requested, outstanding);
  return { ok: true, amount, settlesAccount: paid + amount >= fee };
}

/** Every level and its price at one branch — for checkout and admin price lists. */
export function priceListForBranch(
  branchName?: string | null,
  classType?: string | null,
  book: PriceBook = getActivePriceBook(),
) {
  const tier = feeTierForBranch(branchName);
  const isPrivate = isPrivateClassType(classType);
  return Object.entries(book.group[tier]).map(([level, groupFee]) => {
    // Private has its own price per level, not a scaled group fee.
    const fee = isPrivate ? privateClassPriceForLevel(level, book) : groupFee;
    return {
      level,
      tuitionFee: fee,
      requiredDeposit: Math.round(fee * DEPOSIT_RATE),
      sellable: isLevelSellable(level),
      tier,
    };
  });
}

export function derivePaymentStatus({
  totalPaid,
  tuitionFee,
  requiredDeposit,
}: {
  totalPaid: number;
  tuitionFee: number;
  requiredDeposit: number;
}): {
  status: PaymentStatus;
  fullPaid: boolean;
  depositPaid: boolean;
  paymentProgressPercent: number;
  requiredDeposit: number;
  tuitionFee: number;
  totalPaid: number;
} {
  const normalizedTuitionFee = Math.max(0, Math.round(Number(tuitionFee) || 0));
  const normalizedRequiredDeposit = Math.max(0, Math.round(Number(requiredDeposit) || 0));
  const normalizedTotalPaid = Math.max(0, Math.round(Number(totalPaid) || 0));
  const fullPaid = normalizedTotalPaid >= normalizedTuitionFee;
  const depositPaid = normalizedTotalPaid >= normalizedRequiredDeposit;
  const paymentStatus: PaymentStatus = fullPaid ? "Completed" : depositPaid ? "Partial" : "Pending";
  const paymentProgressPercent = normalizedTuitionFee > 0
    ? Math.min(100, Math.round((normalizedTotalPaid / normalizedTuitionFee) * 100))
    : 0;

  return {
    status: paymentStatus,
    fullPaid,
    depositPaid,
    paymentProgressPercent,
    requiredDeposit: normalizedRequiredDeposit,
    tuitionFee: normalizedTuitionFee,
    totalPaid: normalizedTotalPaid,
  };
}

export function classifyPaymentTransaction({
  paymentAmount,
  totalAmount,
  tuitionFee,
  depositPercent,
  paymentStage,
  paymentType,
}: {
  paymentAmount: number;
  totalAmount: number;
  tuitionFee?: number;
  depositPercent?: number;
  paymentStage?: string;
  paymentType?: string;
}) {
  const normalizedPaymentAmount = Math.max(0, Math.round(Number(paymentAmount) || 0));
  const normalizedTotalAmount = Math.max(0, Math.round(Number(totalAmount) || 0));
  const normalizedTuitionFee = Math.max(0, Math.round(Number(tuitionFee) || 0));
  const normalizedDepositPercent = Math.min(100, Math.max(0, Number(depositPercent) || 100));
  const explicitStage = String(paymentStage || paymentType || "").toLowerCase();
  const fullThreshold = normalizedTuitionFee > 0 ? normalizedTuitionFee : Math.max(normalizedTotalAmount, normalizedPaymentAmount);
  const isFullPayment = explicitStage === "full" || normalizedPaymentAmount >= fullThreshold;
  const effectivePaymentType = explicitStage === "registration"
    ? "registration"
    : isFullPayment
    ? "full"
    : explicitStage === "deposit" || normalizedDepositPercent < 100
    ? "deposit"
    : "full";
  const invoiceStatus = isFullPayment ? "paid" : "partial";

  return {
    paymentType: effectivePaymentType,
    invoiceStatus,
    depositPercent: normalizedDepositPercent,
    isFullPayment,
    fullThreshold,
  };
}
