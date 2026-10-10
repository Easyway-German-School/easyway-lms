import { describe, expect, it } from "vitest";
import {
  REFERRAL_CAMPAIGN_STATUS,
  REFERRAL_EMAIL_TEMPLATE,
  REFERRAL_NOTIFICATION_TEMPLATE,
  REFERRAL_REWARD_COPY,
  recordReferralPromotionImpression,
} from "./referral-campaign";

describe("referral campaign copy", () => {
  it("states the exact two reward paths and tuition-credit use", () => {
    expect(REFERRAL_REWARD_COPY.partPayment).toContain("₦10,000");
    expect(REFERRAL_REWARD_COPY.partPayment).toContain("₦5,000");
    expect(REFERRAL_REWARD_COPY.partPayment).toContain("₦15,000 total");
    expect(REFERRAL_REWARD_COPY.fullPayment).toContain("₦20,000");
    expect(REFERRAL_REWARD_COPY.redemption).toContain("next tuition payment or level");
    expect(REFERRAL_REWARD_COPY.example).toContain("₦180,000");
    expect(REFERRAL_REWARD_COPY.example).toContain("₦165,000");
    expect(REFERRAL_REWARD_COPY.example).toContain("₦160,000");
  });

  it("keeps email and in-app drafts clear that manual fulfillment is not ready", () => {
    expect(REFERRAL_CAMPAIGN_STATUS).toBe("blocked");
    expect(REFERRAL_EMAIL_TEMPLATE.subject).toContain("₦20,000");
    expect(REFERRAL_EMAIL_TEMPLATE.body).toContain("not issued automatically");
    expect(REFERRAL_EMAIL_TEMPLATE.body).toContain(REFERRAL_REWARD_COPY.example);
    expect(REFERRAL_NOTIFICATION_TEMPLATE).toContain("Not live yet");
    expect(REFERRAL_NOTIFICATION_TEMPLATE).toContain(REFERRAL_REWARD_COPY.example);
  });
});

describe("referral promotion frequency", () => {
  it("allows no more than two impressions per student referral code per local day", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    const morning = new Date(2026, 9, 9, 9);
    const afternoon = new Date(2026, 9, 9, 15);

    expect(recordReferralPromotionImpression("EWABC", storage, morning)).toBe(true);
    expect(recordReferralPromotionImpression("EWABC", storage, afternoon)).toBe(true);
    expect(recordReferralPromotionImpression("EWABC", storage, afternoon)).toBe(false);
  });

  it("allows another impression on the next local day", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };

    expect(recordReferralPromotionImpression("EWABC", storage, new Date(2026, 9, 9, 23, 59))).toBe(true);
    expect(recordReferralPromotionImpression("EWABC", storage, new Date(2026, 9, 10, 0, 1))).toBe(true);
  });
});
