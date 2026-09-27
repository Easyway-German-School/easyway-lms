import { describe, expect, it } from "vitest";
import { sanitizeDetailsInput } from "./booking";

describe("sanitizeDetailsInput", () => {
  it("keeps known string fields and the repeat-attempt flag", () => {
    expect(sanitizeDetailsInput({ fullName: "Ada Obi", city: "Lagos", isRepeatAttempt: true })).toEqual({
      fullName: "Ada Obi", city: "Lagos", isRepeatAttempt: true,
    });
  });

  it("ignores nulls, numbers and objects instead of letting them crash the update", () => {
    // The exact shape that took down the details form: a whole booking object with nulls in it.
    expect(sanitizeDetailsInput({ specialNeeds: null, city: 42, fullName: { $ne: "x" }, phone: "0803" })).toEqual({ phone: "0803" });
  });

  it("drops fields a candidate must never be able to set", () => {
    const out = sanitizeDetailsInput({ feeTotal: 1, paymentStatus: "paid", status: "confirmed", admittedAt: "2026-01-01", seatNumber: 1, city: "Lagos" });
    expect(out).toEqual({ city: "Lagos" });
  });

  it("copes with a non-object body", () => {
    expect(sanitizeDetailsInput(null)).toEqual({});
    expect(sanitizeDetailsInput("x")).toEqual({});
  });
});
