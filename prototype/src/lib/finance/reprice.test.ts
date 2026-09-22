import { beforeEach, describe as suite, expect, it, vi } from "vitest";

/**
 * Re-pricing frozen tuition charges to the price list.
 *
 * The scenario behind these tests is real: a private A1 student was billed
 * ₦350,000 when the school charges ₦300,000. She paid ₦180,000 — exactly 60% of
 * the correct fee — and stayed locked out, because the portal lock reads the
 * frozen charge (60% of ₦350,000 is ₦210,000), not the price list. Fixing the
 * price list alone does nothing for her; this is what does.
 */

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tuitionCharge: { findMany: vi.fn(), update: vi.fn() },
    student: { findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { accessFromStudent } from "@/lib/student-access";
import { applyReprice, findChargesOutOfStep } from "./reprice";

const chargeFindMany = prisma.tuitionCharge.findMany as unknown as ReturnType<typeof vi.fn>;
const chargeUpdate = prisma.tuitionCharge.update as unknown as ReturnType<typeof vi.fn>;
const studentFindMany = prisma.student.findMany as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  chargeFindMany.mockReset();
  chargeUpdate.mockReset();
  studentFindMany.mockReset();
});

const CREATED = new Date("2026-09-07T10:00:00Z");

function chargeRow(over: Record<string, unknown> = {}) {
  return {
    id: "ch_mary",
    studentId: "stu_mary",
    level: "A1",
    amount: 350_000,
    classType: "private",
    branchName: "Lagos",
    origin: "signup",
    note: null,
    student: { pathway: "Language training", studentCode: "EW-001", user: { name: "Mary Cyril", email: "mary@example.com" } },
    ...over,
  };
}

/** The ledger-side read: every charge the student has, plus what they have paid. */
function ledgerStudent(charges: Array<Record<string, unknown>>, paid: number) {
  return {
    id: "stu_mary",
    tuitionCharges: charges.map((c) => ({
      id: c.id,
      level: c.level,
      amount: c.amount,
      waivedAmount: 0,
      legacyArrears: false,
      createdAt: CREATED,
      settledAt: null,
    })),
    payments: paid > 0 ? [{ amount: paid }] : [],
  };
}

suite("findChargesOutOfStep", () => {
  it("lists the wrongly-priced private A1 charge with the corrected figures", async () => {
    const charge = chargeRow();
    chargeFindMany.mockResolvedValue([charge]);
    studentFindMany.mockResolvedValue([ledgerStudent([charge], 180_000)]);

    const { rows, total } = await findChargesOutOfStep();

    expect(total).toBe(1);
    expect(rows[0]).toMatchObject({
      chargeId: "ch_mary",
      studentName: "Mary Cyril",
      currentAmount: 350_000,
      newAmount: 300_000,
      paid: 180_000,
      owedAfter: 120_000,
      overpaidBy: 0,
    });
  });

  it("asks only for charges that could be repriced: not waived, not legacy, not hand-typed, not deleted", async () => {
    chargeFindMany.mockResolvedValue([]);
    await findChargesOutOfStep();

    const where = chargeFindMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      deletedAt: null,
      legacyArrears: false,
      waivedAmount: 0,
      origin: { notIn: ["admin"] },
    });
  });

  it("skips a charge that already matches the price list", async () => {
    const charge = chargeRow({ amount: 300_000 });
    chargeFindMany.mockResolvedValue([charge]);
    studentFindMany.mockResolvedValue([ledgerStudent([charge], 100_000)]);

    expect((await findChargesOutOfStep()).total).toBe(0);
  });

  it("skips a charge the student has already settled — that is history, not a bill to reopen", async () => {
    const charge = chargeRow();
    chargeFindMany.mockResolvedValue([charge]);
    studentFindMany.mockResolvedValue([ledgerStudent([charge], 350_000)]);

    expect((await findChargesOutOfStep()).total).toBe(0);
  });

  it("leaves Travel Package students to their own reconcile", async () => {
    const charge = chargeRow({
      amount: 150_000,
      classType: "group",
      student: { pathway: "Travel Package", studentCode: null, user: { name: "Tp", email: "tp@example.com" } },
    });
    chargeFindMany.mockResolvedValue([charge]);
    studentFindMany.mockResolvedValue([ledgerStudent([charge], 0)]);

    expect((await findChargesOutOfStep()).total).toBe(0);
  });

  it("prices a charge off its OWN snapshot of class type and branch, not the student's record today", async () => {
    // Raised as group/Abuja (₦180,000). The price list agrees, so nothing to fix,
    // even if the student has since switched to private.
    const charge = chargeRow({ amount: 180_000, classType: "group", branchName: "Abuja" });
    chargeFindMany.mockResolvedValue([charge]);
    studentFindMany.mockResolvedValue([ledgerStudent([charge], 0)]);

    expect((await findChargesOutOfStep()).total).toBe(0);
  });

  it("flags a student who has already paid more than the corrected price", async () => {
    const charge = chargeRow();
    chargeFindMany.mockResolvedValue([charge]);
    studentFindMany.mockResolvedValue([ledgerStudent([charge], 320_000)]);

    const { rows } = await findChargesOutOfStep();
    expect(rows[0].overpaidBy).toBe(20_000);
    expect(rows[0].owedAfter).toBe(0);
  });

  it("shows a price INCREASE too — as a row for a person to decide on, never applied on its own", async () => {
    const charge = chargeRow({ id: "ch_b1", level: "B1", amount: 350_000 }); // list is ₦360,000
    chargeFindMany.mockResolvedValue([charge]);
    studentFindMany.mockResolvedValue([ledgerStudent([charge], 100_000)]);

    const { rows } = await findChargesOutOfStep();
    expect(rows[0]).toMatchObject({ currentAmount: 350_000, newAmount: 360_000 });
    expect(chargeUpdate).not.toHaveBeenCalled();
  });
});

suite("applyReprice", () => {
  it("writes the price list's figure and records why on the charge", async () => {
    const charge = chargeRow({ note: "Signed up at the front desk" });
    chargeFindMany.mockResolvedValue([charge]);
    studentFindMany.mockResolvedValue([ledgerStudent([charge], 180_000)]);
    chargeUpdate.mockResolvedValue({});

    const result = await applyReprice(["ch_mary"], new Date("2026-09-21T12:00:00Z"));

    expect(chargeUpdate).toHaveBeenCalledTimes(1);
    const call = chargeUpdate.mock.calls[0][0];
    expect(call.where).toEqual({ id: "ch_mary" });
    expect(call.data.amount).toBe(300_000);
    expect(call.data.note).toContain("Signed up at the front desk");
    expect(call.data.note).toContain("₦350,000 → ₦300,000");
    expect(call.data.note).toContain("2026-09-21");
    expect(result.updated).toEqual([{ chargeId: "ch_mary", studentName: "Mary Cyril", from: 350_000, to: 300_000 }]);
    expect(result.skipped).toEqual([]);
  });

  it("skips ids that are no longer eligible instead of writing anything for them", async () => {
    // The charge was already fixed (or settled) between the page loading and the click.
    chargeFindMany.mockResolvedValue([]);
    studentFindMany.mockResolvedValue([]);

    const result = await applyReprice(["ch_gone"]);

    expect(chargeUpdate).not.toHaveBeenCalled();
    expect(result).toEqual({ updated: [], skipped: ["ch_gone"] });
  });

  it("only ever looks at the ids it was given", async () => {
    chargeFindMany.mockResolvedValue([]);
    await applyReprice(["ch_a", "ch_a", "ch_b"]);
    expect(chargeFindMany.mock.calls[0][0].where.id).toEqual({ in: ["ch_a", "ch_b"] });
  });
});

suite("the point of it all: Mary's portal opens once her charge is corrected", () => {
  const student = (chargeAmount: number) => ({
    level: "A1",
    classType: "private",
    pathway: "Language training",
    classesStartedAt: null,
    createdAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
    paymentGraceUntil: null,
    admission: null,
    branch: { name: "Lagos", mode: "physical" },
    payments: [{ amount: 180_000 }],
    tuitionCharges: [
      { id: "ch_mary", level: "A1", amount: chargeAmount, waivedAmount: 0, legacyArrears: false, createdAt: new Date(), settledAt: null },
    ],
  });

  it("locked at a ₦350,000 charge (60% = ₦210,000), open at ₦300,000 (60% = ₦180,000)", () => {
    const before = accessFromStudent(student(350_000));
    expect(before.hasAccess).toBe(false);
    expect(before.lockReason).toBe("unpaid_deposit");
    expect(before.outstanding).toBe(30_000);

    const after = accessFromStudent(student(300_000));
    expect(after.hasAccess).toBe(true);
    expect(after.lockReason).toBeNull();
    expect(after.outstandingBalance).toBe(120_000);
  });
});
