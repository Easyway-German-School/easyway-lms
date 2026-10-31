import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueInvite = vi.fn();
const upsertInvite = vi.fn(async () => ({}));
const findUniqueSession = vi.fn();
const studentFindUnique = vi.fn();
const studentUpdate = vi.fn(async () => ({}));
const journeyEventCreate = vi.fn(async () => ({}));
const inviteUpdateMany = vi.fn(async () => ({ count: 1 }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    liveClassInvite: { findUnique: findUniqueInvite, upsert: upsertInvite, updateMany: inviteUpdateMany },
    liveClassSession: { findUnique: findUniqueSession },
    student: { findUnique: studentFindUnique, update: studentUpdate },
    journeyEvent: { create: journeyEventCreate },
  },
}));

describe("live join start tracking", () => {
  beforeEach(() => {
    findUniqueInvite.mockReset();
    upsertInvite.mockClear();
    findUniqueSession.mockReset();
    studentFindUnique.mockReset();
    studentUpdate.mockClear();
    journeyEventCreate.mockClear();
    inviteUpdateMany.mockClear();
  });

  it(
    "marks a student as started when they join a live class for the first time",
    async () => {
      const startedAt = new Date("2026-10-05T08:30:00Z");
      findUniqueInvite.mockResolvedValue(null);
      findUniqueSession.mockResolvedValue({ startedAt });
      studentFindUnique.mockResolvedValue({ classesStartedAt: null });

      const { recordAttendance } = await import("./live-presence");
      await recordAttendance("session-1", "student-1");

      expect(studentUpdate).toHaveBeenCalledWith({
        where: { id: "student-1" },
        data: {
          classesStartedAt: startedAt,
          startConfirmedAt: startedAt,
          startConfirmedVia: "attendance",
          startPromptSnoozedUntil: null,
        },
      });
      expect(journeyEventCreate).toHaveBeenCalledWith({
        data: {
          studentId: "student-1",
          type: "started",
          stage: "firstDay",
          label: "Joined a live class",
          detail: "Confirmed from the first live class join.",
          source: "attendance",
          occurredAt: startedAt,
        },
      });
    },
    30_000,
  );

  it(
    "does not overwrite an existing started date",
    async () => {
      const startedAt = new Date("2026-10-02T09:00:00Z");
      findUniqueInvite.mockResolvedValue({ joinedAt: null });
      findUniqueSession.mockResolvedValue({ startedAt: new Date("2026-10-05T08:30:00Z") });
      studentFindUnique.mockResolvedValue({ classesStartedAt: startedAt });

      const { recordAttendance } = await import("./live-presence");
      await recordAttendance("session-1", "student-2");

      expect(studentUpdate).not.toHaveBeenCalled();
      expect(journeyEventCreate).not.toHaveBeenCalled();
    },
    30_000,
  );
});
