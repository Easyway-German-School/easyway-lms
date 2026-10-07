import { describe, expect, it } from "vitest";
import { levelFromDescription, resolvePaymentLevel } from "./payment-level";

describe("levelFromDescription", () => {
  it("reads A1 AUGUST as A1", () => {
    expect(levelFromDescription("A1 AUGUST")).toBe("A1");
  });

  it("ignores the registration fee", () => {
    expect(levelFromDescription("Registration fee — A1")).toBeNull();
  });
});

describe("resolvePaymentLevel", () => {
  it("prefers the stamp over a stale current-level guess", () => {
    expect(resolvePaymentLevel({ stamped: "A1", description: "A2 tuition" })).toBe("A1");
  });

  it("recovers the level from the description when the stamp is missing", () => {
    expect(resolvePaymentLevel({ stamped: null, description: "A1 AUGUST" })).toBe("A1");
  });

  it("does not invent the student's current level", () => {
    expect(resolvePaymentLevel({ stamped: null, description: "Bank transfer" })).toBeNull();
  });
});
