import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  gate: { ok: true, session: { user: { tenantId: "tenant-1" } } } as unknown,
  liveSession: null as unknown,
  start: vi.fn(async (): Promise<string | null> => "recording-1"),
}));

vi.mock("@/lib/admin-roles", () => ({ requireCapability: vi.fn(async () => h.gate) }));
vi.mock("@/lib/prisma", () => ({
  prisma: { liveClassSession: { findFirst: vi.fn(async () => h.liveSession) } },
}));
vi.mock("@/lib/class-recorder", () => ({ ensureRecordingStarted: h.start }));

import { POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("http://x/api/admin/recorder/start", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  h.gate = { ok: true, session: { user: { tenantId: "tenant-1" } } };
  h.liveSession = {
    roomName: "private-room-1",
    branchId: "branch-1",
    level: "A1",
    sessionSlot: "evening",
    privateClassId: "private-1",
    startedByUserId: "tutor-user-1",
    branch: { name: "Online" },
    tenantId: "tenant-1",
  };
  h.start.mockClear();
  h.start.mockResolvedValue("recording-1");
});

describe("POST /api/admin/recorder/start", () => {
  it("refuses requests without the recording capability", async () => {
    h.gate = { ok: false, response: new Response("no", { status: 403 }) };
    expect((await post({ sessionId: "live-1" })).status).toBe(403);
    expect(h.start).not.toHaveBeenCalled();
  });

  it("requires a live session id", async () => {
    expect((await post({})).status).toBe(400);
    expect(h.start).not.toHaveBeenCalled();
  });

  it("starts the exact live room and preserves private-class scoping", async () => {
    const response = await post({ sessionId: "live-1" });
    expect(response.status).toBe(200);
    expect(h.start).toHaveBeenCalledWith({
      roomName: "private-room-1",
      tenantId: "tenant-1",
      branchId: "branch-1",
      branchName: "Online",
      level: "A1",
      sessionSlot: "evening",
      startedByUserId: "tutor-user-1",
      privateClassId: "private-1",
    });
  });

  it("does not start a class that is no longer live", async () => {
    h.liveSession = null;
    expect((await post({ sessionId: "live-1" })).status).toBe(404);
    expect(h.start).not.toHaveBeenCalled();
  });

  it("reports when the recorder could not start", async () => {
    h.start.mockResolvedValue(null);
    const response = await post({ sessionId: "live-1" });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/Recording did not start/);
  });
});
