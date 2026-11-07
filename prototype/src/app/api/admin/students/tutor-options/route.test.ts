import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  gate: { ok: true, admin: {} } as unknown,
  allowedBranchIds: ["branch-1"] as string[] | null,
  lecturers: [] as unknown[],
}));

vi.mock("@/lib/admin-roles", () => ({
  requireCapability: vi.fn(async () => h.gate),
  scopedBranchIds: vi.fn(() => h.allowedBranchIds),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { lecturer: { findMany: vi.fn(async () => h.lecturers) } },
}));

import { GET } from "./route";

beforeEach(() => {
  h.gate = { ok: true, admin: {} };
  h.allowedBranchIds = ["branch-1"];
  h.lecturers = [
    {
      id: "tutor-1",
      status: "active",
      branchId: "branch-1",
      level: "A1",
      sessionSlot: "morning",
      branchIds: ["branch-1"],
      levels: ["A1"],
      sessionSlots: ["morning"],
      user: { name: "Frau Tutor", email: "tutor@example.test" },
    },
    {
      id: "tutor-2",
      status: "active",
      branchId: "branch-2",
      level: "A2",
      sessionSlot: "evening",
      branchIds: ["branch-2"],
      levels: ["A2"],
      sessionSlots: ["evening"],
      user: { name: "Herr Tutor", email: "other@example.test" },
    },
  ];
});

describe("GET /api/admin/students/tutor-options", () => {
  it("allows student managers to load the small tutor picker list within their branch scope", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.lecturers).toHaveLength(1);
    expect(payload.lecturers[0]).toMatchObject({
      id: "tutor-1",
      status: "active",
      user: { name: "Frau Tutor" },
      assignment: { branchIds: ["branch-1"], levels: ["A1"] },
    });
    expect(payload.lecturers[0]).not.toHaveProperty("classes");
  });

  it("requires the student-management capability", async () => {
    h.gate = { ok: false, response: new Response("no", { status: 403 }) };
    expect((await GET()).status).toBe(403);
  });
});
