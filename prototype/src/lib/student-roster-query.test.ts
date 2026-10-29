import { describe, expect, it } from "vitest";
import { buildRosterWhereClause, parseRosterFilters } from "./student-roster-query";

describe("student roster enrolment-year filter", () => {
  it("matches the selected batch month and enrollment year together", () => {
    const filters = parseRosterFilters(new URL("https://example.test/admin/students?batch=January&year=2027"));
    const where = buildRosterWhereClause(filters, { tenantId: null, allowedBranchIds: null });

    expect(where.admission).toEqual({ path: ["batch"], equals: "January" });
    expect(where.enrolments).toEqual({
      some: { batchYear: 2027, deletedAt: null },
    });
  });
});
