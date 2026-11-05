import { describe, expect, it } from "vitest";
import {
  buildRosterWhereClause,
  parseRosterFilters,
  scoreAndFilterRoster,
  type RosterRow,
} from "./student-roster-query";

describe("student roster enrolment-year filter", () => {
  it("matches the selected batch month and enrollment year together", () => {
    const filters = parseRosterFilters(new URL("https://example.test/admin/students?batch=January&year=2027"));
    const where = buildRosterWhereClause(filters, { tenantId: null, allowedBranchIds: null });

    expect(where.admission).toEqual({ path: ["batch"], equals: "January" });
    expect(where.enrolments).toEqual({
      some: { batchYear: 2027, deletedAt: null },
    });
  });

  it("never pushes paymentStatus into SQL — it has to run post-query against the computed cohort", () => {
    const filters = parseRosterFilters(new URL("https://example.test/admin/students?paymentStatus=full_paid"));
    const where = buildRosterWhereClause(filters, { tenantId: null, allowedBranchIds: null });

    expect(where.payments).toBeUndefined();
  });
});

function rosterRow(overrides: { id: string; payments: Array<{ amount: number; level?: string; status?: string }> }): RosterRow {
  const now = new Date("2026-08-10T12:00:00Z");
  return {
    id: overrides.id,
    level: "A1",
    status: "active",
    classType: "group",
    deliveryMode: null,
    pathway: null,
    heldBackAt: null,
    classesStartedAt: null,
    createdAt: now,
    admission: null,
    tags: [],
    notStartedCount: 0,
    branch: { id: "lagos", name: "Lagos" },
    user: { name: "Test Student", email: "test@example.com" },
    profile: null,
    payments: overrides.payments.map((p, i) => ({
      id: `${overrides.id}-pay-${i}`,
      amount: p.amount,
      level: p.level ?? "A1",
      status: p.status ?? "completed",
      createdAt: now,
    })),
    tuitionCharges: [],
    attendances: [],
    videoProgress: [],
    journeyEvents: [],
    _count: { enrolments: 0 },
  } as unknown as RosterRow;
}

describe("scoreAndFilterRoster payment-status filter", () => {
  it("matches the full-paid cohort, not a raw payment row whose status happens to say 'completed'", () => {
    // One COMPLETED payment, but it's only a deposit on a ₦150,000 A1 tuition
    // — the roster badges this student "Deposit paid", not "Paid in full".
    const depositOnly = rosterRow({ id: "deposit-only", payments: [{ amount: 60_000, status: "completed" }] });
    const fullyPaid = rosterRow({ id: "fully-paid", payments: [{ amount: 150_000, status: "completed" }] });
    const nothingPaid = rosterRow({ id: "nothing-paid", payments: [] });

    const result = scoreAndFilterRoster(
      [depositOnly, fullyPaid, nothingPaid],
      { paymentStatus: "full_paid" },
      new Date("2026-08-10T12:00:00Z"),
    );

    expect(result.map((r) => r.student.id)).toEqual(["fully-paid"]);
  });
});
