import { describe, expect, it } from "vitest";
import { resolveCommissionAmount, resolveDiscountAmount, resolveStudentReferralReward } from "./promo-pricing";

describe("resolveDiscountAmount", () => {
  it("combines percent and flat, then caps and floors", () => {
    const amount = resolveDiscountAmount(
      { discountPercent: 10, discountFlat: 5000, discountCapAmount: 20000 },
      180000,
    );
    // 10% of 180,000 = 18,000 + 5,000 = 23,000, capped at 20,000
    expect(amount).toBe(20000);
  });

  it("never exceeds the gross fee", () => {
    const amount = resolveDiscountAmount({ discountPercent: null, discountFlat: 50000, discountCapAmount: null }, 30000);
    expect(amount).toBe(30000);
  });

  it("is zero when nothing is configured", () => {
    expect(resolveDiscountAmount({ discountPercent: null, discountFlat: null, discountCapAmount: null }, 180000)).toBe(0);
  });
});

describe("resolveCommissionAmount", () => {
  it("combines percent and flat", () => {
    const amount = resolveCommissionAmount({ commissionPercent: 5, commissionFlat: 1000 }, 100000);
    expect(amount).toBe(6000);
  });

  it("is zero when nothing is configured", () => {
    expect(resolveCommissionAmount({ commissionPercent: null, commissionFlat: null }, 100000)).toBe(0);
  });
});

describe("resolveStudentReferralReward", () => {
  it("uses the confirmed ₦5,000 amount for existing student codes with no configured rate", () => {
    expect(resolveStudentReferralReward({ commissionPercent: null, commissionFlat: null }, 100000)).toBe(5000);
  });

  it("honors an explicit percentage or flat amount instead of the default", () => {
    expect(resolveStudentReferralReward({ commissionPercent: 5, commissionFlat: null }, 100000)).toBe(5000);
    expect(resolveStudentReferralReward({ commissionPercent: null, commissionFlat: 7500 }, 100000)).toBe(7500);
  });
});
