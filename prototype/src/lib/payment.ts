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

export type FeeTier = "premium" | "standard" | "online";

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
 * Prices confirmed 2026-09 for the live launch. A1–B2 vary by tier; C1 is a
 * flat ₦350,000 at every branch (it runs as private / online tuition). C2 is
 * retired — not offered (see OFFERED_LEVELS in levels.ts) and deliberately not
 * priced here. Edit ONLY this table: checkout, the paywall, admin price lists,
 * invoices and reminder emails all read from it.
 */
const FEE_TABLE: Record<FeeTier, Record<string, number>> = {
  // Abuja
  premium: {
    A1: 180000,
    A2: 180000,
    B1: 200000,
    B2: 200000,
    C1: 350000,
  },
  // Lagos, Port Harcourt, Ghana, and any campus branch added later
  standard: {
    A1: 150000,
    A2: 150000,
    B1: 180000,
    B2: 180000,
    C1: 350000,
  },
  // Online cohort. A1–B2 currently match the standard campus tier.
  online: {
    A1: 150000,
    A2: 150000,
    B1: 180000,
    B2: 180000,
    C1: 350000,
  },
};

/** Online-tier prices were confirmed for launch (2026-09), no longer provisional. */
export const ONLINE_PRICES_ARE_PLACEHOLDER = false;

/**
 * PRIVATE (one-to-one) TUITION — ONE FLAT PRICE.
 *
 * ₦350,000 whatever the branch and whatever the level (confirmed 2026-09).
 * Change this constant and the upsell card, the paywall's second option, the
 * checkout, the webhook and the receivables ledger all follow — it is the
 * single number private tuition is worth anywhere in the app.
 *
 * ---------------------------------------------------------------------------
 * THIS REPLACED A 2x MULTIPLIER, and the two could not coexist.
 *
 * `tuitionFeeFor` used to price private tuition at twice the group fee for that
 * branch and level, which is ₦300,000 in Lagos but ₦360,000 in Abuja and up to
 * ₦480,000 at C2. The upsell advertised a flat ₦300,000 and the checkout
 * charged it. So an Abuja student paid exactly what they were shown and the
 * ledger still recorded them ₦60,000 short: a permanent outstanding balance
 * they could not clear, fee-chaser emails they did not deserve, and a
 * PROVISIONAL stamp on their certificate — because that stamp reads the live
 * balance.
 *
 * A quoted price and a billed price that disagree is not a pricing question,
 * it is a bug that only appears at one branch. One number now serves both.
 * ---------------------------------------------------------------------------
 */
export const PRIVATE_CLASS_UPGRADE_PRICE = 350000;

/** Private tuition price was confirmed for launch (2026-09), no longer provisional. */
export const PRIVATE_PRICES_ARE_PLACEHOLDER = false;

/**
 * TRAVEL PACKAGE — a premium, admin-onboarded-only product that REPLACES the
 * per-level tuition ladder entirely, not a level on top of it. One flat
 * ₦980,000 covers the whole program, whatever level or branch the student is
 * in, so a Travel Package student never also owes A1/A2/B1/... fees. The
 * minimum first payment is ₦200,000 rather than the usual 60% deposit — after
 * that floor is met, top-ups are free-form down to MIN_PART_PAYMENT like any
 * other account. There is no self-service checkout for this pathway; staff
 * set `Student.pathway` to this value by hand in the admin.
 */
export const TRAVEL_PACKAGE_PATHWAY = "Travel Package";
export const TRAVEL_PACKAGE_PRICE = 980000;
export const TRAVEL_PACKAGE_MIN_FIRST_PAYMENT = 200000;

export function isTravelPackagePathway(pathway?: string | null): boolean {
  return String(pathway ?? "").trim().toLowerCase() === TRAVEL_PACKAGE_PATHWAY.toLowerCase();
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
  /** `Student.pathway` — "Travel Package" overrides the entire fee below. */
  pathway?: string | null;
};

export function isPrivateClassType(classType?: string | null): boolean {
  return String(classType ?? "").trim().toLowerCase() === "private";
}

export function tuitionFeeFor({ level, branch, classType, pathway }: FeeLookup): number {
  // Travel Package is a flat whole-program price that replaces the per-level
  // ladder outright, so it is checked before even the private-class price.
  if (isTravelPackagePathway(pathway)) return TRAVEL_PACKAGE_PRICE;

  // One flat price for one-to-one, at every branch and every level — the same
  // figure the upsell quotes and the checkout charges. See the note on
  // PRIVATE_CLASS_UPGRADE_PRICE for why these must not be computed separately.
  if (isPrivateClassType(classType)) return PRIVATE_CLASS_UPGRADE_PRICE;

  const tier = FEE_TABLE[feeTierForBranch(branch)];
  // A level not in the table is either junk input or retired C2. Fall back to
  // the C1 price rather than A1 so an advanced level is never under-quoted.
  return tier[normaliseLevel(level)] ?? tier.C1 ?? tier.A1;
}

export function requiredDepositFor(lookup: FeeLookup): number {
  // Travel Package's minimum first payment is a flat floor, not 60% of the
  // ₦980,000 package price — this must short-circuit BEFORE the multiply.
  if (isTravelPackagePathway(lookup.pathway)) return TRAVEL_PACKAGE_MIN_FIRST_PAYMENT;
  return Math.round(tuitionFeeFor(lookup) * DEPOSIT_RATE);
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
export function priceListForBranch(branchName?: string | null, classType?: string | null) {
  const tier = feeTierForBranch(branchName);
  const isPrivate = isPrivateClassType(classType);
  return Object.entries(FEE_TABLE[tier]).map(([level, groupFee]) => {
    // Private is one flat price per level, not a scaled group fee.
    const fee = isPrivate ? PRIVATE_CLASS_UPGRADE_PRICE : groupFee;
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
