export type PaymentStatus = "Pending" | "Partial" | "Completed";

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

const FEE_TABLE: Record<FeeTier, Record<string, number>> = {
  // Abuja
  premium: {
    A1: 180000,
    A2: 180000,
    B1: 200000,
    B2: 200000,
    C1: 220000,
    C2: 240000,
  },
  // Lagos, Port Harcourt, and any campus branch added later
  standard: {
    A1: 150000,
    A2: 150000,
    B1: 180000,
    B2: 180000,
    C1: 200000,
    C2: 220000,
  },
  // ---------------------------------------------------------------------
  // ONLINE BRANCH — PLACEHOLDER PRICES.
  //
  // These numbers are a template, NOT a decision. They sit ~10% under the
  // standard campus tier on the reasoning that there is no campus overhead to
  // pass on, which is the usual shape, but nobody has signed off on them.
  //
  // To set the real prices, edit ONLY this block. Every quote in the app —
  // checkout, the paywall, admin price lists, invoices, reminder emails —
  // reads from here, so there is nowhere else to change.
  // ---------------------------------------------------------------------
  online: {
    A1: 135000,
    A2: 135000,
    B1: 160000,
    B2: 160000,
    C1: 180000,
    C2: 200000,
  },
};

/** True while the online tier is still carrying the placeholder numbers above. */
export const ONLINE_PRICES_ARE_PLACEHOLDER = true;

/**
 * PRIVATE (one-to-one) TUITION — ONE FLAT PRICE, PLACEHOLDER FIGURE.
 *
 * ₦300,000 whatever the branch and whatever the level, quoted by the school
 * pending a real table. Change this constant and the upsell card, the paywall's
 * second option, the checkout, the webhook and the receivables ledger all
 * follow — it is the single number private tuition is worth anywhere in the app.
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
export const PRIVATE_CLASS_UPGRADE_PRICE = 300000;

/** True while private tuition is still carrying the placeholder figure above. */
export const PRIVATE_PRICES_ARE_PLACEHOLDER = true;

/**
 * Levels a student may buy through the portal. C1 and C2 are quoted by the
 * branch office for now, so they are priced in FEE_TABLE (the paywall still
 * needs a number for a C1 student who was enrolled by hand) but kept out of
 * self-service checkout.
 */
export const SELLABLE_LEVELS = ["A1", "A2", "B1", "B2"] as const;

export const REGISTRATION_FEE = 5000;

/** Share of tuition that must be paid before classes open. */
export const DEPOSIT_RATE = 0.6;

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
};

export function isPrivateClassType(classType?: string | null): boolean {
  return String(classType ?? "").trim().toLowerCase() === "private";
}

export function tuitionFeeFor({ level, branch, classType }: FeeLookup): number {
  // One flat price for one-to-one, at every branch and every level — the same
  // figure the upsell quotes and the checkout charges. See the note on
  // PRIVATE_CLASS_UPGRADE_PRICE for why these must not be computed separately.
  if (isPrivateClassType(classType)) return PRIVATE_CLASS_UPGRADE_PRICE;

  const tier = FEE_TABLE[feeTierForBranch(branch)];
  return tier[normaliseLevel(level)] ?? tier.A1;
}

export function requiredDepositFor(lookup: FeeLookup): number {
  return Math.round(tuitionFeeFor(lookup) * DEPOSIT_RATE);
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
