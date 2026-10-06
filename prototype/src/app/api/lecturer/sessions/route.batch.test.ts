import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cancelling or moving a class is the action that tells students — so it has to
 * be unmistakably FOR ONE BATCH. These drive the real PUT handler.
 */

const m = vi.hoisted(() => ({
  user: { id: "u1", role: "admin", lecturer: null as unknown },
  cohortBatches: [] as Array<{ batch: string; students: number }>,
  upserts: [] as any[],
  notifications: [] as any[],
  previous: null as unknown,
}));

vi.mock("@/lib/auth", () => ({ requireAuthSession: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn(async () => m.user) },
    classSession: {
      findFirst: vi.fn(async () => m.previous),
      upsert: vi.fn(async (args: any) => {
        m.upserts.push(args);
        return {
          ...args.create,
          status: args.create.status,
          postponedTo: args.create.postponedTo ?? null,
          materialId: null,
          material: null,
          lecturer: null,
        };
      }),
    },
  },
}));
vi.mock("@/lib/notify", () => ({
  KIND: { classStarting: "class-starting", materialPublished: "material" },
  notify: vi.fn(async (args: any) => {
    m.notifications.push(args);
    return { created: 1 };
  }),
}));
vi.mock("@/lib/class-batches-server", () => ({
  batchesForCohort: vi.fn(async () => ({ batches: m.cohortBatches, unplaced: 0 })),
}));
vi.mock("@/lib/tutor-classes-server", () => ({ tutorTeachingGroups: vi.fn(async () => []) }));

import { PUT } from "./route";

const put = (body: Record<string, unknown>) =>
  PUT(
    new Request("http://localhost/api/lecturer/sessions", {
      method: "PUT",
      body: JSON.stringify({
        branchId: "b1",
        level: "A1",
        timeSlot: "weekend",
        date: "2026-10-10T00:00:00.000Z",
        status: "cancelled",
        ...body,
      }),
    }) as never,
  );

const bothBatches = [
  { batch: "September", students: 14 },
  { batch: "October", students: 9 },
];

beforeEach(() => {
  m.user = { id: "u1", role: "admin", lecturer: null };
  m.cohortBatches = bothBatches;
  m.upserts = [];
  m.notifications = [];
  m.previous = null;
});

describe("saving a class day is always for one batch", () => {
  it("cancelling October's class writes October's row and tells only the October batch", async () => {
    const res = await put({ batch: "October" });
    expect(res.status).toBe(200);

    const key = m.upserts[0].where.branchId_level_date_timeSlot_batch;
    expect(key).toMatchObject({ branchId: "b1", level: "A1", timeSlot: "weekend", batch: "October" });
    expect(m.upserts[0].create.batch).toBe("October");

    expect(m.notifications).toHaveLength(1);
    const note = m.notifications[0];
    expect(note.to.students).toMatchObject({ branchId: "b1", level: "A1", sessionSlot: "weekend", batch: "October" });
    expect(note.title).toContain("October batch");
    // One announcement per batch per day — September's would not be swallowed by it.
    expect(note.dedupeKey).toContain(":October:");
  });

  it("cancelling September's and October's class on the same day are two separate announcements", async () => {
    await put({ batch: "September" });
    await put({ batch: "October" });
    expect(m.notifications.map((n) => n.to.students.batch)).toEqual(["September", "October"]);
    expect(m.notifications[0].dedupeKey).not.toBe(m.notifications[1].dedupeKey);
  });

  it("refuses to guess when the class has more than one batch and the request does not say which", async () => {
    const res = await put({});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("September, October");
    expect(body.batches).toEqual(bothBatches);
    // Nothing was written and nobody was told.
    expect(m.upserts).toHaveLength(0);
    expect(m.notifications).toHaveLength(0);
  });

  it("a class with a single batch (or none) still saves without one — nothing to confuse", async () => {
    m.cohortBatches = [{ batch: "October", students: 9 }];
    expect((await put({})).status).toBe(200);
    expect(m.upserts[0].create.batch).toBe("");
    // Told as before: no batch filter on the audience.
    expect(m.notifications[0].to.students.batch).toBeUndefined();
  });

  it("a tutor the office pinned to September cannot cancel October's class, or write a batch-less one", async () => {
    m.user = {
      id: "u1",
      role: "lecturer",
      lecturer: {
        id: "t1",
        branchId: "b1",
        level: "A1",
        sessionSlot: "weekend",
        branchIds: ["b1"],
        levels: ["A1"],
        sessionSlots: ["weekend"],
        assignmentGroups: [{ branchId: "b1", level: "A1", sessionSlot: "weekend", batch: "September" }],
        batches: [],
      },
    };
    expect((await put({ batch: "October" })).status).toBe(403);
    expect((await put({ batch: "" })).status).toBe(403);
    expect(m.upserts).toHaveLength(0);

    expect((await put({ batch: "September" })).status).toBe(200);
    expect(m.upserts[0].create.batch).toBe("September");
  });

  it("a tutor with every batch can edit either one, one at a time", async () => {
    m.user = {
      id: "u1",
      role: "lecturer",
      lecturer: {
        id: "t1",
        branchId: "b1",
        level: "A1",
        sessionSlot: "weekend",
        branchIds: ["b1"],
        levels: ["A1"],
        sessionSlots: ["weekend"],
        assignmentGroups: [{ branchId: "b1", level: "A1", sessionSlot: "weekend" }],
        batches: [],
      },
    };
    expect((await put({ batch: "October" })).status).toBe(200);
    expect((await put({ batch: "September" })).status).toBe(200);
    expect(m.upserts.map((u) => u.create.batch)).toEqual(["October", "September"]);
  });
});
