/**
 * Turning a PromoCode's admin-set discount/commission config into a naira
 * figure. Two call sites: `resolveSignupPromoAttribution` (discount, frozen
 * once at signup) and `recordPromoRewardForPayment` (commission, computed
 * once per redemption off the payment that activates it).
 *
 * Percent fields are whole points (10 means 10%), matching how an admin
 * types a rate into a form — never a 0–1 fraction.
 */

export type PromoDiscountConfig = {
  discountPercent: number | null;
  discountFlat: number | null;
  discountCapAmount: number | null;
};

/** Percent of the gross fee, plus a flat top-up, capped, never negative or more than the fee itself. */
export function resolveDiscountAmount(code: PromoDiscountConfig, grossFee: number): number {
  let amount = 0;
  if (code.discountPercent) amount += Math.round((grossFee * code.discountPercent) / 100);
  if (code.discountFlat) amount += code.discountFlat;
  if (code.discountCapAmount != null) amount = Math.min(amount, code.discountCapAmount);
  return Math.max(0, Math.min(amount, grossFee));
}

/**
 * PLACEHOLDER — not a confirmed business figure, same status as
 * src/lib/growth/commission.ts's PLACEHOLDER_COMMISSION_RATE. Every student
 * referral code used to ship with commissionPercent/commissionFlat both
 * null, so the referral promotion moment (ReferralPromotionMoment.tsx) had
 * nothing concrete to tell a student they'd earn — just "your school will
 * confirm what you earn," which does not sell anything. This is the number
 * applied to a student's own referral code the moment it's created at
 * signup (see src/app/api/auth/signup/route.ts). Editable per-code from
 * /api/admin/promo-codes/[id] if the school wants to change it for anyone
 * specific; replace this constant to change the default for everyone new.
 */
export const DEFAULT_STUDENT_REFERRAL_COMMISSION_FLAT = 5000; // ₦5,000 cashback per paying referral — NOT CONFIRMED

export type PromoCommissionConfig = {
  commissionPercent: number | null;
  commissionFlat: number | null;
};

/** Percent of the payment, plus a flat top-up. Never negative. */
export function resolveCommissionAmount(code: PromoCommissionConfig, paymentAmount: number): number {
  let amount = 0;
  if (code.commissionPercent) amount += Math.round((paymentAmount * code.commissionPercent) / 100);
  if (code.commissionFlat) amount += code.commissionFlat;
  return Math.max(0, amount);
}
