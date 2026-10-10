export const REFERRAL_CAMPAIGN_STATUS = "blocked" as const;

export const REFERRAL_REWARD_COPY = {
  partPayment: "₦10,000 after your friend’s deposit/first tuition payment, plus ₦5,000 when they complete the balance — ₦15,000 total.",
  fullPayment: "₦20,000 when your friend pays their full tuition at once.",
  redemption: "Use your credit toward your next tuition payment or level.",
  example: "For example, if B1 tuition is ₦180,000, ₦15,000 credit means you pay ₦165,000 next time; ₦20,000 credit means you pay ₦160,000.",
  fulfillment: "This campaign is not live yet. Referral credits are not issued automatically; Easyway is still arranging manual verification and crediting. Please wait for official confirmation before relying on these rewards.",
} as const;

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

export const REFERRAL_EMAIL_TEMPLATE = {
  subject: "Coming soon: refer a friend and earn up to ₦20,000 tuition credit",
  body: [
    "Hello {{name}},",
    "",
    "Invite a friend to Easyway and earn tuition credit:",
    `• If they pay tuition in parts: ${REFERRAL_REWARD_COPY.partPayment}`,
    `• If they pay full tuition at once: ${REFERRAL_REWARD_COPY.fullPayment}`,
    REFERRAL_REWARD_COPY.redemption,
    REFERRAL_REWARD_COPY.example,
    "",
    "Your personal referral link is available in your student portal.",
    REFERRAL_REWARD_COPY.fulfillment,
  ].join("\n"),
} as const;

export const REFERRAL_NOTIFICATION_TEMPLATE = [
  `Coming soon: refer a friend. Earn ₦10,000 after their deposit/first payment + ₦5,000 after the balance, or ₦20,000 if they pay in full. Credit is for your next tuition/level. ${REFERRAL_REWARD_COPY.example} Not live yet; manual crediting is being arranged.`,
].join("");
