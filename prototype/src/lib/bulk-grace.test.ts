import { describe, expect, it } from "vitest";
import { matchesBulkGracePaymentStatus } from "./bulk-grace";

const unpaid = { paid: 0, owed: 150_000, currentLevelOutstanding: 150_000, depositPaid: false };
const partPaid = { paid: 80_000, owed: 70_000, currentLevelOutstanding: 70_000, depositPaid: false };
const depositPaid = { paid: 100_000, owed: 50_000, currentLevelOutstanding: 50_000, depositPaid: true };
const paid = { paid: 150_000, owed: 0, currentLevelOutstanding: 0, depositPaid: true };

describe("bulk payment grace filters", () => {
  it("separates unpaid, partial, deposit-paid, outstanding and fully paid students", () => {
    expect(matchesBulkGracePaymentStatus("unpaid", unpaid)).toBe(true);
    expect(matchesBulkGracePaymentStatus("part_paid", partPaid)).toBe(true);
    expect(matchesBulkGracePaymentStatus("deposit_paid", depositPaid)).toBe(true);
    expect(matchesBulkGracePaymentStatus("outstanding", depositPaid)).toBe(true);
    expect(matchesBulkGracePaymentStatus("paid", paid)).toBe(true);
    expect(matchesBulkGracePaymentStatus("unpaid", partPaid)).toBe(false);
    expect(matchesBulkGracePaymentStatus("paid", depositPaid)).toBe(false);
  });

  it("uses the whole ledger balance for the outstanding filter", () => {
    const hasPreviousLevelBalance = { paid: 200_000, owed: 1, currentLevelOutstanding: 0, depositPaid: true };
    expect(matchesBulkGracePaymentStatus("outstanding", hasPreviousLevelBalance)).toBe(true);
    expect(matchesBulkGracePaymentStatus("paid", hasPreviousLevelBalance)).toBe(false);
  });
});
