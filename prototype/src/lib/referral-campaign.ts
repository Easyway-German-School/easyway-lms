/**
 * Frequency-throttling for the student referral promotion moment
 * (ReferralPromotionMoment). The campaign itself is real now — see
 * PromoCode/PromoRedemption/PromoPayout — so the copy and status flag that
 * used to live here (REFERRAL_CAMPAIGN_STATUS, REFERRAL_REWARD_COPY) are
 * retired; a student's actual code and reward figures are read live from
 * their own PromoCode via /api/student/referral-promotion.
 */

const IMPRESSION_KEY_PREFIX = "easyway-referral-promotion-impressions-v1:";
const DAILY_IMPRESSION_LIMIT = 2;

type ImpressionStorage = Pick<Storage, "getItem" | "setItem">;

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function recordReferralPromotionImpression(
  referralCode: string,
  storage: ImpressionStorage,
  now = new Date(),
): boolean {
  const key = `${IMPRESSION_KEY_PREFIX}${referralCode}`;
  const today = localDateKey(now);
  const saved = storage.getItem(key);
  let count = 0;

  if (saved) {
    const parsed: unknown = JSON.parse(saved);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "date" in parsed &&
      parsed.date === today &&
      "count" in parsed &&
      typeof parsed.count === "number" &&
      Number.isInteger(parsed.count) &&
      parsed.count >= 0
    ) {
      count = parsed.count;
    }
  }

  if (count >= DAILY_IMPRESSION_LIMIT) return false;
  storage.setItem(key, JSON.stringify({ date: today, count: count + 1 }));
  return true;
}
