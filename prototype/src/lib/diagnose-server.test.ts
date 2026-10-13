import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  studentFind: vi.fn(),
  paymentFind: vi.fn(),
  snapshotFind: vi.fn(),
  verify: vi.fn(),
  assignCode: vi.fn(),
  audit: vi.fn(),
  fetch: vi.fn(),
  accessFromStudent: vi.fn(),
  ensureCharge: vi.fn(),
  chargeFind: vi.fn(),
  chargeUpdate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    student: { findUnique: (...a: unknown[]) => m.studentFind(...a), findMany: vi.fn() },
    payment: { findMany: (...a: unknown[]) => m.paymentFind(...a) },
    accessSnapshot: { findUnique: (...a: unknown[]) => m.snapshotFind(...a) },
    tuitionCharge: {
      findUnique: (...a: unknown[]) => m.chargeFind(...a),
      update: (...a: unknown[]) => m.chargeUpdate(...a),
    },
  },
  unguardedPrisma: {},
}));
vi.mock("@/lib/prisma-guard", () => ({ writeAudit: (...a: unknown[]) => m.audit(...a) }));
vi.mock("@/lib/paystack-verify", () => ({ verifyPaystackTransaction: (...a: unknown[]) => m.verify(...a) }));
vi.mock("@/lib/student-code", () => ({ assignStudentCode: (...a: unknown[]) => m.assignCode(...a) }));
vi.mock("@/lib/payment-plans", () => ({ planStatusForStudent: async () => null, planSuppressesLock: () => false }));
vi.mock("@/lib/student-access", () => ({
  STUDENT_ACCESS_SELECT: {},
  accessFromStudent: (...a: unknown[]) => m.accessFromStudent(...a),
}));
vi.mock("@/lib/tuition-charges", () => ({ ensureChargeForLevel: (...a: unknown[]) => m.ensureCharge(...a) }));
vi.mock("@/lib/guarded-fetch", () => ({
  guardedFetch: (...a: unknown[]) => m.fetch(...a),
  isCircuitOpen: (e: unknown) => (e as Error)?.name === "BreakerOpenError",
}));

import { repairCapability, runDiagnosis, runRepair } from "./diagnose-server";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const rawTx = (over: Record<string, unknown> = {}) => ({
  reference: "PSK-123456", status: "success", amount: 15_000_000, currency: "NGN", paid_at: "2026-09-18T10:00:00Z",
  customer: { email: "ada@example.com" }, metadata: { userId: "u1", studentId: "s1" }, ...over,
});

/** A little in-memory world the mocks read from, so "after the repair" really is different. */
let world: { code: string | null; payments: Array<{ id: string; amount: number; status: string; method: string; stripeSessionId: string | null; paymentIntentId: string | null; createdAt: Date }>; paystack: unknown[] };

beforeEach(() => {
  // fetchPaystackTransactions refuses to run with no key (correctly), so the tests need a dummy one.
  process.env.PAYSTACK_SECRET_KEY = "sk_test_dummy";
  Object.values(m).forEach((fn) => fn.mockReset());
  world = { code: "EW/2026/B1/SEP/A001", payments: [], paystack: [rawTx()] };

  m.studentFind.mockImplementation(async () => ({
    id: "s1", studentCode: world.code, tenantId: "t1", level: "B1", classType: "group", admission: { photoUrl: "x.jpg" }, branch: null,
    user: { id: "u1", email: "ada@example.com", name: "Ada", tenantId: "t1" },
  }));
  m.paymentFind.mockImplementation(async () => world.payments);
  m.snapshotFind.mockResolvedValue(null);
  m.audit.mockResolvedValue(undefined);
  m.fetch.mockImplementation(async (_provider: string, url: string) => {
    if (url.includes("/customer/")) return json({ data: { id: 42 } });
    if (url.includes("/transaction?customer=")) return json({ data: world.paystack });
    if (url.includes("/transaction/verify/")) return json({ data: world.paystack[0] });
    return json({}, 404);
  });
  // The real repair records the payment; simulate exactly that side effect.
  m.verify.mockImplementation(async (reference: string) => {
    world.payments = [{ id: "p1", amount: 150_000, status: "completed", method: "paystack", stripeSessionId: reference, paymentIntentId: reference, createdAt: new Date() }];
    return { success: true };
  });
  m.assignCode.mockImplementation(async () => {
    world.code = "EW/2026/B1/SEP/A002";
    return world.code;
  });
  m.accessFromStudent.mockImplementation(() => ({
    hasAccess: true, lockReason: null, totalPaid: 0, currentLevelPaid: 0, tuitionFee: 400_000, requiredDeposit: 240_000, outstanding: 240_000, graceUntil: null, batchLabel: null,
  }));
  m.ensureCharge.mockImplementation(async () => ({ created: true, chargeId: "c1", level: "B1", amount: 400_000 }));
  m.chargeFind.mockResolvedValue(null);
  m.chargeUpdate.mockResolvedValue(undefined);
});

describe("runDiagnosis", () => {
  it("does not touch Paystack unless the deep check is asked for", async () => {
    await runDiagnosis("s1");
    expect(m.fetch).not.toHaveBeenCalled();
  });

  it("the deep check finds a payment Paystack has and we do not (the missed webhook)", async () => {
    const result = await runDiagnosis("s1", { paystack: true });
    const finding = result!.diagnosis.findings.find((f) => f.rule === "paid-not-recorded")!;
    expect(finding.offers[0].params.reference).toBe("PSK-123456");
    expect(result!.paystack).toMatchObject({ checked: true, transactionsSeen: 1 });
  });

  it("reports honestly when Paystack cannot be reached, instead of pretending all is well", async () => {
    m.fetch.mockRejectedValue(Object.assign(new Error("open"), { name: "BreakerOpenError" }));
    const result = await runDiagnosis("s1", { paystack: true });
    expect(result!.paystack.checked).toBe(false);
    expect(result!.paystack.error).toMatch(/paused for a moment/);
    expect(result!.diagnosis.findings.some((f) => f.rule === "paid-not-recorded")).toBe(false);
  });

  it("treats a 404 on the customer as an answer (never paid with this email), not an error", async () => {
    m.fetch.mockImplementation(async (_p: string, url: string) => (url.includes("/customer/") ? json({}, 404) : json({ data: [] })));
    const result = await runDiagnosis("s1", { paystack: true });
    expect(result!.paystack).toMatchObject({ checked: true, transactionsSeen: 0 });
  });

  it("returns null for a student that does not exist", async () => {
    m.studentFind.mockResolvedValue(null);
    expect(await runDiagnosis("nope")).toBeNull();
  });
});

describe("runRepair — record_paystack_payment", () => {
  const run = (reference = "PSK-123456") => runRepair({ studentId: "s1", repairId: "record_paystack_payment", params: { reference } });

  it("records the payment ONCE, verifies the problem is gone, and writes the audit entry", async () => {
    const outcome = await run();
    expect(m.verify).toHaveBeenCalledTimes(1);
    expect(m.verify).toHaveBeenCalledWith("PSK-123456");
    expect(outcome).toMatchObject({ ok: true, verified: true });
    expect(m.audit).toHaveBeenCalledTimes(1);
    expect(m.audit.mock.calls[0][1]).toMatchObject({ action: "repair", model: "Student", recordId: "s1", severity: "high" });
    expect(m.audit.mock.calls[0][1].summary).toContain("record_paystack_payment");
  });

  it("does NOTHING when the payment is already recorded — a stale click or a second admin", async () => {
    world.payments = [{ id: "p1", amount: 150_000, status: "completed", method: "paystack", stripeSessionId: "PSK-123456", paymentIntentId: null, createdAt: new Date() }];
    const outcome = await run();
    expect(m.verify).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
    expect(outcome.message).toMatch(/nothing to do/i);
  });

  it("is idempotent: running it twice records once", async () => {
    await run();
    await run();
    expect(m.verify).toHaveBeenCalledTimes(1);
  });

  it("refuses a reference that belongs to a DIFFERENT student, even if the email matches", async () => {
    world.paystack = [rawTx({ metadata: { userId: "u9", studentId: "s9" } })];
    const outcome = await run();
    expect(m.verify).not.toHaveBeenCalled();
    expect(outcome.message).toMatch(/nothing to do/i);
  });

  it("refuses a forged reference the diagnosis never found", async () => {
    await run("PSK-FORGED-000");
    expect(m.verify).not.toHaveBeenCalled();
  });

  it("finds a receipt the email lookup missed when the reference is supplied", async () => {
    world.paystack = []; // the list is empty…
    m.fetch.mockImplementation(async (_p: string, url: string) => {
      if (url.includes("/customer/")) return json({ data: { id: 42 } });
      if (url.includes("/transaction?customer=")) return json({ data: [] });
      if (url.includes("/transaction/verify/")) return json({ data: rawTx({ reference: "PSK-OTHER-EMAIL", customer: { email: "parent@x.com" } }) });
      return json({}, 404);
    });
    await run("PSK-OTHER-EMAIL"); // …but the metadata names this student, so it is theirs
    expect(m.verify).toHaveBeenCalledWith("PSK-OTHER-EMAIL");
  });

  it("stops and says so when Paystack will not confirm — no retry, no false success, still audited", async () => {
    m.verify.mockResolvedValue({ success: false, error: "Transaction not successful" });
    const outcome = await run();
    expect(m.verify).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ ok: false, verified: false });
    expect(outcome.message).toContain("not successful");
    expect(m.audit).toHaveBeenCalledTimes(1);
  });

  it("tells the office to reconcile by hand when the charge is real but could not be written", async () => {
    m.verify.mockResolvedValue({ success: true, persistFailed: true });
    const outcome = await run();
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/by hand/i);
  });

  it("says 'done, but it is still there' when the repair ran and the re-check disagrees", async () => {
    m.verify.mockResolvedValue({ success: true }); // claims success but writes nothing
    const outcome = await run();
    expect(outcome).toMatchObject({ ok: true, verified: false });
    expect(outcome.message).toMatch(/still shows the problem/i);
  });

  it("a thrown error is caught, reported, and audited — never propagated as a 500", async () => {
    m.verify.mockRejectedValue(new Error("db exploded"));
    const outcome = await run();
    expect(outcome).toMatchObject({ ok: false, verified: false });
    expect(outcome.message).toContain("db exploded");
  });

  it("does not let a failing audit write undo or hide the repair", async () => {
    m.audit.mockRejectedValue(new Error("audit down"));
    await expect(run()).resolves.toMatchObject({ ok: true, verified: true });
  });
});

describe("runRepair — assign_student_code", () => {
  it("issues a code to a student without one, verifies it, and audits", async () => {
    world.code = null;
    const outcome = await runRepair({ studentId: "s1", repairId: "assign_student_code" });
    expect(m.assignCode).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ ok: true, verified: true });
    expect(outcome.message).toContain("A002");
    expect(m.audit).toHaveBeenCalledTimes(1);
  });

  it("never touches a student who already has a code", async () => {
    const outcome = await runRepair({ studentId: "s1", repairId: "assign_student_code" });
    expect(m.assignCode).not.toHaveBeenCalled();
    expect(outcome.message).toMatch(/nothing to do/i);
  });

  it("reports failure honestly when no free code can be allocated", async () => {
    world.code = null;
    m.assignCode.mockResolvedValue(null);
    expect(await runRepair({ studentId: "s1", repairId: "assign_student_code" })).toMatchObject({ ok: false, verified: false });
  });
});

describe("runRepair — sync_tuition_charge", () => {
  // The B1 student has paid ₦400,000 lifetime (enough to cover the ₦400,000
  // B1 fee) but the ledger credits none of it to B1 — the exact "level
  // correction skipped ensureChargeForLevel" drift this repair exists for.
  // `healed` stands in for the real DB: false until ensureChargeForLevel
  // "runs", so the server's own re-derive-and-verify step sees a real change,
  // the same way world.payments/world.code do for the other two repairs.
  const drifted = () => ({
    hasAccess: false, lockReason: "unpaid_deposit", totalPaid: 400_000, currentLevelPaid: 0,
    tuitionFee: 400_000, requiredDeposit: 240_000, outstanding: 240_000, graceUntil: null, batchLabel: null,
  });
  const settled = () => ({ ...drifted(), hasAccess: true, lockReason: null, currentLevelPaid: 400_000, outstanding: 0 });

  it("raises the missing charge, verifies the finding clears, and audits", async () => {
    let healed = false;
    m.accessFromStudent.mockImplementation(() => (healed ? settled() : drifted()));
    m.ensureCharge.mockImplementation(async () => {
      healed = true;
      return { created: true, chargeId: "c1", level: "B1", amount: 400_000 };
    });

    const outcome = await runRepair({ studentId: "s1", repairId: "sync_tuition_charge" });
    expect(m.ensureCharge).toHaveBeenCalledTimes(1);
    expect(m.ensureCharge).toHaveBeenCalledWith({ studentId: "s1", level: "B1", origin: "admin" });
    expect(outcome).toMatchObject({ ok: true, verified: true });
    expect(outcome.message).toContain("Raised");
    expect(m.audit).toHaveBeenCalledTimes(1);
    expect(m.audit.mock.calls[0][1].summary).toContain("sync_tuition_charge");
  });

  it("does nothing when the ledger already credits this level (stale click, or someone else fixed it)", async () => {
    // Default beforeEach fixture is already healthy — nothing for this rule to find.
    const outcome = await runRepair({ studentId: "s1", repairId: "sync_tuition_charge" });
    expect(m.ensureCharge).not.toHaveBeenCalled();
    expect(outcome.message).toMatch(/nothing to do/i);
  });

  it("reports honestly when the charge could not be raised", async () => {
    m.accessFromStudent.mockImplementation(drifted);
    m.ensureCharge.mockResolvedValue(null);
    const outcome = await runRepair({ studentId: "s1", repairId: "sync_tuition_charge" });
    expect(outcome).toMatchObject({ ok: false, verified: false });
  });

  it("names the capability it needs", () => {
    expect(repairCapability("sync_tuition_charge")).toBe("payments");
  });
});

describe("runRepair — resolve_prior_level_arrears", () => {
  beforeEach(() => {
    // Exactly the returning-student shape: B1 (current level) is fully paid,
    // but an older A2 charge is still open and never flagged legacy — the
    // ledger's lock reads that, even though the admin file's per-level view
    // would say "nothing outstanding" on B1. A different drift from
    // sync_tuition_charge above: there the charge is MISSING; here it exists
    // and is simply stale.
    m.accessFromStudent.mockReturnValue({
      hasAccess: false, lockReason: "unsettled_balance", totalPaid: 180_000, currentLevelPaid: 180_000, tuitionFee: 180_000,
      requiredDeposit: 108_000, outstanding: 0, graceUntil: null, batchLabel: null,
    });
    m.studentFind.mockImplementation(async () => ({
      id: "s1", studentCode: world.code, tenantId: "t1", level: "B1", classType: "group",
      admission: { photoUrl: "x.jpg" }, branch: null,
      user: { id: "u1", email: "ada@example.com", name: "Ada", tenantId: "t1" },
      tuitionCharges: [
        { id: "c-a2", level: "A2", amount: 215_000, waivedAmount: 0, legacyArrears: false, createdAt: new Date("2026-06-01"), settledAt: null },
        { id: "c-b1", level: "B1", amount: 180_000, waivedAmount: 0, legacyArrears: false, createdAt: new Date("2026-09-01"), settledAt: null },
      ],
      payments: [{ amount: 180_000, level: null, description: "B1 tuition - September 2026", status: "completed", createdAt: new Date("2026-10-13") }],
    }));
  });

  const run = () => runRepair({ studentId: "s1", repairId: "resolve_prior_level_arrears" });

  it("marks only the stale earlier-level charge as legacy arrears, leaves the settled current level alone, and audits", async () => {
    m.chargeFind.mockResolvedValue({ note: null, legacyArrears: false });
    const outcome = await run();
    expect(m.chargeUpdate).toHaveBeenCalledTimes(1);
    expect(m.chargeUpdate.mock.calls[0][0]).toMatchObject({ where: { id: "c-a2" }, data: { legacyArrears: true } });
    expect(outcome.ok).toBe(true);
    expect(outcome.message).toMatch(/legacy arrears/i);
    expect(m.audit).toHaveBeenCalledTimes(1);
  });

  it("keeps any existing note instead of overwriting it", async () => {
    m.chargeFind.mockResolvedValue({ note: "Scholarship review pending", legacyArrears: false });
    await run();
    expect(m.chargeUpdate.mock.calls[0][0].data.note).toMatch(/^Scholarship review pending · Marked legacy arrears/);
  });

  it("does nothing once the drag is already cleared — stale click or a second admin", async () => {
    m.accessFromStudent.mockReturnValue({
      hasAccess: true, lockReason: null, totalPaid: 395_000, currentLevelPaid: 180_000, tuitionFee: 180_000,
      requiredDeposit: 108_000, outstanding: 0, graceUntil: null, batchLabel: null,
    });
    const outcome = await run();
    expect(m.chargeUpdate).not.toHaveBeenCalled();
    expect(outcome.message).toMatch(/nothing to do/i);
  });

  it("is idempotent: a charge already marked legacy by someone else is skipped, not double-noted", async () => {
    m.chargeFind.mockResolvedValue({ note: "already handled", legacyArrears: true });
    const outcome = await run();
    expect(m.chargeUpdate).not.toHaveBeenCalled();
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/already marked/i);
  });

  it("names the capability it needs", () => {
    expect(repairCapability("resolve_prior_level_arrears")).toBe("payments");
  });
});

describe("the whitelist", () => {
  it("refuses anything it does not know, touching nothing", async () => {
    const outcome = await runRepair({ studentId: "s1", repairId: "drop_all_tables" });
    expect(outcome.ok).toBe(false);
    expect(m.studentFind).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("names the capability each repair needs, and nothing for an unknown one", () => {
    expect(repairCapability("record_paystack_payment")).toBe("payments");
    expect(repairCapability("assign_student_code")).toBe("students");
    expect(repairCapability("drop_all_tables")).toBeNull();
    expect(repairCapability("toString")).toBeNull(); // prototype keys must not pass the `in` check
  });
});
