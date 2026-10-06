import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A tutor with September AND October students must say which class an upload is
 * for. These drive the real POST handler.
 */

const m = vi.hoisted(() => ({
  classes: [] as Array<{ key: string; label: string; level: string; batch: string | null; branchName: string; branchId: string; sessionSlot: string }>,
  students: [] as Array<{ id: string; level: string; admission: unknown }>,
  created: [] as any[],
  notified: [] as any[],
}));

vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: () => undefined }));
vi.mock("@/lib/auth", () => ({ requireAuthSession: vi.fn(async () => ({ user: { id: "u1", role: "lecturer" } })) }));
vi.mock("@/lib/lecturer", () => ({ resolveLecturerId: vi.fn(async () => "t1") }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    lecturer: {
      findUnique: vi.fn(async () => ({
        id: "t1",
        branchId: "b1",
        level: "A1",
        sessionSlot: "morning",
        branchIds: ["b1"],
        levels: ["A1"],
        sessionSlots: ["morning"],
        assignmentGroups: [{ branchId: "b1", level: "A1", sessionSlot: "morning" }],
        batches: [],
      })),
    },
    branch: { findMany: vi.fn(async () => [{ id: "b1", name: "Lagos" }]) },
    material: {
      create: vi.fn(async ({ data }: any) => {
        m.created.push(data);
        return { id: "mat1", ...data, course: null, createdAt: new Date(), aiState: "pending", uploadedBy: null };
      }),
    },
    student: { findMany: vi.fn(async () => m.students.map((s) => ({ ...s, tutorId: "t1", coTutors: [] }))) },
  },
}));
vi.mock("@/lib/tutor-classes-server", () => ({ tutorTeachingGroups: vi.fn(async () => m.classes) }));
vi.mock("@/lib/notify", () => ({
  KIND: { materialPublished: "material" },
  notify: vi.fn(async (args: any) => {
    m.notified.push(args);
    return { created: args.to.studentIds.length };
  }),
}));
vi.mock("@/lib/tutor-attribution", () => ({
  groupStudentsByTutorPhrase: vi.fn(async (ids: string[]) => new Map([["Your tutor", ids]])),
}));
vi.mock("@/lib/material-ai", () => ({ generateForMaterial: vi.fn(async () => undefined) }));

import { POST } from "./route";

const upload = (body: Record<string, unknown>) =>
  POST(
    new Request("http://localhost/api/lecturer/materials", {
      method: "POST",
      body: JSON.stringify({
        title: "Handout",
        fileUrl: "https://files.example/handout.pdf",
        fileName: "handout.pdf",
        fileType: "application/pdf",
        fileSize: 1000,
        level: "A1",
        ...body,
      }),
    }) as never,
  );

const cls = (batch: string | null) => ({
  key: batch ? `b1:A1:morning:${batch}` : "b1:A1:morning",
  label: batch ? `A1 · Morning · ${batch} batch` : "A1 · Morning",
  level: "A1",
  batch,
  branchName: "Lagos",
  branchId: "b1",
  sessionSlot: "morning",
});

beforeEach(() => {
  m.classes = [cls("September"), cls("October")];
  m.students = [
    { id: "sep1", level: "A1", admission: { batch: "September" } },
    { id: "oct1", level: "A1", admission: { batch: "October" } },
    { id: "oct2", level: "A1", admission: { batch: "october" } },
    { id: "none", level: "A1", admission: {} },
  ];
  m.created = [];
  m.notified = [];
});

describe("a tutor's upload is for one class", () => {
  it("aimed at the October class: stored for that batch, and ONLY October's students are told", async () => {
    const res = await upload({ classKey: "b1:A1:morning:October" });
    expect(res.status).toBe(200);
    expect(m.created[0]).toMatchObject({ batch: "October", level: "A1", lecturerId: "t1" });

    expect(m.notified).toHaveLength(1);
    expect(m.notified[0].to.studentIds.sort()).toEqual(["oct1", "oct2"]);
  });

  it("aimed at the September class, September only — a student with no batch is not guessed in", async () => {
    await upload({ classKey: "b1:A1:morning:September" });
    expect(m.created[0].batch).toBe("September");
    expect(m.notified[0].to.studentIds).toEqual(["sep1"]);
  });

  it("'all my classes' is explicit and reaches every batch, as before", async () => {
    const res = await upload({ classKey: "all" });
    expect(res.status).toBe(200);
    expect(m.created[0].batch).toBeNull();
    expect(m.notified[0].to.studentIds.sort()).toEqual(["none", "oct1", "oct2", "sep1"]);
  });

  it("refuses to guess: a tutor with two batches who does not say which gets a 400, nothing saved", async () => {
    const res = await upload({});
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Choose which class");
    expect(m.created).toHaveLength(0);
    expect(m.notified).toHaveLength(0);
  });

  it("refuses a class that is not the tutor's", async () => {
    const res = await upload({ classKey: "b9:A1:morning:October" });
    expect(res.status).toBe(403);
    expect(m.created).toHaveLength(0);
  });

  it("a tutor with a single class and no batch split still uploads without choosing", async () => {
    m.classes = [cls(null)];
    const res = await upload({});
    expect(res.status).toBe(200);
    expect(m.created[0].batch).toBeNull();
  });
});
