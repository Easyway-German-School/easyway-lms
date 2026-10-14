import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireCapability: vi.fn(),
  repairCapability: vi.fn(),
  runRepair: vi.fn(),
  can: vi.fn(),
}));

vi.mock("@/lib/admin-roles", () => ({
  requireCapability: (...args: unknown[]) => m.requireCapability(...args),
}));
vi.mock("@/lib/diagnose-server", () => ({
  repairCapability: (...args: unknown[]) => m.repairCapability(...args),
  runRepair: (...args: unknown[]) => m.runRepair(...args),
}));

import { POST } from "./route";

const request = (body: unknown) =>
  new Request("https://example.test/api/admin/developer/repair/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/admin/developer/repair/batch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.can.mockReturnValue(true);
    m.requireCapability.mockResolvedValue({ ok: true, admin: { can: m.can } });
    m.repairCapability.mockImplementation((id: string) => id === "assign_student_code" ? "students" : "payments");
    m.runRepair.mockResolvedValue({ ok: true, verified: true, message: "Fixed" });
  });

  it("runs only whitelisted safe repairs and returns their verified outcomes", async () => {
    const response = await POST(request({
      items: [
        { studentId: "s1", repairId: "sync_tuition_charge" },
        { studentId: "s2", repairId: "assign_student_code" },
      ],
    }));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(m.runRepair).toHaveBeenCalledTimes(2);
    expect(payload.results).toHaveLength(2);
    expect(payload.results.every((result: { outcome: { verified: boolean } }) => result.outcome.verified)).toBe(true);
  });

  it("refuses payment recording and other non-batchable repair IDs", async () => {
    const response = await POST(request({ items: [{ studentId: "s1", repairId: "record_paystack_payment" }] }));
    expect(response.status).toBe(400);
    expect(m.runRepair).not.toHaveBeenCalled();
  });

  it("reports missing per-repair capability without running the repair", async () => {
    m.can.mockImplementation((capability: string) => capability === "students");
    const response = await POST(request({ items: [{ studentId: "s1", repairId: "sync_tuition_charge" }] }));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(m.runRepair).not.toHaveBeenCalled();
    expect(payload.results[0].outcome).toMatchObject({ ok: false, verified: false });
    expect(payload.results[0].outcome.message).toContain("payments");
  });

  it("bounds each request to ten repairs", async () => {
    const items = Array.from({ length: 11 }, (_, index) => ({ studentId: `s${index}`, repairId: "sync_tuition_charge" }));
    const response = await POST(request({ items }));
    expect(response.status).toBe(400);
    expect(m.runRepair).not.toHaveBeenCalled();
  });
});
