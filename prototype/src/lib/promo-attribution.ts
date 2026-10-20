import { tuitionFeeFor, type FeeLookup } from "@/lib/payment";
import { resolveDiscountAmount, type PromoDiscountConfig } from "@/lib/promo-pricing";

type PromoCodeLookup = {
  id: string;
  type: string;
} & PromoDiscountConfig;

export type PromoAttribution = {
  promoCodeId: string;
  codeSnapshot: string;
  type: string;
  /** Frozen now, whole naira — never recomputed against a later price change. */
  discountAmount: number;
};

/**
 * Resolve the promo/referral code a new student typed at signup, if any.
 *
 * Mirrors the shape of the retired `resolveSignupReferralAttribution`: a
 * missing or unknown code is a silent no-op (signup never blocks on it), and
 * a lookup failure is swallowed rather than thrown, so a database hiccup
 * cannot take the whole signup down over an optional field.
 */
export async function resolveSignupPromoAttribution(
  codeInput: unknown,
  canAttribute: boolean,
  findCode: (code: string) => Promise<PromoCodeLookup | null>,
  feeLookup: FeeLookup,
): Promise<PromoAttribution | null> {
  const code = typeof codeInput === "string" ? codeInput.trim().toUpperCase() : "";
  if (!code || !canAttribute) return null;

  try {
    const found = await findCode(code);
    if (!found) return null;
    const grossFee = tuitionFeeFor(feeLookup);
    const discountAmount = resolveDiscountAmount(found, grossFee);
    return { promoCodeId: found.id, codeSnapshot: code, type: found.type, discountAmount };
  } catch (error) {
    console.error("Promo attribution lookup failed during signup; continuing without attribution:", error);
    return null;
  }
}
