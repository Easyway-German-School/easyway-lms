import { describe, expect, it } from "vitest";
import {
  BEHIND_TUITION_MIN_DAYS,
  FOCUS_PRESETS,
  agingBucketFor,
  computeAll,
  computeStudentFinance,
  summariseReceivables,
  type FinanceStudentInput,
} from "./receivables";

const NOW = new Date("2026-08-10T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function student(overrides: Partial<FinanceStudentInput> & { id: string }): FinanceStudentInput {
  return {
    level: "A1",
    status: "active",
    classType: "group",
    createdAt: new Date(NOW.getTime() - 30 * DAY),
    branch: { id: "lagos", name: "Lagos" },
    user: { name: "Test Student", email: "test@example.com" },
    payments: [],
    ...overrides,
  };
}

describe("computeStudentFinance", () => {
  it("prices off the branch, not the level alone", () => {
    const lagos = computeStudentFinance(student({ id: "a" }), NOW);
    const abuja = computeStudentFinance(
      student({ id: "b", branch: { id: "abuja", name: "Abuja Branch" } }),
      NOW,
    );

    // The premium tier is the whole reason FeeLookup takes a branch.
    expect(lagos.tuitionFee).toBe(150_000);
    expect(abuja.tuitionFee).toBe(180_000);
  });

  it("counts completed and partial (deposit) payments as money in the bank", () => {
    const row = computeStudentFinance(
      student({
        id: "a",
        payments: [
          { amount: 40_000, status: "completed" },
          { amount: 50_000, status: "partial" },
          { amount: 60_000, status: "pending" },
          { amount: 50_000, status: "failed" },
        ],
      }),
      NOW,
    );

    // completed + partial count; pending and failed do not.
    expect(row.paid).toBe(90_000);
    expect(row.owed).toBe(60_000);
  });

  it("puts a student who has paid the deposit on the right side of the paywall", () => {
    // 60% of ₦150,000 is ₦90,000.
    const row = computeStudentFinance(student({ id: "a", payments: [{ amount: 90_000 }] }), NOW);

    expect(row.requiredDeposit).toBe(90_000);
    expect(row.depositPaid).toBe(true);
    expect(row.lockedOut).toBe(false);
    expect(row.cohort).toBe("deposit_paid");
    expect(row.behindOnTuition).toBe(false);
  });

  it("does not call a short-paid student behind until the fortnight is up", () => {
    const justEnrolled = computeStudentFinance(
      student({ id: "a", createdAt: new Date(NOW.getTime() - (BEHIND_TUITION_MIN_DAYS - 1) * DAY) }),
      NOW,
    );
    const overdue = computeStudentFinance(
      student({ id: "b", createdAt: new Date(NOW.getTime() - BEHIND_TUITION_MIN_DAYS * DAY) }),
      NOW,
    );

    expect(justEnrolled.behindOnTuition).toBe(false);
    expect(overdue.behindOnTuition).toBe(true);
  });

  it("doubles the fee for a private student", () => {
    const row = computeStudentFinance(student({ id: "a", classType: "private" }), NOW);
    expect(row.tuitionFee).toBe(300_000);
  });
});

describe("agingBucketFor", () => {
  it("files each span in exactly one bucket", () => {
    expect(agingBucketFor(0)).toBe("current");
    expect(agingBucketFor(13)).toBe("current");
    expect(agingBucketFor(14)).toBe("d14_30");
    expect(agingBucketFor(30)).toBe("d14_30");
    expect(agingBucketFor(31)).toBe("d31_60");
    expect(agingBucketFor(90)).toBe("d61_90");
    expect(agingBucketFor(91)).toBe("d90_plus");
    expect(agingBucketFor(400)).toBe("d90_plus");
  });
});

describe("the dashboard count and the roster it links to", () => {
  /**
   * THE PROMISE THIS MODULE EXISTS TO KEEP.
   *
   * The dashboard says "N students behind on tuition" from `summariseReceivables`
   * and the roster filters with `FOCUS_PRESETS.behind_tuition`. If those two ever
   * answer differently, clicking the number lands on a list that contradicts it —
   * which is precisely what the old inline copy of the rule did.
   */
  const cohort: FinanceStudentInput[] = [
    // Behind: a fortnight in, nothing paid.
    student({ id: "behind-1", createdAt: new Date(NOW.getTime() - 40 * DAY) }),
    // Behind: paid something, still under the deposit.
    student({ id: "behind-2", createdAt: new Date(NOW.getTime() - 20 * DAY), payments: [{ amount: 20_000 }] }),
    // Not behind: deposit met.
    student({ id: "settled", createdAt: new Date(NOW.getTime() - 60 * DAY), payments: [{ amount: 90_000 }] }),
    // Not behind: too new to chase.
    student({ id: "fresh", createdAt: new Date(NOW.getTime() - 3 * DAY) }),
    // Not behind: paid in full.
    student({ id: "paid-up", createdAt: new Date(NOW.getTime() - 90 * DAY), payments: [{ amount: 150_000 }] }),
  ];

  const rows = computeAll(cohort, NOW);
  const summary = summariseReceivables(rows);
  const context = { now: NOW, startOfMonth: new Date(2026, 7, 1) };

  it("agrees on how many are behind", () => {
    const matched = rows.filter((row) =>
      FOCUS_PRESETS.behind_tuition.matches(row, context, cohort.find((c) => c.id === row.id)!),
    );
    expect(summary.behindOnTuition).toBe(2);
    expect(matched).toHaveLength(summary.behindOnTuition);
    expect(matched.map((row) => row.id).sort()).toEqual(["behind-1", "behind-2"]);
  });

  it("agrees on how many are locked out", () => {
    const matched = rows.filter((row) =>
      FOCUS_PRESETS.locked_out.matches(row, context, cohort.find((c) => c.id === row.id)!),
    );
    // behind-1, behind-2 and fresh have all failed to reach the deposit.
    expect(summary.lockedOut).toBe(3);
    expect(matched).toHaveLength(summary.lockedOut);
  });

  it("agrees on every cohort count", () => {
    for (const [name, expected] of Object.entries(summary.cohortCounts)) {
      const preset = FOCUS_PRESETS[name];
      const matched = rows.filter((row) => preset.matches(row, context, cohort.find((c) => c.id === row.id)!));
      expect(matched, `cohort ${name}`).toHaveLength(expected);
    }
  });

  it("totals the book without double counting", () => {
    expect(summary.students).toBe(5);
    expect(summary.expected).toBe(5 * 150_000);
    expect(summary.collected).toBe(20_000 + 90_000 + 150_000);
    expect(summary.outstanding).toBe(summary.expected - summary.collected);
  });

  it("leaves settled students out of the ageing report", () => {
    const aged = summary.aging.reduce((sum, bucket) => sum + bucket.students, 0);
    // `paid-up` owes nothing, so it belongs in no ageing bucket — otherwise the
    // oldest bucket grows every term regardless of how well the school collects.
    expect(aged).toBe(4);
    expect(summary.aging.reduce((sum, bucket) => sum + bucket.amount, 0)).toBe(summary.outstanding);
  });
});
