import { describe, expect, it } from "vitest";
import { deriveStudentAccess } from "./access";

/**
 * These tests exist because the fields tested here were the exact ones two
 * routes dropped when they called `deriveStudentAccess` directly instead of
 * going through `getStudentAccess`/`accessFromStudent` (lib/student-access.ts):
 *   - the admin dossier, 2026-09-14 (missing `charges`, `flatDeposit`)
 *   - `/api/live/session` + 2 more routes, 2026-09-15 (missing `charges`,
 *     `flatDeposit`, `paymentPlanOnTrack`)
 * Both times a student the ledger correctly considered paid up got a wrong
 * answer from whichever route had dropped the field. Each test below pins one
 * of those fields: it asserts what happens WITH it (the correct answer) and
 * WITHOUT it (the wrong answer a hand-rolled caller would get instead), so a
 * future regression — someone reimplementing this call — shows up here before
 * it reaches a student. See also scripts/check-payment-gate-drift.mjs, which
 * catches the reimplementation itself rather than its symptom.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-15T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

describe("deriveStudentAccess — omitting paymentPlanOnTrack", () => {
  // A part-payer, 40 days into classes (past the 30-day grace window), who has
  // an active tuition payment plan they are keeping to.
  const base = {
    totalPaid: 90_000,
    tuitionFee: 150_000,
    requiredDeposit: 90_000,
    classesStartedAt: daysAgo(40),
    paymentGraceUntil: null,
    now: NOW,
  };

  it("wrongly locks a student on an on-track payment plan when the flag is dropped", () => {
    const access = deriveStudentAccess(base); // paymentPlanOnTrack omitted
    expect(access.hasAccess).toBe(false);
    expect(access.lockReason).toBe("unsettled_balance");
  });

  it("correctly leaves them open when paymentPlanOnTrack is passed", () => {
    const access = deriveStudentAccess({ ...base, paymentPlanOnTrack: true });
    expect(access.hasAccess).toBe(true);
    expect(access.lockReason).toBeNull();
  });
});

describe("deriveStudentAccess — omitting the tuition ledger (charges)", () => {
  // A student promoted from A1 to A2. A1 (₦150,000) was paid in full at
  // signup; nothing has been paid toward A2 yet. Lifetime totalPaid (₦150,000)
  // happens to equal the flat per-level fee, which is exactly the trap: a
  // raw sum-vs-flat-fee comparison reads this as "the deposit is covered",
  // when the ledger says every naira of it already went to the level they
  // finished.
  const charges = [
    { id: "c1", level: "A1", amount: 150_000, waivedAmount: 0, legacyArrears: false, createdAt: daysAgo(60) },
    { id: "c2", level: "A2", amount: 150_000, waivedAmount: 0, legacyArrears: false, createdAt: daysAgo(10) },
  ];
  const base = {
    totalPaid: 150_000,
    tuitionFee: 150_000,
    requiredDeposit: 90_000,
    level: "A2",
    now: NOW,
  };

  it("wrongly grants deposit access on the new level when charges is dropped", () => {
    const access = deriveStudentAccess(base); // charges omitted — falls back to the raw sum
    expect(access.hasAccess).toBe(true);
  });

  it("correctly withholds it once the ledger shows nothing paid toward A2", () => {
    const access = deriveStudentAccess({ ...base, charges });
    expect(access.hasAccess).toBe(false);
    expect(access.lockReason).toBe("unpaid_deposit");
  });
});

describe("deriveStudentAccess — omitting flatDeposit for Travel Package", () => {
  // Travel Package prices the whole pathway at once (₦980,000), but the
  // minimum first payment is a flat ₦200,000 floor, not 60% of the package.
  // A ledger charge for the full package exists; the student has paid the
  // flat floor and nothing more.
  const charges = [
    { id: "c1", level: "TRAVEL", amount: 980_000, waivedAmount: 0, legacyArrears: false, createdAt: daysAgo(5) },
  ];
  const base = {
    totalPaid: 200_000,
    tuitionFee: 980_000,
    requiredDeposit: 200_000,
    level: "TRAVEL",
    charges,
    now: NOW,
  };

  it("wrongly withholds access when flatDeposit is dropped (60% of 980k is demanded instead)", () => {
    const access = deriveStudentAccess(base); // flatDeposit omitted — gate becomes 60% of the ledger charge
    expect(access.hasAccess).toBe(false);
  });

  it("correctly opens access at the flat ₦200,000 floor when flatDeposit is passed", () => {
    const access = deriveStudentAccess({ ...base, flatDeposit: true });
    expect(access.hasAccess).toBe(true);
  });
});
