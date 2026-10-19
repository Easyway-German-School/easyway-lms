import { describe, expect, it } from "vitest";
import { bulkGraceBatchLabel, compareBulkGraceBatchLabels, matchesBulkGraceBatch, matchesBulkGracePaymentStatus } from "./bulk-grace";

const unpaid = { paid: 0, owed: 150_000, currentLevelOutstanding: 150_000, depositPaid: false };
const partPaid = { paid: 80_000, owed: 70_000, currentLevelOutstanding: 70_000, depositPaid: false };
const depositPaid = { paid: 100_000, owed: 50_000, currentLevelOutstanding: 50_000, depositPaid: true };
const paid = { paid: 150_000, owed: 0, currentLevelOutstanding: 0, depositPaid: true };

describe("bulk payment grace filters", () => {
  it("labels each active student by their current batch for batch selection", () => {
    expect(bulkGraceBatchLabel({
      admission: { batch: "August" },
      enrolments: [
        { batchMonth: "October 2026", batchYear: 2026, outcome: "ongoing" },
        { batchMonth: "August", batchYear: 2026, outcome: "passed" },
      ],
    })).toBe("October 2026");
    expect(bulkGraceBatchLabel({
      admission: null,
      enrolments: [
        { batchMonth: "August 2026", batchYear: 2027, outcome: "ongoing" },
      ],
    })).toBe("August 2027");
    expect(bulkGraceBatchLabel({
      admission: { batch: "October 2026 2026", batchYear: 2026 },
      enrolments: [],
    })).toBe("October 2026");
  });

  it("sorts batch options by intake date, newest first", () => {
    const batches = ["October 2026", "April 2027", "August 2026"];
    expect(batches.sort(compareBulkGraceBatchLabels)).toEqual([
      "April 2027",
      "October 2026",
      "August 2026",
    ]);
  });

  it("includes only students in the exactly selected batch and year", () => {
    expect(matchesBulkGraceBatch("October 2026", "October 2026")).toBe(true);
    expect(matchesBulkGraceBatch("October 2026", "October 2027")).toBe(false);
    expect(matchesBulkGraceBatch("October 2026", "September 2026")).toBe(false);
    expect(matchesBulkGraceBatch("October 2026", null)).toBe(false);
    expect(matchesBulkGraceBatch("", null)).toBe(true);
  });

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
