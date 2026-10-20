import { prisma } from "@/lib/prisma";
import { nextLevelAfter } from "@/lib/levels";
import { isTuitionPayment } from "@/lib/payment";
import { resolveCommissionAmount, resolveStudentReferralReward } from "@/lib/promo-pricing";

/**
 * Accrue a PromoPayout (influencer commission, or a student referrer's
 * credit) off the first qualifying tuition payment a referred/influenced
 * student makes. Mirrors recordCommissionForPayment's shape and call sites
 * (Paystack webhook, Stripe webhook, admin manual-payment route):
 *   - a no-op when the payer has no PromoRedemption at all (most payments);
 *   - a no-op unless the payment is received tuition (the registration fee is
 *     not qualifying tuition);
 *   - ONE accrual per redemption, ever, not one per payment: a second
 *     qualifying payment from the same student (a balance top-up) does not
 *     double the payout. Guarded by checking for an existing PromoPayout on
 *     the redemption before creating one, same race-safety reasoning as
 *     recordCommissionForPayment's paymentId uniqueness check.
 */
export async function recordPromoRewardForPayment(paymentId: string): Promise<void> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, studentId: true, amount: true, description: true, status: true, tenantId: true },
  });
  if (!payment || !isTuitionPayment(payment)) return;

  const redemption = await prisma.promoRedemption.findUnique({
    where: { redeemedByStudentId: payment.studentId },
    select: { id: true, promoCodeId: true },
  });
  if (!redemption) return;

  const existing = await prisma.promoPayout.findFirst({ where: { promoRedemptionId: redemption.id } });
  if (existing) return;

  const code = await prisma.promoCode.findUnique({
    where: { id: redemption.promoCodeId },
    select: { type: true, commissionPercent: true, commissionFlat: true, ownerStudentId: true },
  });
  if (!code) return;

  const amount =
    code.type === "student_referral"
      ? resolveStudentReferralReward(code, payment.amount)
      : resolveCommissionAmount(code, payment.amount);
  if (amount <= 0) return;

  let creditLevel: string | null = null;
  if (code.type === "student_referral" && code.ownerStudentId) {
    const referrer = await prisma.student.findUnique({
      where: { id: code.ownerStudentId },
      select: { level: true },
    });
    if (referrer) creditLevel = nextLevelAfter(referrer.level);
  }

  await prisma.promoPayout.create({
    data: {
      promoRedemptionId: redemption.id,
      promoCodeId: redemption.promoCodeId,
      paymentId: payment.id,
      amount,
      kind: code.type === "influencer" ? "commission" : "referral_credit",
      creditLevel,
      status: "pending",
      tenantId: payment.tenantId,
    },
  });
}
