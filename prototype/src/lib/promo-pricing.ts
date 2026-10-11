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
