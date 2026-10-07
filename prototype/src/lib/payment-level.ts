import { LEVELS } from "@/lib/levels";
import { isRegistrationFeePayment } from "@/lib/payment";

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
