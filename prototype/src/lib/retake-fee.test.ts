import { describe, expect, it } from "vitest";
import { retakePrice } from "@/lib/retake-fee";

describe("retakePrice", () => {
  it("applies 30% to the current tuition and rounds once to whole naira", () => {
    expect(retakePrice(150_000)).toEqual({
      baseFee: 150_000,
      discountAmount: 45_000,
      fee: 105_000,
    });
    expect(retakePrice(214_286)).toEqual({
      baseFee: 214_286,
      discountAmount: 64_286,
      fee: 150_000,
    });
  });

  it("does not produce negative prices for invalid input", () => {
    expect(retakePrice(-1)).toEqual({ baseFee: 0, discountAmount: 0, fee: 0 });
  });
});
