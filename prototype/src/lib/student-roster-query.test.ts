import { describe, expect, it } from "vitest";
import { buildRosterWhereClause } from "@/lib/student-roster-query";

describe("student roster visibility", () => {
  it("does not use adminRole to exclude student accounts", () => {
    const where = buildRosterWhereClause(
      {},
      { tenantId: "tenant-1", allowedBranchIds: null },
    );

    expect(where.user).toEqual({ is: { role: "STUDENT" } });
    expect(where.OR).toEqual([
      { branch: { tenantId: "tenant-1" } },
      { user: { tenantId: "tenant-1" } },
    ]);
  });
});