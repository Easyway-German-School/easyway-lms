import { prisma } from "@/lib/prisma";
import {
  isLevelSellable,
  receivedPaymentFilter,
  REGISTRATION_FEE,
  requiredDepositFor,
  resolvePartialPaymentAmount,
  tuitionFeeFor,
} from "@/lib/payment";
import { nextLevelAfter } from "@/lib/levels";
import { loadStudentLedger } from "@/lib/tuition-charges";

/**
 * THE ONE PLACE A TUITION CHECKOUT AMOUNT IS DERIVED.
 *
 * The client picks a STAGE — full, deposit, custom or registration — and nothing
 * more. It must never be able to send the naira figure: anyone could otherwise
 * post `amount: 100, paymentStage: "full"` from devtools and be recorded as
 * having settled their tuition. Everything below is computed from the student's
 * own level, branch and payment history, which is also the only way the Abuja
 * premium is enforced.
 *
 * This logic used to live inline in `/api/paystack/initialize`. It is a lib now
 * because there are two payment gateways (Paystack for Nigeria, Flutterwave for
 * international cards) and a second copy of price derivation is a second place
 * for a pricing rule change to be missed — which in this codebase means an
 * undercharge that surfaces months later as a stuck "PROVISIONAL" certificate.
 * Both `/api/paystack/initialize` and `/api/flutterwave/initialize` call this.
 *
 * The PRIVATE class upgrade and exam fees are deliberately NOT handled here —
 * they are flat, server-fixed prices with no stages, deposit or pathway
 * enrolment, and each gateway route handles them directly.
 */

export type ResolvedCheckout = {
  studentId: string;
  /** The level actually being billed (the next level, on a next-level checkout). */
  billingLevel: string | null;
  /** Naira to charge on THIS transaction, including any prior balance rolled in. */
  amountToCharge: number;
  /** After re-labelling a "custom" amount — one of registration | deposit | full. */
  effectivePaymentType: "registration" | "deposit" | "full";
  /** The level's full tuition fee, for the receipt / invoice total. */
  normalizedTuitionFee: number;
  /** The bar this payment is measured against — the deposit, or the full fee. */
  requiredThreshold: number;
  /** Running total after this payment, as a whole-number percent of the fee. */
  normalizedDepositPercent: number;
  /** A real Pathway row id, or "" — never a display name (breaks the FK on verify). */
  resolvedPathwayId: string;
  /** Free-text programme name, only ever used to word the receipt. */
  pathwayName: string;
  forNextLevel: boolean;
  /** On a next-level checkout also clearing an old balance: the split to show. */
  breakdown:
    | { level: string | null; amount: number; purpose: "outstanding balance" | "balance" | "deposit" }[]
    | null;
};

export type ResolveCheckoutInput = {
  userId: string;
  body: {
    pathwayId?: unknown;
    pathwayName?: unknown;
    paymentStage?: unknown;
    stage?: unknown;
    forNextLevel?: unknown;
    amount?: unknown;
  } | null;
};

export type ResolveCheckoutResult =
  | { ok: true; checkout: ResolvedCheckout }
  | { ok: false; error: string; status: number };

export async function resolveTuitionCheckout({
  userId,
  body,
}: ResolveCheckoutInput): Promise<ResolveCheckoutResult> {
  const { pathwayId, pathwayName } = body ?? {};
  const requestedStage = String(body?.paymentStage ?? body?.stage ?? "full").toLowerCase();
  const forNextLevel = Boolean(body?.forNextLevel);

  const studentRecord = await prisma.student.findUnique({
    where: { userId },
    select: {
      id: true,
      level: true,
      classType: true,
      pathway: true,
      levelCompletedFor: true,
      levelCompletedAt: true,
      branch: { select: { name: true } },
      payments: { where: receivedPaymentFilter(), select: { amount: true } },
    },
  });

  if (!studentRecord) {
    return { ok: false, error: "No student record to bill", status: 404 };
  }

  let billingLevel = studentRecord.level;
  let alreadyPaid = studentRecord.payments.reduce((sum, payment) => sum + payment.amount, 0);
  let priorOpenBalance = 0;
  let priorOwedLevel: string | null = null;

  if (forNextLevel) {
    if (studentRecord.levelCompletedFor !== studentRecord.level || !studentRecord.levelCompletedAt) {
      return {
        ok: false,
        error: "Your level has not been signed off yet — nothing to continue to.",
        status: 409,
      };
    }

    const target = nextLevelAfter(studentRecord.level);
    if (!target) {
      return { ok: false, error: "You are already at the top of the ladder.", status: 409 };
    }

    billingLevel = target;

    const ledger = await loadStudentLedger(studentRecord.id);
    const priorLines = ledger.lines.filter(
      (line) => line.outstanding > 0 && !line.legacyArrears && line.level !== target,
    );
    priorOpenBalance = priorLines.reduce((sum, line) => sum + line.outstanding, 0);
    priorOwedLevel = priorLines[0]?.level ?? null;
    const targetLine = ledger.lines.find((line) => line.level === target);
    alreadyPaid = targetLine ? targetLine.allocated : 0;
  }

  const feeLookup = {
    level: billingLevel,
    branch: studentRecord.branch?.name ?? null,
    classType: studentRecord.classType,
    pathway: studentRecord.pathway,
  };
  const normalizedTuitionFee = tuitionFeeFor(feeLookup);
  const requiredDeposit = requiredDepositFor(feeLookup);

  if (requestedStage !== "registration" && !isLevelSellable(billingLevel)) {
    return {
      ok: false,
      error: `${billingLevel} tuition is quoted by your branch office rather than the portal. Please contact them to pay.`,
      status: 409,
    };
  }

  const isCustom = requestedStage === "custom";
  let effectivePaymentType: "registration" | "deposit" | "full";
  let amountToCharge: number;

  if (requestedStage === "registration") {
    effectivePaymentType = "registration";
    amountToCharge = REGISTRATION_FEE;
  } else if (isCustom) {
    const resolved = resolvePartialPaymentAmount({
      requestedAmount: body?.amount,
      tuitionFee: normalizedTuitionFee,
      requiredDeposit,
      alreadyPaid,
    });
    if (!resolved.ok) {
      return { ok: false, error: resolved.error, status: 409 };
    }
    amountToCharge = resolved.amount;
    effectivePaymentType = resolved.settlesAccount ? "full" : "deposit";
  } else if (requestedStage === "deposit") {
    effectivePaymentType = "deposit";
    amountToCharge = Math.max(0, requiredDeposit - alreadyPaid);
  } else {
    effectivePaymentType = "full";
    amountToCharge = Math.max(0, normalizedTuitionFee - alreadyPaid);
  }

  const targetPortion = amountToCharge;
  amountToCharge = amountToCharge + priorOpenBalance;

  const breakdown =
    forNextLevel && priorOpenBalance > 0
      ? [
          {
            level: priorOwedLevel,
            amount: priorOpenBalance,
            purpose: "outstanding balance" as const,
          },
          {
            level: billingLevel,
            amount: targetPortion,
            purpose: (effectivePaymentType === "full" ? "balance" : "deposit") as "balance" | "deposit",
          },
        ]
      : null;

  if (amountToCharge <= 0) {
    return {
      ok: false,
      error: "There is nothing outstanding on your tuition for this level.",
      status: 409,
    };
  }

  const normalizedDepositPercent =
    effectivePaymentType === "full"
      ? 100
      : Math.max(
          1,
          Math.min(
            100,
            Math.round(((alreadyPaid + amountToCharge) / Math.max(1, normalizedTuitionFee)) * 100),
          ),
        );
  const requiredThreshold = effectivePaymentType === "deposit" ? requiredDeposit : normalizedTuitionFee;

  const resolvedPathway = await prisma.pathway.findFirst({
    where: {
      OR: [
        { id: String(pathwayId || "") },
        { name: (pathwayName as string) || "" },
        { name: String(pathwayId || "") },
      ],
    },
  });

  return {
    ok: true,
    checkout: {
      studentId: studentRecord.id,
      billingLevel,
      amountToCharge,
      effectivePaymentType,
      normalizedTuitionFee,
      requiredThreshold,
      normalizedDepositPercent,
      resolvedPathwayId: resolvedPathway?.id ?? "",
      pathwayName: (pathwayName as string) || String(pathwayId || ""),
      forNextLevel,
      breakdown,
    },
  };
}

/**
 * The `metadata` block both gateways attach to a tuition transaction, so the
 * webhook / verify path reads the same keys whichever provider paid. Mirrors
 * exactly what `/api/paystack/initialize` has always sent.
 */
export function checkoutMetadata(
  checkout: ResolvedCheckout,
  extra: { userId: string; pathwayId?: unknown; pathwayName?: unknown },
): Record<string, string> {
  return {
    userId: extra.userId,
    studentId: checkout.studentId,
    pathwayId: checkout.resolvedPathwayId,
    pathwayName: String(extra.pathwayName || extra.pathwayId || checkout.pathwayName || ""),
    totalAmount: String(checkout.normalizedTuitionFee),
    depositAmount: String(checkout.amountToCharge),
    tuitionFee: String(checkout.normalizedTuitionFee),
    requiredThreshold: String(checkout.requiredThreshold),
    depositPercent: String(checkout.normalizedDepositPercent),
    paymentType: checkout.effectivePaymentType,
    paymentStage: checkout.effectivePaymentType,
    forNextLevel: checkout.forNextLevel ? "true" : "false",
    targetLevel: checkout.billingLevel ?? "",
  };
}
