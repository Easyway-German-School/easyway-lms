import { describe as suite, expect, it } from "vitest";

import { MIN_PART_PAYMENT, resolvePartialPaymentAmount } from "./payment";

/**
 * `resolvePartialPaymentAmount` is the only thing between "a student types how
 * much tuition to pay" and "a student pays less than the 60% the school enrols
 * on". Every branch of it is money, so every branch is tested.
 *
 * Figures throughout use the launch A1 standard-tier numbers: ₦150,000 fee,
 * ₦90,000 (60%) deposit.
 */

const FEE = 150_000;
const DEPOSIT = 90_000;

suite("resolvePartialPaymentAmount — first payment (deposit not yet met)", () => {
  it("rejects anything below the 60% deposit and names the figure", () => {
    const result = resolvePartialPaymentAmount({
      requestedAmount: 50_000,
      tuitionFee: FEE,
      requiredDeposit: DEPOSIT,
      alreadyPaid: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("₦90,000");
      expect(result.error).toContain("branch office");
    }
  });

  it("accepts exactly the 60% deposit", () => {
    const result = resolvePartialPaymentAmount({
      requestedAmount: DEPOSIT,
      tuitionFee: FEE,
      requiredDeposit: DEPOSIT,
      alreadyPaid: 0,
    });
    expect(result).toEqual({ ok: true, amount: 90_000, settlesAccount: false });
  });

  it("accepts an amount between 60% and 100% (the ₦120k case)", () => {
    const result = resolvePartialPaymentAmount({
      requestedAmount: 120_000,
      tuitionFee: FEE,
      requiredDeposit: DEPOSIT,
      alreadyPaid: 0,
    });
    expect(result).toEqual({ ok: true, amount: 120_000, settlesAccount: false });
  });

  it("clamps an over-payment down to the full fee and flags it settles the account", () => {
    const result = resolvePartialPaymentAmount({
      requestedAmount: 999_999,
      tuitionFee: FEE,
      requiredDeposit: DEPOSIT,
      alreadyPaid: 0,
    });
    expect(result).toEqual({ ok: true, amount: 150_000, settlesAccount: true });
  });

  it("treats the floor against what is already in — a ₦20k top-up onto ₦75k reaches the deposit", () => {
    const result = resolvePartialPaymentAmount({
      requestedAmount: 20_000,
      tuitionFee: FEE,
      requiredDeposit: DEPOSIT,
      alreadyPaid: 75_000,
    });
    expect(result).toEqual({ ok: true, amount: 20_000, settlesAccount: false });
  });

  it("rejects a top-up that still would not reach the deposit", () => {
    const result = resolvePartialPaymentAmount({
      requestedAmount: 5_000,
      tuitionFee: FEE,
      requiredDeposit: DEPOSIT,
      alreadyPaid: 75_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("₦15,000");
  });
});

suite("resolvePartialPaymentAmount — top-up (deposit already met)", () => {
  it("allows a free-form top-up above MIN_PART_PAYMENT", () => {
    const result = resolvePartialPaymentAmount({
      requestedAmount: 10_000,
      tuitionFee: FEE,
      requiredDeposit: DEPOSIT,
      alreadyPaid: 90_000,
    });
    expect(result).toEqual({ ok: true, amount: 10_000, settlesAccount: false });
  });

  it("rejects a dust top-up below MIN_PART_PAYMENT", () => {
    const result = resolvePartialPaymentAmount({
      requestedAmount: 100,
      tuitionFee: FEE,
      requiredDeposit: DEPOSIT,
      alreadyPaid: 90_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(`₦${MIN_PART_PAYMENT.toLocaleString("en-NG")}`);
  });

  it("clamps a top-up to the remaining balance", () => {
    const result = resolvePartialPaymentAmount({
      requestedAmount: 100_000,
      tuitionFee: FEE,
      requiredDeposit: DEPOSIT,
      alreadyPaid: 120_000,
    });
    expect(result).toEqual({ ok: true, amount: 30_000, settlesAccount: true });
  });
});

suite("resolvePartialPaymentAmount — guards", () => {
  it("rejects when nothing is outstanding", () => {
    const result = resolvePartialPaymentAmount({
      requestedAmount: 10_000,
      tuitionFee: FEE,
      requiredDeposit: DEPOSIT,
      alreadyPaid: 150_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("nothing outstanding");
  });

  it("normalises a negative / NaN / string request before checking the floor", () => {
    for (const bad of [-5000, Number.NaN, "abc", null, undefined]) {
      const result = resolvePartialPaymentAmount({
        requestedAmount: bad,
        tuitionFee: FEE,
        requiredDeposit: DEPOSIT,
        alreadyPaid: 0,
      });
      expect(result.ok).toBe(false);
    }
  });

  it("rounds a fractional request to whole naira before the floor test", () => {
    const result = resolvePartialPaymentAmount({
      requestedAmount: 89_999.99,
      tuitionFee: FEE,
      requiredDeposit: DEPOSIT,
      alreadyPaid: 0,
    });
    // 89,999.99 rounds to 90,000 — clears the deposit.
    expect(result).toEqual({ ok: true, amount: 90_000, settlesAccount: false });
  });

  it("rejects a fractional request that rounds below the deposit", () => {
    const result = resolvePartialPaymentAmount({
      requestedAmount: 89_999.01,
      tuitionFee: FEE,
      requiredDeposit: DEPOSIT,
      alreadyPaid: 0,
    });
    expect(result.ok).toBe(false);
  });
});
