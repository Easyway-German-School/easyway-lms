import { describe as suite, expect, it } from "vitest";

import {
  MIN_PART_PAYMENT,
  resolvePartialPaymentAmount,
  isTravelPackagePathway,
  tuitionFeeFor,
  requiredDepositFor,
  TRAVEL_PACKAGE_PRICE,
  TRAVEL_PACKAGE_MIN_FIRST_PAYMENT,
} from "./payment";

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

/**
 * Travel Package: a flat ₦980,000 that REPLACES the per-level ladder, with a
 * ₦200,000 minimum first payment instead of the usual 60% deposit. These are
 * the only two functions that decide the price and the floor — everything
 * else (cohort, lock, dashboard) just reads whatever these two return.
 */
suite("isTravelPackagePathway", () => {
  it("matches the exact pathway, case- and whitespace-insensitively", () => {
    expect(isTravelPackagePathway("Travel Package")).toBe(true);
    expect(isTravelPackagePathway("travel package")).toBe(true);
    expect(isTravelPackagePathway("  TRAVEL PACKAGE  ")).toBe(true);
  });

  it("does not match any other pathway, or nothing at all", () => {
    expect(isTravelPackagePathway("Language training")).toBe(false);
    expect(isTravelPackagePathway("Nursing career path")).toBe(false);
    expect(isTravelPackagePathway(null)).toBe(false);
    expect(isTravelPackagePathway(undefined)).toBe(false);
    expect(isTravelPackagePathway("")).toBe(false);
  });
});

suite("tuitionFeeFor — Travel Package", () => {
  it("prices at the flat ₦980,000 whatever the level or branch", () => {
    for (const level of ["A1", "A2", "B1", "B2", "C1"]) {
      for (const branch of [null, "Lagos", "Abuja", "Online"]) {
        expect(tuitionFeeFor({ level, branch, pathway: "Travel Package" })).toBe(TRAVEL_PACKAGE_PRICE);
      }
    }
  });

  it("wins over the private one-to-one flat price when both are somehow set", () => {
    expect(tuitionFeeFor({ level: "B1", branch: "Abuja", classType: "private", pathway: "Travel Package" })).toBe(
      TRAVEL_PACKAGE_PRICE,
    );
  });

  it("leaves every non-Travel-Package student on the normal table", () => {
    expect(tuitionFeeFor({ level: "A1", branch: "Lagos", pathway: "Language training" })).toBe(150000);
    expect(tuitionFeeFor({ level: "A1", branch: "Lagos" })).toBe(150000);
  });
});

suite("requiredDepositFor — Travel Package", () => {
  it("is the flat ₦200,000 floor, not 60% of ₦980,000", () => {
    const deposit = requiredDepositFor({ level: "A1", branch: null, pathway: "Travel Package" });
    expect(deposit).toBe(TRAVEL_PACKAGE_MIN_FIRST_PAYMENT);
    expect(deposit).not.toBe(Math.round(TRAVEL_PACKAGE_PRICE * 0.6));
  });

  it("leaves every non-Travel-Package student on the normal 60% deposit", () => {
    expect(requiredDepositFor({ level: "A1", branch: "Lagos" })).toBe(90000);
  });
});

suite("resolvePartialPaymentAmount — Travel Package's ₦200k-then-flexible shape", () => {
  const FEE = TRAVEL_PACKAGE_PRICE;
  const FLOOR = TRAVEL_PACKAGE_MIN_FIRST_PAYMENT;

  it("rejects a first payment under ₦200,000", () => {
    const result = resolvePartialPaymentAmount({
      requestedAmount: 150_000,
      tuitionFee: FEE,
      requiredDeposit: FLOOR,
      alreadyPaid: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("₦200,000");
  });

  it("accepts exactly ₦200,000 as the first payment", () => {
    const result = resolvePartialPaymentAmount({
      requestedAmount: FLOOR,
      tuitionFee: FEE,
      requiredDeposit: FLOOR,
      alreadyPaid: 0,
    });
    expect(result).toEqual({ ok: true, amount: 200_000, settlesAccount: false });
  });

  it("once past the floor, accepts a free-form top-up of any size ≥ MIN_PART_PAYMENT", () => {
    const result = resolvePartialPaymentAmount({
      requestedAmount: 37_500,
      tuitionFee: FEE,
      requiredDeposit: FLOOR,
      alreadyPaid: 200_000,
    });
    expect(result).toEqual({ ok: true, amount: 37_500, settlesAccount: false });
  });

  it("clamps an over-payment to the remaining balance and flags it settles the account", () => {
    const result = resolvePartialPaymentAmount({
      requestedAmount: 999_999_999,
      tuitionFee: FEE,
      requiredDeposit: FLOOR,
      alreadyPaid: 900_000,
    });
    expect(result).toEqual({ ok: true, amount: 80_000, settlesAccount: true });
  });
});
