import { beforeEach, describe as suite, expect, it, vi } from "vitest";

/**
 * `ensureChargeForLevel` is the ONLY place a TuitionCharge is ever created —
 * see the file's own header comment. The one behaviour worth a regression
 * test is the Travel Package guard: since `tuitionFeeFor` now prices every
 * level the same flat ₦980,000 for that pathway, the ordinary "one charge per
 * level" uniqueness check would raise a fresh ₦980,000 charge at every
 * promotion. This must never happen — a Travel Package student gets exactly
 * one charge, ever, whichever level it was first raised at.
 */

vi.mock("@/lib/prisma", () => ({
  prisma: {
    student: { findUnique: vi.fn() },
    tuitionCharge: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { ensureChargeForLevel } from "./tuition-charges";

const studentFindUnique = prisma.student.findUnique as unknown as ReturnType<typeof vi.fn>;
const chargeFindUnique = prisma.tuitionCharge.findUnique as unknown as ReturnType<typeof vi.fn>;
const chargeFindFirst = prisma.tuitionCharge.findFirst as unknown as ReturnType<typeof vi.fn>;
const chargeCreate = prisma.tuitionCharge.create as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  studentFindUnique.mockReset();
  chargeFindUnique.mockReset();
  chargeFindFirst.mockReset();
  chargeCreate.mockReset();
});

suite("ensureChargeForLevel — Travel Package", () => {
  it("raises exactly one ₦980,000 charge for a Travel Package student's first level", async () => {
    studentFindUnique.mockResolvedValue({
      id: "stu_1",
      classType: "group",
      tenantId: null,
      pathway: "Travel Package",
      branch: { name: "Lagos" },
    });
    chargeFindFirst.mockResolvedValue(null); // no existing charge at all yet
    chargeFindUnique.mockResolvedValue(null); // no charge for this exact level either
    chargeCreate.mockResolvedValue({ id: "charge_1" });

    const result = await ensureChargeForLevel({ studentId: "stu_1", level: "A1", origin: "signup" });

    expect(result).toEqual({ created: true, chargeId: "charge_1", level: "A1", amount: 980000 });
    expect(chargeCreate).toHaveBeenCalledTimes(1);
    expect(chargeCreate.mock.calls[0][0].data.amount).toBe(980000);
  });

  it("does NOT raise a second charge when the student is promoted to a new level", async () => {
    studentFindUnique.mockResolvedValue({
      id: "stu_1",
      classType: "group",
      tenantId: null,
      pathway: "Travel Package",
      branch: { name: "Lagos" },
    });
    // The student already has their one Travel Package charge, raised at A1.
    chargeFindFirst.mockResolvedValue({ id: "charge_1", level: "A1", amount: 980000 });

    const result = await ensureChargeForLevel({ studentId: "stu_1", level: "A2", origin: "promotion" });

    expect(result).toEqual({ created: false, chargeId: "charge_1", level: "A1", amount: 980000 });
    expect(chargeCreate).not.toHaveBeenCalled();
  });

  it("an ordinary (non-Travel-Package) student still gets one charge per level, priced normally", async () => {
    studentFindUnique.mockResolvedValue({
      id: "stu_2",
      classType: "group",
      tenantId: null,
      pathway: "Language training",
      branch: { name: "Lagos" },
    });
    chargeFindUnique.mockResolvedValue(null); // no charge yet for THIS level
    chargeCreate.mockResolvedValue({ id: "charge_2" });

    const result = await ensureChargeForLevel({ studentId: "stu_2", level: "A1", origin: "signup" });

    expect(result).toEqual({ created: true, chargeId: "charge_2", level: "A1", amount: 150000 });
    // The Travel Package any-level lookup must not run for an ordinary pathway.
    expect(chargeFindFirst).not.toHaveBeenCalled();
  });
});
