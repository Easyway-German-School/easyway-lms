import { prisma } from "@/lib/prisma";

/**
 * Apply a student's frozen promo/referral discount to their signup-level
 * TuitionCharge, as a waiver — the same mechanism a scholarship uses (see
 * TuitionCharge.waivedAmount). Safe to call more than once and from more
 * than one place (signup, and again at first checkout if the best-effort
 * charge creation at signup failed): a redemption only ever applies once,
 * guarded by `discountAppliedToChargeId`.
 *
 * This keeps the ledger (receivables, the deposit gate, repricing) and the
 * checkout quote reading the SAME frozen figure — see
 * src/app/api/paystack/initialize/route.ts, which subtracts this same
 * PromoRedemption.discountAmount from what Paystack is asked to collect.
 */
export async function applyPromoDiscountIfNeeded(studentId: string, chargeId: string): Promise<void> {
  const redemption = await prisma.promoRedemption.findUnique({
    where: { redeemedByStudentId: studentId },
    select: { id: true, discountAmount: true, discountAppliedToChargeId: true, codeSnapshot: true },
  });
  if (!redemption || redemption.discountAmount <= 0 || redemption.discountAppliedToChargeId) return;

  const charge = await prisma.tuitionCharge.findUnique({
    where: { id: chargeId },
    select: { amount: true, waivedAmount: true },
  });
  if (!charge) return;

  const waivedAmount = Math.min(charge.amount, charge.waivedAmount + redemption.discountAmount);

  await prisma.$transaction([
    prisma.tuitionCharge.update({
      where: { id: chargeId },
      data: { waivedAmount, waivedReason: `Promo code ${redemption.codeSnapshot} signup discount` },
    }),
    prisma.promoRedemption.update({
      where: { id: redemption.id },
      data: { discountAppliedToChargeId: chargeId, discountAppliedAt: new Date(), status: "activated" },
    }),
  ]);
}
