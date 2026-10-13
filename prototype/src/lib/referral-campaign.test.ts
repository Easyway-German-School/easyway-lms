import { describe, expect, it } from "vitest";
import { recordReferralPromotionImpression } from "./referral-campaign";

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
