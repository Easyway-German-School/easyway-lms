import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  studentFind: vi.fn(),
  studentMany: vi.fn(),
  studentCount: vi.fn(),
  paymentFind: vi.fn(),
  snapshotFind: vi.fn(),
  privateClassFind: vi.fn(),
  liveSessionFind: vi.fn(),
  verify: vi.fn(),
  assignCode: vi.fn(),
  audit: vi.fn(),
  fetch: vi.fn(),
  accessFromStudent: vi.fn(),
  ensureCharge: vi.fn(),
  enrolmentUpdate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    student: {
      findUnique: (...a: unknown[]) => m.studentFind(...a),
      findMany: (...a: unknown[]) => m.studentMany(...a),
      count: (...a: unknown[]) => m.studentCount(...a),
    },
    payment: { findMany: (...a: unknown[]) => m.paymentFind(...a) },
    accessSnapshot: { findUnique: (...a: unknown[]) => m.snapshotFind(...a) },
    privateClass: { findMany: (...a: unknown[]) => m.privateClassFind(...a) },
    liveClassSession: { findMany: (...a: unknown[]) => m.liveSessionFind(...a) },
    tuitionCharge: {},
    studentEnrolment: { updateMany: (...a: unknown[]) => m.enrolmentUpdate(...a) },
  },
  unguardedPrisma: {},
}));
vi.mock("@/lib/live-presence", () => ({ LIVE_STALE_AFTER_MS: 180_000 }));
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

import { repairCapability, runDiagnosis, runRepair, scanDiagnoses } from "./diagnose-server";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const rawTx = (over: Record<string, unknown> = {}) => ({
  reference: "PSK-123456", status: "success", amount: 15_000_000, currency: "NGN", paid_at: "2026-09-18T10:00:00Z",
  customer: { email: "ada@example.com" }, metadata: { userId: "u1", studentId: "s1" }, ...over,
});

/** A little in-memory world the mocks read from, so "after the repair" really is different. */
let world: {
  code: string | null;
  chargePresent: boolean;
  enrolment: {
    id: string;
    level: string;
    tuitionChargeId: string | null;
    feeSnapshot: number | null;
    batchMonth: string | null;
    batchYear: number | null;
  };
  payments: Array<{ id: string; amount: number; status: string; method: string; stripeSessionId: string | null; paymentIntentId: string | null; createdAt: Date }>;
  paystack: unknown[];
  classType: string;
  deliveryMode: string;
  hybridOnlineSlot: string | null;
  tutor: { id: string; status: string } | null;
  coTutors: Array<{ lecturerId: string; role: string; lecturer: { status: string } }>;
  privateClasses: Array<{
    id: string;
    lecturerId: string | null;
    scheduledAt: Date;
    durationMinutes: number;
    deliveryMode: string | null;
  }>;
  liveSessions: Array<{
    id: string;
    kind: string;
    title: string;
    level: string | null;
    sessionSlot: string | null;
    batch: string | null;
    lecturerId: string | null;
    privateClassId: string | null;
  }>;
};

beforeEach(() => {
  // fetchPaystackTransactions refuses to run with no key (correctly), so the tests need a dummy one.
  process.env.PAYSTACK_SECRET_KEY = "sk_test_dummy";
  Object.values(m).forEach((fn) => fn.mockReset());
  m.studentMany.mockResolvedValue([{ id: "s1" }]);
  m.studentCount.mockResolvedValue(1);
  world = {
    code: "EW/2026/B1/SEP/A001",
    chargePresent: true,
    enrolment: {
      id: "e1",
      level: "B1",
      tuitionChargeId: "c1",
      feeSnapshot: 400_000,
      batchMonth: null,
      batchYear: null,
    },
    payments: [],
    paystack: [rawTx()],
    classType: "group",
    deliveryMode: "physical",
    hybridOnlineSlot: null,
    tutor: null,
    coTutors: [],
    privateClasses: [],
    liveSessions: [],
  };

  m.studentFind.mockImplementation(async (args?: { where?: { id?: string } }) => {
    const id = args?.where?.id ?? "s1";
    return {
    id, studentCode: world.code, tenantId: "t1", level: "B1", classType: world.classType, admission: { photoUrl: "x.jpg" }, branch: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    tuitionCharges: world.chargePresent
      ? [{ id: "c1", level: "B1", amount: 400_000, waivedAmount: 0, legacyArrears: false, createdAt: new Date("2026-09-01T00:00:00.000Z") }]
      : [],
    status: "active",
    branchId: null,
    tutorId: world.tutor?.id ?? null,
    tutor: world.tutor,
    coTutors: world.coTutors,
    sessionSlot: "morning",
    deliveryMode: world.deliveryMode,
    hybridOnlineSlot: world.hybridOnlineSlot,
    classesStartedAt: null,
    enrolments: [world.enrolment],
    user: { id: `u-${id}`, email: "ada@example.com", name: "Ada", tenantId: "t1" },
  };
  });
  m.paymentFind.mockImplementation(async () => world.payments);
  m.snapshotFind.mockResolvedValue(null);
  m.privateClassFind.mockImplementation(async () => world.privateClasses);
  m.liveSessionFind.mockImplementation(async () => world.liveSessions);
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
  m.ensureCharge.mockImplementation(async () => {
    world.chargePresent = true;
    return { created: true, chargeId: "c1", level: "B1", amount: 400_000 };
  });
  m.enrolmentUpdate.mockImplementation(async ({ data }: { data: typeof world.enrolment }) => {
    world.enrolment = { ...world.enrolment, ...data };
    return { count: 1 };
  });
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

  it("diagnoses missing hybrid sitting and unassigned tutor setup from persisted student records", async () => {
    world.deliveryMode = "hybrid";
    world.hybridOnlineSlot = null;
    const result = await runDiagnosis("s1");
    expect(result!.diagnosis.findings.map((finding) => finding.rule)).toContain("class-schedule-setup");
    expect(result!.diagnosis.findings.map((finding) => finding.rule)).toContain("class-tutor-assignment");
  });

  it("checks live room sitting and intake only during an individual live diagnosis", async () => {
    world.deliveryMode = "hybrid";
    world.hybridOnlineSlot = "evening";
    world.coTutors = [{ lecturerId: "t1", role: "online", lecturer: { status: "active" } }];
    world.liveSessions = [{
      id: "room-1", kind: "cohort", title: "Lagos · B1 · October Morning", level: "B1",
      sessionSlot: "morning", batch: "October", lecturerId: "t1", privateClassId: null,
    }];

    const result = await runDiagnosis("s1", { includeLive: true });
    expect(result!.diagnosis.findings.map((finding) => finding.rule)).toContain("live-tutor-room-mismatch");
    expect(m.liveSessionFind).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([expect.objectContaining({ kind: "cohort", lecturerId: { in: ["t1"] } })]),
        endedAt: null,
      }),
    }));

    m.liveSessionFind.mockClear();
    await scanDiagnoses();
    expect(m.liveSessionFind).not.toHaveBeenCalled();
  });

  it("checks an online private booking against its exact active private live room", async () => {
    world.classType = "private";
    world.deliveryMode = "online";
    world.privateClasses = [{
      id: "booking-1",
      lecturerId: "t1",
      scheduledAt: new Date(Date.now() - 30 * 60_000),
      durationMinutes: 60,
      deliveryMode: "online",
    }];

    const result = await runDiagnosis("s1", { includeLive: true });
    expect(result!.diagnosis.findings.map((finding) => finding.rule)).toContain("private-live-session-missing");
    expect(m.liveSessionFind).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([expect.objectContaining({ kind: "private", privateClassId: { in: ["booking-1"] } })]),
      }),
    }));
  });
});

describe("scanDiagnoses", () => {
  it("paginates all students, reports problem findings, and never calls Paystack", async () => {
    const ids = Array.from({ length: 21 }, (_, index) => `s${index + 1}`);
    m.studentMany.mockImplementation(async (args: { cursor?: { id: string }; take: number }) => {
      const start = args.cursor ? ids.indexOf(args.cursor.id) + 1 : 0;
      return ids.slice(start, start + args.take).map((id) => ({ id }));
    });
    m.studentCount.mockResolvedValue(ids.length);
    world.chargePresent = false;

    const first = await scanDiagnoses();
    expect(first.scanned).toBe(20);
    expect(first.total).toBe(21);
    expect(first.nextCursor).toBe("s20");
    expect(first.students).toHaveLength(20);
    expect(first.students[0].diagnosis.findings.map((finding) => finding.rule)).toContain("missing-level-charge");
    expect(first.errors).toEqual([]);
    expect(m.fetch).not.toHaveBeenCalled();

    const second = await scanDiagnoses(first.nextCursor);
    expect(second.scanned).toBe(1);
    expect(second.nextCursor).toBeNull();
  });

  it("reports per-student load failures without hiding findings from other students", async () => {
    m.studentMany.mockResolvedValue([{ id: "s1" }, { id: "s2" }]);
    m.studentCount.mockResolvedValue(2);
    m.studentFind.mockImplementation(async (args?: { where?: { id?: string } }) => {
      if (args?.where?.id === "s1") throw new Error("database timeout");
      return {
        id: "s2", studentCode: "EW/2026/B1/SEP/A001", tenantId: "t1", level: "B1", classType: "group",
        admission: { photoUrl: "x.jpg" }, branch: null, createdAt: new Date("2026-09-01T00:00:00.000Z"),
        tuitionCharges: [{ id: "c1", level: "B1", amount: 400_000, waivedAmount: 0, legacyArrears: false, createdAt: new Date("2026-09-01T00:00:00.000Z") }],
        status: "active", branchId: null, tutorId: null, sessionSlot: "morning", deliveryMode: "physical",
        classesStartedAt: null, enrolments: [world.enrolment],
        user: { id: "u-s2", email: "ada@example.com", name: "Ada", tenantId: "t1" },
      };
    });

    const page = await scanDiagnoses();
    expect(page.scanned).toBe(2);
    expect(page.errors).toEqual([{ studentId: "s1", error: "database timeout" }]);
    expect(page.students).toEqual([]);
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
    world.chargePresent = false;
    let healed = false;
    m.accessFromStudent.mockImplementation(() => (healed ? settled() : drifted()));
    m.ensureCharge.mockImplementation(async () => {
      healed = true;
      world.chargePresent = true;
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
    world.chargePresent = false;
    m.accessFromStudent.mockImplementation(drifted);
    m.ensureCharge.mockResolvedValue(null);
    const outcome = await runRepair({ studentId: "s1", repairId: "sync_tuition_charge" });
    expect(outcome).toMatchObject({ ok: false, verified: false });
  });

  it("repairs an outdated current-level enrolment and verifies the alignment", async () => {
    world.enrolment = {
      ...world.enrolment,
      level: "A2",
      tuitionChargeId: "old-charge",
      feeSnapshot: 180_000,
    };
    const outcome = await runRepair({ studentId: "s1", repairId: "sync_tuition_charge" });
    expect(outcome).toMatchObject({ ok: true, verified: true });
    expect(m.enrolmentUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "e1", studentId: "s1", outcome: "ongoing", deletedAt: null },
      data: expect.objectContaining({ level: "B1", tuitionChargeId: "c1", feeSnapshot: 400_000 }),
    }));
    expect(world.enrolment).toMatchObject({ level: "B1", tuitionChargeId: "c1", feeSnapshot: 400_000 });
  });

  it("names the capability it needs", () => {
    expect(repairCapability("sync_tuition_charge")).toBe("payments");
  });
});

describe("the whitelist", () => {
  it("refuses anything it does not know, touching nothing", async () => {
    const outcome = await runRepair({ studentId: "s1", repairId: "drop_all_tables" });
    expect(outcome.ok).toBe(false);
    expect(m.studentFind).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("no longer supports the old automatic legacy-arrears unlock", async () => {
    const outcome = await runRepair({ studentId: "s1", repairId: "resolve_prior_level_arrears" });
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
