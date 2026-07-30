export type PaymentStatus = "Pending" | "Partial" | "Completed";

/**
 * Tuition by level. This table used to be copy-pasted into the student API,
 * the profile API and the dashboard, which meant a price change had to be made
 * in several files or the portal would quote two different fees for one level.
 */
export const TUITION_FEES: Record<string, number> = {
  A1: 150000,
  A2: 150000,
  B1: 180000,
  B2: 180000,
  C1: 200000,
  C2: 220000,
};

export const DEFAULT_TUITION_FEE = TUITION_FEES.A1;

/** Share of tuition that must be paid before classes open. */
export const DEPOSIT_RATE = 0.6;

export function tuitionFeeForLevel(level?: string | null): number {
  return TUITION_FEES[String(level ?? "").toUpperCase()] ?? DEFAULT_TUITION_FEE;
}

export function requiredDepositForLevel(level?: string | null): number {
  return Math.round(tuitionFeeForLevel(level) * DEPOSIT_RATE);
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
