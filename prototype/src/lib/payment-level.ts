import { LEVELS } from "@/lib/levels";
import { isReceivedPayment, isRegistrationFeePayment } from "@/lib/payment";

const LEVEL_RE = new RegExp(`\\b(${LEVELS.join("|")})\\b`, "i");

/**
 * Read a CEFR level out of a payment description such as "A1 AUGUST".
 * The registration-fee row is never a tuition level.
 */
export function levelFromDescription(description?: string | null): string | null {
  if (!description || isRegistrationFeePayment(description)) return null;
  const match = String(description).match(LEVEL_RE);
  return match ? match[1].toUpperCase() : null;
}

/**
 * The level THIS payment is for.
 *
 * `Student.level` is the current pointer and moves on promotion. It must
 * never be used as a fallback here — that is how an August A1 payment of
 * ₦155,000 showed as A2 after the student sat October, and looked paid for
 * a month they had not paid.
 */
export function resolvePaymentLevel(input: {
  stamped?: string | null;
  description?: string | null;
}): string | null {
  const stamped = String(input.stamped ?? "").trim().toUpperCase();
  if ((LEVELS as readonly string[]).includes(stamped)) return stamped;
  return levelFromDescription(input.description);
}

export type LevelTaggedPayment = {
  amount?: number | null;
  status?: string | null;
  level?: string | null;
  description?: string | null;
  createdAt?: Date | string | null;
};

/**
 * Does this received tuition payment belong to `level`?
 *
 * Stamped / described payments follow `resolvePaymentLevel` — an August A1
 * row never counts toward October A2. Unstamped cash entries only count if
 * they were recorded at or after this level's tuition charge was opened,
 * so leftover A1 money is not treated as an A2 registration.
 */
export function paymentCountsTowardLevel(
  payment: LevelTaggedPayment,
  level: string,
  currentChargeCreatedAt?: Date | string | null,
): boolean {
  if (!isReceivedPayment(payment.status) || isRegistrationFeePayment(payment.description)) {
    return false;
  }
  const want = String(level ?? "").trim().toUpperCase();
  if (!want) return false;
  const resolved = resolvePaymentLevel({
    stamped: payment.level,
    description: payment.description,
  });
  if (resolved) return resolved === want;
  if (!currentChargeCreatedAt || !payment.createdAt) return false;
  return new Date(payment.createdAt).getTime() >= new Date(currentChargeCreatedAt).getTime();
}

export function sumPaidTowardLevel(
  payments: LevelTaggedPayment[],
  level: string,
  currentChargeCreatedAt?: Date | string | null,
): number {
  return payments.reduce((sum, payment) => {
    if (!paymentCountsTowardLevel(payment, level, currentChargeCreatedAt)) return sum;
    return sum + Math.max(0, Math.round(Number(payment.amount) || 0));
  }, 0);
}

/**
 * Already sat a previous CEFR level — registration was paid then, and must
 * not be asked for (or labelled) again on this file.
 */
export function isReturningLevelStudent(input: {
  currentLevel: string;
  chargeLevels?: Array<string | null | undefined>;
  enrolmentLevels?: Array<string | null | undefined>;
  completedLevel?: string | null;
  currentChargeCreatedAt?: Date | string | null;
  payments?: Array<{
    status?: string | null;
    level?: string | null;
    description?: string | null;
    createdAt?: Date | string | null;
  }>;
}): boolean {
  const current = String(input.currentLevel ?? "").trim().toUpperCase();
  const unique = (values?: Array<string | null | undefined>) =>
    new Set(
      (values ?? [])
        .map((value) => String(value ?? "").trim().toUpperCase())
        .filter(Boolean),
    );
  if (unique(input.chargeLevels).size > 1) return true;
  if (unique(input.enrolmentLevels).size > 1) return true;
  const done = String(input.completedLevel ?? "").trim().toUpperCase();
  if (done && done !== current) return true;
  return (input.payments ?? []).some((payment) => {
    if (!isReceivedPayment(payment.status) || isRegistrationFeePayment(payment.description)) {
      return false;
    }
    const resolved = resolvePaymentLevel({
      stamped: payment.level,
      description: payment.description,
    });
    if (resolved) return resolved !== current;
    if (!input.currentChargeCreatedAt || !payment.createdAt) return false;
    return new Date(payment.createdAt).getTime() < new Date(input.currentChargeCreatedAt).getTime();
  });
}
