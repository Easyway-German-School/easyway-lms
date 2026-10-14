import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireCapability: vi.fn(),
  scanDiagnoses: vi.fn(),
  can: vi.fn(),
}));

vi.mock("@/lib/admin-roles", () => ({
  requireCapability: (...args: unknown[]) => m.requireCapability(...args),
}));
vi.mock("@/lib/diagnose-server", () => ({
  scanDiagnoses: (...args: unknown[]) => m.scanDiagnoses(...args),
}));

import { POST } from "./route";

const request = (body: unknown) =>
  new Request("https://example.test/api/admin/developer/diagnose/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/admin/developer/diagnose/scan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.can.mockReturnValue(true);
    m.requireCapability.mockResolvedValue({ ok: true, admin: { can: m.can } });
    m.scanDiagnoses.mockResolvedValue({ students: [], errors: [], scanned: 0, total: 0, nextCursor: null });
  });

  it("requires security access and returns the scoped diagnosis page", async () => {
    const response = await POST(request({ cursor: "student-20" }));
    expect(m.requireCapability).toHaveBeenCalledWith("security");
    expect(m.scanDiagnoses).toHaveBeenCalledWith("student-20");
    expect(response.status).toBe(200);
  });

  it("rejects malformed cursors before scanning", async () => {
    const response = await POST(request({ cursor: "x".repeat(129) }));
    expect(response.status).toBe(400);
    expect(m.scanDiagnoses).not.toHaveBeenCalled();
  });

  it("returns the access gate response when the caller lacks security access", async () => {
    const denied = Response.json({ error: "Forbidden" }, { status: 403 });
    m.requireCapability.mockResolvedValue({ ok: false, response: denied });
    const response = await POST(request({}));
    expect(response.status).toBe(403);
    expect(m.scanDiagnoses).not.toHaveBeenCalled();
  });
});
