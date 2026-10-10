import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  paymentFindMany: vi.fn(),
  paymentUpdateMany: vi.fn(),
  chargeFindMany: vi.fn(),
  chargeDeleteMany: vi.fn(),
  planFindMany: vi.fn(),
  planDeleteMany: vi.fn(),
  enrolmentFindMany: vi.fn(),
  enrolmentDeleteMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  guardedPrisma: {
    payment: { findMany: mocks.paymentFindMany, updateMany: mocks.paymentUpdateMany },
    tuitionCharge: { findMany: mocks.chargeFindMany, deleteMany: mocks.chargeDeleteMany },
    paymentPlan: { findMany: mocks.planFindMany, deleteMany: mocks.planDeleteMany },
    studentEnrolment: { findMany: mocks.enrolmentFindMany, deleteMany: mocks.enrolmentDeleteMany },
  },
  unguardedPrisma: {
    user: { findUnique: mocks.userFindUnique },
  },
}));

import { archiveDeletedAccountHistory } from "./deleted-account";

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
});

describe("archiveDeletedAccountHistory", () => {
  it("archives old charges, plans, and enrolments but preserves recorded payments", async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: "user_1",
      email: "student@example.com",
      tenantId: "tenant_1",
      deletedAt: new Date("2026-10-01T00:00:00Z"),
      student: { id: "student_1", deletedAt: new Date("2026-10-01T00:00:00Z") },
    });
    mocks.paymentFindMany.mockResolvedValue([{ id: "payment_1", tenantId: null }]);
    mocks.chargeFindMany.mockResolvedValue([{ id: "charge_1" }]);
    mocks.planFindMany.mockResolvedValue([{ id: "plan_1" }]);
    mocks.enrolmentFindMany.mockResolvedValue([{ id: "enrolment_1" }]);

    await archiveDeletedAccountHistory("user_1", "tenant_1");

    expect(mocks.chargeDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ["charge_1"] } } });
    expect(mocks.paymentUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["payment_1"] }, studentId: "student_1", tenantId: null },
      data: { tenantId: "tenant_1" },
    });
    expect(mocks.planDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ["plan_1"] } } });
    expect(mocks.enrolmentDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["enrolment_1"] } },
    });
  });

  it("does not alter a live account", async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: "user_1",
      email: "student@example.com",
      tenantId: "tenant_1",
      deletedAt: null,
      student: { id: "student_1", deletedAt: null },
    });

    await archiveDeletedAccountHistory("user_1", "tenant_1");

    expect(mocks.chargeFindMany).not.toHaveBeenCalled();
  });

  it("refuses to archive an account owned by another school", async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: "user_1",
      email: "student@example.com",
      tenantId: "tenant_other",
      deletedAt: new Date("2026-10-01T00:00:00Z"),
      student: { id: "student_1", deletedAt: new Date("2026-10-01T00:00:00Z") },
    });

    await expect(archiveDeletedAccountHistory("user_1", "tenant_1")).rejects.toThrow(
      "outside the current school",
    );
    expect(mocks.chargeFindMany).not.toHaveBeenCalled();
  });
});
