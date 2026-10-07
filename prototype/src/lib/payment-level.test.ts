import { describe, expect, it } from "vitest";
import {
  isReturningLevelStudent,
  levelFromDescription,
  paymentCountsTowardLevel,
  resolvePaymentLevel,
  sumPaidTowardLevel,
} from "./payment-level";

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

describe("paymentCountsTowardLevel", () => {
  const a2Opened = "2026-10-01T00:00:00.000Z";

  it("keeps an August A1 payment off October A2", () => {
    expect(
      paymentCountsTowardLevel(
        { amount: 155_000, status: "completed", level: "A1", description: "A1 AUGUST", createdAt: "2026-08-10T00:00:00.000Z" },
        "A2",
        a2Opened,
      ),
    ).toBe(false);
  });

  it("counts a payment stamped for this level", () => {
    expect(
      paymentCountsTowardLevel(
        { amount: 90_000, status: "completed", level: "A2", description: "A2 OCTOBER", createdAt: "2026-10-02T00:00:00.000Z" },
        "A2",
        a2Opened,
      ),
    ).toBe(true);
  });

  it("never counts the registration fee toward tuition", () => {
    expect(
      paymentCountsTowardLevel(
        { amount: 5_000, status: "completed", description: "Registration fee for Language training", createdAt: "2026-08-01T00:00:00.000Z" },
        "A2",
        a2Opened,
      ),
    ).toBe(false);
  });

  it("does not treat leftover A1 cash as an unstamped A2 payment", () => {
    expect(
      paymentCountsTowardLevel(
        { amount: 155_000, status: "completed", description: "Bank transfer", createdAt: "2026-08-10T00:00:00.000Z" },
        "A2",
        a2Opened,
      ),
    ).toBe(false);
  });
});

describe("sumPaidTowardLevel", () => {
  it("leaves a returning A2 student owing the full A2 fee", () => {
    const paid = sumPaidTowardLevel(
      [
        { amount: 5_000, status: "completed", description: "Registration fee for Language training" },
        { amount: 155_000, status: "completed", level: "A1", description: "A1 AUGUST", createdAt: "2026-08-10T00:00:00.000Z" },
      ],
      "A2",
      "2026-10-01T00:00:00.000Z",
    );
    expect(paid).toBe(0);
  });
});

describe("isReturningLevelStudent", () => {
  it("is true once they have charges on more than one level", () => {
    expect(isReturningLevelStudent({ currentLevel: "A2", chargeLevels: ["A1", "A2"] })).toBe(true);
  });

  it("is true when an older payment is stamped for a previous level", () => {
    expect(
      isReturningLevelStudent({
        currentLevel: "A2",
        payments: [{ status: "completed", level: "A1", description: "A1 AUGUST" }],
      }),
    ).toBe(true);
  });

  it("is true when unstamped tuition landed before this level's charge", () => {
    expect(
      isReturningLevelStudent({
        currentLevel: "A2",
        currentChargeCreatedAt: "2026-10-01T00:00:00.000Z",
        payments: [
          { status: "completed", description: "Bank transfer", createdAt: "2026-08-10T00:00:00.000Z" },
        ],
      }),
    ).toBe(true);
  });

  it("is false for a brand-new A1 file", () => {
    expect(
      isReturningLevelStudent({
        currentLevel: "A1",
        chargeLevels: ["A1"],
        payments: [{ description: "Registration fee for Language training" }],
      }),
    ).toBe(false);
  });
});
