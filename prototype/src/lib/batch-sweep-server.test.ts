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
        admission: { batch: "September" },
        createdAt,
        classesStartedAt: null,
        levelCompletedFor: null,
        sessionSlot: "morning",
        branch: { name: "Lagos" },
        user: { name: "Example Student", email: "student@example.com" },
      },
    ]);
    mocks.studentFindUnique.mockResolvedValue({
      admission: { batch: "September" },
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
  });

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
});
