import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * September and October A1 morning overlap for a month. They must not share a
 * community room — and the chat that already exists must not vanish for the
 * students who were already talking in it.
 *
 * A small in-memory Space table stands in for the database, so these assert on
 * the behaviour (which room does each student land in?) rather than on which
 * Prisma calls were made.
 */

type SpaceRow = {
  id: string;
  branchId: string;
  level: string;
  sessionSlot: string;
  batch: string;
  name: string;
  description: string | null;
  tenantId: string | null;
};
type StudentRow = {
  id: string;
  userId: string;
  branchId: string;
  level: string;
  sessionSlot: string;
  status: string;
  classType: string;
  deliveryMode: string | null;
  hybridOnlineSlot: string | null;
  admission: unknown;
};

const db = vi.hoisted(() => ({
  spaces: [] as SpaceRow[],
  students: [] as StudentRow[],
  nextId: 1,
}));

const keyOf = (w: { branchId: string; level: string; sessionSlot: string; batch: string }) =>
  db.spaces.find(
    (s) => s.branchId === w.branchId && s.level === w.level && s.sessionSlot === w.sessionSlot && s.batch === w.batch,
  ) ?? null;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn(async () => ({ tenantId: null })) },
    branch: {
      findUnique: vi.fn(async () => ({ name: "Lagos", tenantId: null })),
      findFirst: vi.fn(async () => null),
    },
    channel: { upsert: vi.fn(async () => ({})) },
    space: {
      findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        if (where.id) return db.spaces.find((s) => s.id === where.id) ?? null;
        return keyOf(where.branchId_level_sessionSlot_batch as never);
      }),
      count: vi.fn(
        async ({ where }: { where: { branchId: string; level: string; sessionSlot: string; NOT: { batch: string } } }) =>
          db.spaces.filter(
            (s) =>
              s.branchId === where.branchId &&
              s.level === where.level &&
              s.sessionSlot === where.sessionSlot &&
              s.batch !== where.NOT.batch,
          ).length,
      ),
      upsert: vi.fn(async ({ where, create }: { where: Record<string, unknown>; create: Omit<SpaceRow, "id"> }) => {
        const found = keyOf(where.branchId_level_sessionSlot_batch as never);
        if (found) return found;
        const row = { id: `space-${db.nextId++}`, ...create } as SpaceRow;
        db.spaces.push(row);
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; batch: string }; data: Partial<SpaceRow> }) => {
        const row = db.spaces.find((s) => s.id === where.id && s.batch === where.batch);
        if (row) Object.assign(row, data);
        return { count: row ? 1 : 0 };
      }),
    },
    student: {
      findMany: vi.fn(async ({ where }: { where: Partial<StudentRow> }) =>
        db.students.filter(
          (s) =>
            s.branchId === where.branchId &&
            s.level === where.level &&
            s.sessionSlot === where.sessionSlot &&
            s.status === where.status,
        ),
      ),
      findUnique: vi.fn(async ({ where }: { where: { userId: string } }) => {
        const s = db.students.find((row) => row.userId === where.userId);
        return s ? { ...s, branch: { name: "Lagos" } } : null;
      }),
    },
    lecturer: { findUnique: vi.fn(async () => null) },
  },
}));

vi.mock("@/lib/school-settings-server", () => ({ readSessionSettings: vi.fn(async () => ({})) }));
vi.mock("@/lib/school-settings", () => ({ isSessionEnabled: () => true }));

import { ensureSpaceForCohort, resolveSpaceScope, spaceName, studentsInSpace } from "./community-spaces";

const student = (id: string, batch: string | null, extra: Partial<StudentRow> = {}): StudentRow => ({
  id,
  userId: `user-${id}`,
  branchId: "b1",
  level: "A1",
  sessionSlot: "morning",
  status: "active",
  classType: "group",
  deliveryMode: "physical",
  hybridOnlineSlot: null,
  admission: batch ? { batch } : {},
  ...extra,
});

const legacyRoom = (): SpaceRow => ({
  id: "legacy",
  branchId: "b1",
  level: "A1",
  sessionSlot: "morning",
  batch: "",
  name: "Lagos · A1 · Morning",
  description: "Morning A1 class at Lagos.",
  tenantId: null,
});

const cohort = { branchId: "b1", branchName: "Lagos", level: "A1", sessionSlot: "morning" };

beforeEach(() => {
  db.spaces = [];
  db.students = [];
  db.nextId = 1;
});

describe("a room is one batch of one sitting", () => {
  it("September and October students of the same sitting land in DIFFERENT rooms", async () => {
    db.students = [student("sep", "September"), student("oct", "October")];

    const sept = await resolveSpaceScope({ userId: "user-sep", role: "student" });
    const oct = await resolveSpaceScope({ userId: "user-oct", role: "student" });

    expect(sept.spaceIds).toHaveLength(1);
    expect(oct.spaceIds).toHaveLength(1);
    expect(sept.spaceIds[0]).not.toBe(oct.spaceIds[0]);

    // The students can read exactly their own room, and not each other's.
    expect(oct.spaceIds).not.toContain(sept.spaceIds[0]);
    expect(db.spaces.map((s) => s.name).sort()).toEqual([
      "Lagos · A1 · Morning · October batch",
      "Lagos · A1 · Morning · September batch",
    ]);
  });

  it("two students of the SAME batch share one room", async () => {
    db.students = [student("a", "October"), student("b", "october")];
    const a = await resolveSpaceScope({ userId: "user-a", role: "student" });
    const b = await resolveSpaceScope({ userId: "user-b", role: "student" });
    expect(a.spaceIds).toEqual(b.spaceIds);
    expect(db.spaces).toHaveLength(1);
  });

  it("a student with no batch on record gets the batch-less room, shared with no batch", async () => {
    db.students = [student("none", null), student("oct", "October")];
    const none = await resolveSpaceScope({ userId: "user-none", role: "student" });
    const oct = await resolveSpaceScope({ userId: "user-oct", role: "student" });
    expect(none.spaceIds[0]).not.toBe(oct.spaceIds[0]);
    expect(db.spaces.find((s) => s.id === none.spaceIds[0])?.batch).toBe("");
  });

  it("names the batch on the room", () => {
    expect(spaceName("Lagos", "A1", "morning", "September")).toBe("Lagos · A1 · Morning · September batch");
    expect(spaceName("Lagos", "A1", "morning", "")).toBe("Lagos · A1 · Morning");
  });
});

describe("the chat that already exists does not vanish", () => {
  it("is inherited by the cohort's longest-running batch", async () => {
    db.spaces = [legacyRoom()];
    db.students = [student("sep", "September"), student("oct", "October")];

    const sept = await ensureSpaceForCohort({ ...cohort, batch: "September" });

    // The room everybody was already writing in, now pinned to September.
    expect(sept?.id).toBe("legacy");
    expect(db.spaces.find((s) => s.id === "legacy")).toMatchObject({
      batch: "September",
      name: "Lagos · A1 · Morning · September batch",
    });
  });

  it("is NOT taken by the newer batch — October gets a fresh room, whoever asks first", async () => {
    db.spaces = [legacyRoom()];
    db.students = [student("sep", "September"), student("oct", "October")];

    const oct = await ensureSpaceForCohort({ ...cohort, batch: "October" });
    expect(oct?.id).not.toBe("legacy");
    expect(db.spaces.find((s) => s.id === "legacy")?.batch).toBe("");

    // …and September still inherits it afterwards.
    const sept = await ensureSpaceForCohort({ ...cohort, batch: "September" });
    expect(sept?.id).toBe("legacy");
  });

  it("is only ever adopted once", async () => {
    db.spaces = [legacyRoom()];
    db.students = [student("sep", "September"), student("oct", "October")];
    await ensureSpaceForCohort({ ...cohort, batch: "September" });
    await ensureSpaceForCohort({ ...cohort, batch: "September" });
    await ensureSpaceForCohort({ ...cohort, batch: "October" });
    expect(db.spaces).toHaveLength(2);
    expect(db.spaces.filter((s) => s.batch === "September")).toHaveLength(1);
  });

  it("leaves the old room alone for the students with no batch", async () => {
    db.spaces = [legacyRoom()];
    db.students = [student("none", null)];
    const room = await ensureSpaceForCohort({ ...cohort, batch: "" });
    expect(room?.id).toBe("legacy");
    expect(db.spaces).toHaveLength(1);
  });

  it("is never taken from students with no batch who still sit in it", async () => {
    // The office is placing students one by one. The first placed student must
    // not walk off with the room everybody else is still writing in.
    db.spaces = [legacyRoom()];
    db.students = [student("placed", "September"), student("waiting1", null), student("waiting2", null)];

    const sept = await ensureSpaceForCohort({ ...cohort, batch: "September" });
    expect(sept?.id).not.toBe("legacy");
    expect(db.spaces.find((s) => s.id === "legacy")).toMatchObject({ batch: "", name: "Lagos · A1 · Morning" });

    const waiting = await ensureSpaceForCohort({ ...cohort, batch: "" });
    expect(waiting?.id).toBe("legacy");
  });
});

describe("telling a room", () => {
  it("reaches that batch's students and nobody else", async () => {
    db.students = [student("sep", "September"), student("oct1", "October"), student("oct2", "October"), student("none", null)];

    const october = await studentsInSpace({ branchId: "b1", level: "A1", sessionSlot: "morning", batch: "October" });
    expect(october.map((s) => s.id).sort()).toEqual(["oct1", "oct2"]);

    const september = await studentsInSpace({ branchId: "b1", level: "A1", sessionSlot: "morning", batch: "September" });
    expect(september.map((s) => s.id)).toEqual(["sep"]);

    // The batch-less room is exactly the students with no batch.
    const unplaced = await studentsInSpace({ branchId: "b1", level: "A1", sessionSlot: "morning", batch: "" });
    expect(unplaced.map((s) => s.id)).toEqual(["none"]);
  });
});
