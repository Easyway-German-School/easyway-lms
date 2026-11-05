import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  studentFindMany: vi.fn(),
  studentFindUnique: vi.fn(),
  studentUpdate: vi.fn(),
  enrolmentFindMany: vi.fn(),
  enrolmentUpdateMany: vi.fn(),
  transaction: vi.fn(),
  journeyEventCreate: vi.fn(),
  scanDeskCandidates: vi.fn(),
  writeAudit: vi.fn(),
  recordIncident: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    student: {
      findMany: mocks.studentFindMany,
      findUnique: mocks.studentFindUnique,
      update: mocks.studentUpdate,
    },
    studentEnrolment: {
      findMany: mocks.enrolmentFindMany,
      updateMany: mocks.enrolmentUpdateMany,
    },
    $transaction: mocks.transaction,
    journeyEvent: { create: mocks.journeyEventCreate },
  },
  unguardedPrisma: {},
}));
vi.mock("@/lib/graduation-server", () => ({
  scanDeskCandidates: mocks.scanDeskCandidates,
}));
vi.mock("@/lib/prisma-guard", () => ({
  writeAudit: mocks.writeAudit,
}));
vi.mock("@/lib/incidents", () => ({
  recordIncident: mocks.recordIncident,
}));

import { moveIntoBatch } from "@/lib/batch-sweep-server";

describe("moveIntoBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const createdAt = new Date("2026-08-10T10:00:00.000Z");
    mocks.studentFindMany.mockResolvedValue([
      {
        id: "student-1",
        status: "active",
        level: "A1",
        // No batch on record at all — a learner the sweep can safely re-point, unlike one
        // with their own valid, different batch label (that case belongs to that other
        // batch's own sweep, not this one — see classifySweep.test.ts).
        admission: {},
        createdAt,
        classesStartedAt: null,
        levelCompletedFor: null,
        sessionSlot: "morning",
        branch: { name: "Lagos" },
        user: { name: "Example Student", email: "student@example.com" },
      },
    ]);
    mocks.studentFindUnique.mockResolvedValue({
      admission: {},
      classesStartedAt: null,
      createdAt,
    });
    mocks.studentUpdate.mockResolvedValue({});
    mocks.enrolmentFindMany.mockResolvedValue([]);
    mocks.enrolmentUpdateMany.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation((operations: Promise<unknown>[]) => Promise.all(operations));
    mocks.journeyEventCreate.mockResolvedValue({});
    mocks.scanDeskCandidates.mockResolvedValue([]);
    mocks.writeAudit.mockResolvedValue(undefined);
    mocks.recordIncident.mockResolvedValue(undefined);
  });

  /** A batch of `count` learners, none with a batch label, all legitimately movable. */
  function bigBatch(count: number, createdAt: Date) {
    return Array.from({ length: count }, (_, i) => ({
      id: `student-${i + 1}`,
      status: "active",
      level: "A1",
      admission: {},
      createdAt,
      classesStartedAt: null,
      levelCompletedFor: null,
      sessionSlot: "morning",
      branch: { name: "Lagos" },
      user: { name: `Student ${i + 1}`, email: `student${i + 1}@example.com` },
    }));
  }

  it("updates the active enrolment year and batch together with the student record", async () => {
    const result = await moveIntoBatch(["student-1"], {
      fromMonth: "August",
      toMonth: "October",
      now: new Date("2026-08-15T10:00:00.000Z"),
    });

    expect(result.moved).toEqual([{ studentId: "student-1", name: "Example Student" }]);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.studentUpdate).toHaveBeenCalledWith({
      where: { id: "student-1" },
      data: {
        admission: { batch: "October", batchYear: 2026 },
        classesStartedAt: new Date("2026-08-15T10:00:00.000Z"),
      },
    });
    expect(mocks.enrolmentUpdateMany).toHaveBeenCalledWith({
      where: { studentId: "student-1", outcome: "ongoing", deletedAt: null },
      data: { batchMonth: "October", batchYear: 2026 },
    });
  });

  it("writes nothing and asks for confirmation when the eligible total crosses the quiet threshold", async () => {
    const createdAt = new Date("2026-08-10T10:00:00.000Z");
    const students = bigBatch(35, createdAt);
    mocks.studentFindMany.mockResolvedValue(students);

    const result = await moveIntoBatch(
      students.slice(0, 10).map((s) => s.id),
      { fromMonth: "August", toMonth: "October", now: new Date("2026-08-15T10:00:00.000Z") },
    );

    expect(result.needsConfirmation).toEqual({ total: 35 });
    expect(result.moved).toEqual([]);
    expect(mocks.studentUpdate).not.toHaveBeenCalled();
    expect(mocks.recordIncident).not.toHaveBeenCalled();
  });

  it("moves everyone and pages Mission Control once the exact total is confirmed back", async () => {
    const createdAt = new Date("2026-08-10T10:00:00.000Z");
    const students = bigBatch(35, createdAt);
    mocks.studentFindMany.mockResolvedValue(students);
    mocks.studentFindUnique.mockResolvedValue({ admission: {}, classesStartedAt: null, createdAt });

    const result = await moveIntoBatch(
      students.map((s) => s.id),
      { fromMonth: "August", toMonth: "October", now: new Date("2026-08-15T10:00:00.000Z"), confirmedTotal: 35 },
    );

    expect(result.needsConfirmation).toBeUndefined();
    expect(result.moved).toHaveLength(35);
    expect(mocks.recordIncident).toHaveBeenCalledTimes(1);
    expect(mocks.recordIncident).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "drift", severity: "critical", context: expect.objectContaining({ movedCount: 35 }) }),
    );
  });
});
