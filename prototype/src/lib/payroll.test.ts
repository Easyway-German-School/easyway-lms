import { beforeEach, describe as suite, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    classSession: { count: vi.fn() },
    tutorPayRate: { findUnique: vi.fn(), findMany: vi.fn() },
    payrollPayment: { findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { isPayrollRateType, monthRange, payrollFiguresFor } from "./payroll";

const classSessionCount = prisma.classSession.count as unknown as ReturnType<typeof vi.fn>;
const rateFindUnique = prisma.tutorPayRate.findUnique as unknown as ReturnType<typeof vi.fn>;
const paymentFindMany = prisma.payrollPayment.findMany as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  classSessionCount.mockReset();
  rateFindUnique.mockReset();
  paymentFindMany.mockReset();
});

suite("isPayrollRateType", () => {
  it("accepts the two known rate types and rejects everything else", () => {
    expect(isPayrollRateType("per_class")).toBe(true);
    expect(isPayrollRateType("monthly")).toBe(true);
    expect(isPayrollRateType("percentage")).toBe(false);
    expect(isPayrollRateType(null)).toBe(false);
    expect(isPayrollRateType(undefined)).toBe(false);
  });
});

suite("monthRange", () => {
  it("spans the whole calendar month as [from, to)", () => {
    const { from, to, label } = monthRange(new Date(Date.UTC(2026, 8, 15))); // 15 Sep 2026
    expect(from.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(label).toBe("September 2026");
  });

  it("rolls December into January of the next year", () => {
    const { from, to } = monthRange(new Date(Date.UTC(2026, 11, 25)));
    expect(from.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

suite("payrollFiguresFor", () => {
  const from = new Date(Date.UTC(2026, 8, 1));
  const to = new Date(Date.UTC(2026, 9, 1));

  it("computes earned = rate x classes held for a per_class rate", async () => {
    rateFindUnique.mockResolvedValue({ lecturerId: "lec_1", rateType: "per_class", amount: 5000 });
    classSessionCount.mockResolvedValue(18);
    paymentFindMany.mockResolvedValue([{ amount: 40000 }, { amount: 20000 }]);

    const figures = await payrollFiguresFor("lec_1", from, to);

    expect(figures.earned).toBe(90000); // 5000 * 18
    expect(figures.paid).toBe(60000);
    expect(figures.owed).toBe(30000);
  });

  it("ignores classes held for a monthly rate — earned is the flat figure", async () => {
    rateFindUnique.mockResolvedValue({ lecturerId: "lec_2", rateType: "monthly", amount: 150000 });
    classSessionCount.mockResolvedValue(42); // must not affect earned
    paymentFindMany.mockResolvedValue([]);

    const figures = await payrollFiguresFor("lec_2", from, to);

    expect(figures.earned).toBe(150000);
    expect(figures.owed).toBe(150000);
  });

  it("never goes negative when the tutor has already been overpaid", async () => {
    rateFindUnique.mockResolvedValue({ lecturerId: "lec_3", rateType: "per_class", amount: 5000 });
    classSessionCount.mockResolvedValue(2);
    paymentFindMany.mockResolvedValue([{ amount: 50000 }]);

    const figures = await payrollFiguresFor("lec_3", from, to);

    expect(figures.earned).toBe(10000);
    expect(figures.paid).toBe(50000);
    expect(figures.owed).toBe(0);
  });

  it("returns a null earned/owed (not zero) when no rate has been set", async () => {
    rateFindUnique.mockResolvedValue(null);
    classSessionCount.mockResolvedValue(10);
    paymentFindMany.mockResolvedValue([]);

    const figures = await payrollFiguresFor("lec_4", from, to);

    expect(figures.rateType).toBeNull();
    expect(figures.earned).toBeNull();
    expect(figures.owed).toBeNull();
  });
});
