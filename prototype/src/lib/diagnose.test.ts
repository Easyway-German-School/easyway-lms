import { describe, expect, it } from "vitest";
import { portalVerdict } from "./portal-verdict";
import { RULES, belongsToStudent, diagnose, unrecordedTransactions, type Facts, type PaystackTx } from "./diagnose";

const who = { userId: "u1", studentId: "s1", email: "Ada@Example.com" };
const isReceived = (s: string) => s === "completed" || s === "partial";

const tx = (over: Partial<PaystackTx> = {}): PaystackTx => ({
  reference: "ref-1",
  status: "success",
  amountKobo: 15_000_000,
  currency: "NGN",
  paidAt: "2026-09-18T10:00:00Z",
  email: "ada@example.com",
  metaUserId: null,
  metaStudentId: null,
  ...over,
});

const base = (over: Partial<Facts> = {}): Facts => ({
  student: { id: "s1", studentCode: "EW/2026/B1/SEP/A001", tenantId: "t1", level: "B1", status: "active" },
  user: { id: "u1", email: "ada@example.com", name: "Ada", tenantId: "t1" },
  access: { hasAccess: true, lockReason: null, totalPaid: 300_000, tuitionFee: 400_000, requiredDeposit: 240_000, outstanding: 0, graceUntil: null, batchLabel: null },
  hasPhoto: true,
  verdict: portalVerdict({ hasAccess: true, lockReason: null }, true),
  payments: [],
  priorLevelArrears: [],
  snapshot: null,
  paystack: null,
  ...over,
});

describe("belongsToStudent", () => {
  it("trusts OUR metadata over the email — a parent paying for two children from one address", () => {
    const other = tx({ metaStudentId: "s2", metaUserId: "u2" }); // same email, different child
    expect(belongsToStudent(other, who)).toBe(false);
  });

  it("matches on our metadata even when the email differs", () => {
    expect(belongsToStudent(tx({ email: "someone-else@x.com", metaUserId: "u1" }), who)).toBe(true);
    expect(belongsToStudent(tx({ email: null, metaStudentId: "s1" }), who)).toBe(true);
  });

  it("falls back to email (case-insensitive) only when the transaction carries no identity of ours", () => {
    expect(belongsToStudent(tx(), who)).toBe(true);
    expect(belongsToStudent(tx({ email: "nobody@x.com" }), who)).toBe(false);
    expect(belongsToStudent(tx({ email: null }), who)).toBe(false);
  });
});

describe("unrecordedTransactions", () => {
  const row = (over: object = {}) => ({ id: "p1", amount: 150_000, status: "completed", method: "paystack", references: ["ref-1"], createdAt: "2026-09-18T10:00:00Z", ...over });

  it("finds a paid transaction with no payment row at all (the missed webhook)", () => {
    const found = unrecordedTransactions([tx()], [], who, isReceived);
    expect(found).toEqual([{ tx: expect.objectContaining({ reference: "ref-1" }), reason: "no-row" }]);
  });

  it("finds a row that exists but was never settled", () => {
    const found = unrecordedTransactions([tx()], [row({ status: "pending" })], who, isReceived);
    expect(found[0].reason).toBe("not-settled");
  });

  it("treats an already-recorded payment — completed OR a partial deposit — as fine", () => {
    expect(unrecordedTransactions([tx()], [row({ status: "completed" })], who, isReceived)).toEqual([]);
    expect(unrecordedTransactions([tx()], [row({ status: "partial" })], who, isReceived)).toEqual([]);
  });

  it("matches a row by ANY reference it carries (stripeSessionId or paymentIntentId)", () => {
    expect(unrecordedTransactions([tx()], [row({ references: ["ref-1", "ref-1"] })], who, isReceived)).toEqual([]);
  });

  it("ignores failed/abandoned transactions and other students' transactions", () => {
    const txs = [tx({ status: "failed" }), tx({ reference: "ref-2", status: "abandoned" }), tx({ reference: "ref-3", metaStudentId: "s9" })];
    expect(unrecordedTransactions(txs, [], who, isReceived)).toEqual([]);
  });

  it("reports a duplicated reference once", () => {
    expect(unrecordedTransactions([tx(), tx()], [], who, isReceived)).toHaveLength(1);
  });
});

describe("the rules", () => {
  it("says nothing about a healthy student", () => {
    const d = diagnose(base());
    expect(d.findings).toEqual([]);
    expect(d.rulesRun).toBe(RULES.length);
  });

  it("detects an unpaid current charge short by exactly the registration fee", () => {
    const findings = diagnose(base({
      levelAlignment: {
        currentLevelChargeExists: true,
        currentChargeId: "charge-a2",
        currentChargeAmount: 145_000,
        currentChargeWaivedAmount: 0,
        currentChargeAllocated: 0,
        expectedCurrentChargeAmount: 150_000,
        ongoingEnrolment: null,
        expectedBatchMonth: null,
        expectedBatchYear: null,
      },
      access: { ...base().access, tuitionFee: 145_000, currentLevelOutstanding: 145_000 },
    })).findings;

    expect(findings.find((finding) => finding.rule === "current-tuition-underpriced-by-registration-fee")?.offers[0])
      .toMatchObject({ id: "reprice_current_tuition", needs: "payments" });
  });

  it("detects when a registration payment matches the amount missing from current tuition", () => {
    const findings = diagnose(base({
      access: { ...base().access, tuitionFee: 150_000, currentLevelOutstanding: 145_000 },
      registrationFeePayments: [{ amount: 5_000, description: "registration fee for language training" }],
    })).findings;

    expect(findings.find((finding) => finding.rule === "registration-fee-counted-toward-tuition")?.severity).toBe("problem");
  });

  it("flags a hybrid student without a usable online sitting", () => {
    const d = diagnose(base({
      student: { ...base().student, classType: "group", deliveryMode: "hybrid", sessionSlot: "morning" },
      classSetup: { hybridOnlineSlot: null, tutors: [], upcomingPrivateClasses: [], liveSessions: [] },
    }));
    expect(d.findings.find((finding) => finding.rule === "class-schedule-setup")).toMatchObject({
      severity: "problem",
      title: "The student's class sitting is missing or invalid",
    });
  });

  it("flags an online class with no active tutor", () => {
    const d = diagnose(base({
      student: { ...base().student, classType: "group", deliveryMode: "online" },
      classSetup: { hybridOnlineSlot: null, tutors: [], upcomingPrivateClasses: [], liveSessions: [] },
    }));
    expect(d.findings.find((finding) => finding.rule === "class-tutor-assignment")?.severity).toBe("problem");
  });

  it("reports a private student with no upcoming booked session", () => {
    const d = diagnose(base({
      student: { ...base().student, classType: "private", deliveryMode: "online" },
      classSetup: { hybridOnlineSlot: null, tutors: [], upcomingPrivateClasses: [], liveSessions: [] },
    }));
    expect(d.findings.find((finding) => finding.rule === "private-class-coverage")?.title).toBe(
      "No upcoming private session is booked",
    );
  });

  it("identifies a live same-level tutor room in the wrong slot or intake", () => {
    const d = diagnose(base({
      student: {
        ...base().student,
        classType: "group",
        deliveryMode: "hybrid",
        sessionSlot: "morning",
        admission: { batch: "September" },
      },
      classSetup: {
        hybridOnlineSlot: "evening",
        tutors: [{ id: "t1", status: "active", role: "online" }],
        upcomingPrivateClasses: [],
        liveSessions: [{
          id: "room-1",
          kind: "cohort",
          title: "Lagos · B1 · October Morning",
          level: "B1",
          sessionSlot: "morning",
          batch: "October",
          lecturerId: "t1",
          privateClassId: null,
        }],
      },
    }));
    expect(d.findings.find((finding) => finding.rule === "live-tutor-room-mismatch")?.severity).toBe("warning");
  });

  it("paid-not-recorded: a problem with one repair offer per transaction, with a plain preview", () => {
    const d = diagnose(base({ paystack: { checked: true, emailChecked: "ada@example.com", transactions: [tx(), tx({ reference: "ref-9", amountKobo: 5_000_000 })] } }));
    const f = d.findings.find((x) => x.rule === "paid-not-recorded")!;
    expect(f.severity).toBe("problem");
    expect(f.offers.map((o) => o.params.reference)).toEqual(["ref-1", "ref-9"]);
    expect(f.offers[0]).toMatchObject({ id: "record_paystack_payment", needs: "payments" });
    expect(f.offers[0].preview).toMatch(/only — if it confirms|only if it confirms/i);
    expect(f.offers[0].label).toContain("₦150,000");
  });

  it("paid-not-recorded stays silent when the Paystack check was not run or failed", () => {
    expect(diagnose(base({ paystack: null })).findings).toEqual([]);
    expect(diagnose(base({ paystack: { checked: false, error: "timeout" } })).findings).toEqual([]);
  });

  it("portal-locked: explains a payment lock with the numbers, and offers no repair (it is working as designed)", () => {
    const verdict = portalVerdict({ hasAccess: false, lockReason: "unpaid_deposit" }, true);
    const f = diagnose(base({ verdict, access: { ...base().access, hasAccess: false, lockReason: "unpaid_deposit", totalPaid: 0, outstanding: 240_000 } })).findings[0];
    expect(f.rule).toBe("portal-locked");
    expect(f.severity).toBe("info");
    expect(f.offers).toEqual([]);
    expect(f.evidence.find((e) => e.label === "Still to unlock")?.value).toBe("₦240,000");
  });

  it("portal-locked: a paid student held ONLY by the photo is called out as a warning with reassurance", () => {
    const verdict = portalVerdict({ hasAccess: true, lockReason: null }, false);
    const f = diagnose(base({ verdict, hasPhoto: false })).findings[0];
    expect(f.severity).toBe("warning");
    expect(f.title).toMatch(/payment is fine/i);
    expect(f.detail).toMatch(/nothing is wrong with their payment/i);
  });

  it("missing-level-charge: fires when lifetime money covers the fee but the ledger credits none of it to this level", () => {
    const f = diagnose(base({ access: { ...base().access, totalPaid: 400_000, currentLevelPaid: 0, tuitionFee: 400_000 } })).findings.find((x) => x.rule === "missing-level-charge")!;
    expect(f.severity).toBe("problem");
    expect(f.offers[0]).toMatchObject({ id: "sync_tuition_charge", needs: "payments" });
    expect(f.evidence.find((e) => e.label === "Paid in total")?.value).toBe("₦400,000");
  });

  it("missing-level-charge: says nothing once the level is actually credited", () => {
    const d = diagnose(base({ access: { ...base().access, totalPaid: 400_000, currentLevelPaid: 400_000, tuitionFee: 400_000 } }));
    expect(d.findings.some((f) => f.rule === "missing-level-charge")).toBe(false);
  });

  it("missing-level-charge: says nothing when currentLevelPaid was never supplied (older/fixture callers)", () => {
    const { currentLevelPaid, ...accessWithoutField } = base().access;
    const d = diagnose(base({ access: accessWithoutField }));
    expect(d.findings.some((f) => f.rule === "missing-level-charge")).toBe(false);
  });

  it("missing-level-charge: says nothing when they simply have not paid enough yet (no drift, just unpaid)", () => {
    const d = diagnose(base({ access: { ...base().access, totalPaid: 50_000, currentLevelPaid: 50_000, tuitionFee: 400_000 } }));
    expect(d.findings.some((f) => f.rule === "missing-level-charge")).toBe(false);
  });

  it("missing-level-charge: detects an absent current charge even before payments reach the new level fee", () => {
    const d = diagnose(base({
      access: { ...base().access, totalPaid: 180_000, currentLevelPaid: 0, tuitionFee: 400_000 },
      levelAlignment: {
        currentLevelChargeExists: false,
        currentChargeId: null,
        currentChargeAmount: null,
        ongoingEnrolment: null,
        expectedBatchMonth: "September",
        expectedBatchYear: 2026,
      },
    }));
    expect(d.findings.some((f) => f.rule === "missing-level-charge")).toBe(true);
  });

  it("current-enrolment-mismatch: catches a changed level with a stale ongoing fee snapshot", () => {
    const d = diagnose(base({
      levelAlignment: {
        currentLevelChargeExists: true,
        currentChargeId: "charge-b1",
        currentChargeAmount: 400_000,
        ongoingEnrolment: {
          id: "enrolment-a2",
          level: "A2",
          tuitionChargeId: "charge-a2",
          feeSnapshot: 180_000,
          batchMonth: "September",
          batchYear: 2026,
        },
        expectedBatchMonth: "September",
        expectedBatchYear: 2026,
      },
    }));
    expect(d.findings.some((f) => f.rule === "current-enrolment-mismatch")).toBe(true);
  });

  it("current-enrolment-mismatch: stays quiet when the active level, fee and batch are aligned", () => {
    const d = diagnose(base({
      levelAlignment: {
        currentLevelChargeExists: true,
        currentChargeId: "charge-b1",
        currentChargeAmount: 400_000,
        ongoingEnrolment: {
          id: "enrolment-b1",
          level: "B1",
          tuitionChargeId: "charge-b1",
          feeSnapshot: 400_000,
          batchMonth: "September",
          batchYear: 2026,
        },
        expectedBatchMonth: "September",
        expectedBatchYear: 2026,
      },
    }));
    expect(d.findings.some((f) => f.rule === "current-enrolment-mismatch")).toBe(false);
  });

  it("reports a confirmed prior-level balance without proposing to waive it", () => {
    const verdict = portalVerdict({ hasAccess: false, lockReason: "previous_level_balance" }, true);
    const f = diagnose(
      base({
        verdict,
        access: { ...base().access, hasAccess: false, lockReason: "previous_level_balance" },
        priorLevelArrears: [{ chargeId: "c-a2", level: "A2", outstanding: 35_000 }],
      }),
    ).findings.find((x) => x.rule === "prior-level-balance")!;
    expect(f.severity).toBe("problem");
    expect(f.title).toContain("A2");
    expect(f.title).toContain("₦35,000");
    expect(f.offers).toEqual([]);
  });

  it("reports unreviewed inferred history as non-collectible and does not call it confirmed debt", () => {
    const unreviewed = diagnose(base({
      unreviewedPriorLevels: [{ level: "A2", potentialOutstanding: 35_000 }],
    })).findings.find((finding) => finding.rule === "unreviewed-prior-level-history");
    expect(unreviewed?.severity).toBe("warning");
    expect(unreviewed?.offers).toEqual([]);

    expect(diagnose(base({ priorLevelArrears: [] })).findings.some((f) => f.rule === "prior-level-balance")).toBe(false);
    const depositLock = portalVerdict({ hasAccess: false, lockReason: "unpaid_deposit" }, true);
    expect(
      diagnose(
        base({
          verdict: depositLock,
          access: { ...base().access, hasAccess: false, lockReason: "unpaid_deposit" },
          priorLevelArrears: [{ chargeId: "c-a2", level: "A2", outstanding: 35_000 }],
        }),
      ).findings.some((f) => f.rule === "prior-level-balance"),
    ).toBe(false);
  });

  it("missing-student-code: warns and offers the repair, needing the students capability", () => {
    const f = diagnose(base({ student: { ...base().student, studentCode: null } })).findings[0];
    expect(f.rule).toBe("missing-student-code");
    expect(f.offers[0]).toMatchObject({ id: "assign_student_code", needs: "students" });
    expect(diagnose(base({ student: { ...base().student, studentCode: "   " } })).findings[0].rule).toBe("missing-student-code");
  });

  it("tenant-mismatch: a PROBLEM with deliberately NO repair — guessing the owner is how data leaks", () => {
    for (const facts of [
      base({ student: { ...base().student, tenantId: null } }),
      base({ user: { ...base().user, tenantId: null } }),
      base({ user: { ...base().user, tenantId: "t2" } }),
    ]) {
      const f = diagnose(facts).findings.find((x) => x.rule === "tenant-mismatch")!;
      expect(f.severity).toBe("problem");
      expect(f.offers).toEqual([]);
    }
  });

  it("screen-out-of-sync: fires only when their screen showed a lock the database says is open", () => {
    const snap = { verdictKey: "open", changedAt: "2026-09-19T00:00:00Z", lastWitnessAt: "2026-09-20T09:00:00Z", lastWitnessRendered: "photo" };
    expect(diagnose(base({ snapshot: snap })).findings[0].rule).toBe("screen-out-of-sync");
    expect(diagnose(base({ snapshot: { ...snap, lastWitnessRendered: "none" } })).findings).toEqual([]);
    // a locked portal whose screen shows a lock is CONSISTENT, not out of sync
    const locked = portalVerdict({ hasAccess: false, lockReason: "unpaid_deposit" }, true);
    expect(diagnose(base({ verdict: locked, snapshot: snap })).findings.some((f) => f.rule === "screen-out-of-sync")).toBe(false);
  });
});

describe("the engine", () => {
  it("orders findings problem, then warning, then info", () => {
    const facts = base({
      student: { ...base().student, studentCode: null, tenantId: null },
      verdict: portalVerdict({ hasAccess: false, lockReason: "unpaid_deposit" }, true),
    });
    expect(diagnose(facts).findings.map((f) => f.severity)).toEqual(["problem", "warning", "info"]);
  });

  it("one rule that throws is reported and never hides the others' findings", () => {
    const boom = { id: "boom", run: () => { throw new Error("kaput"); } };
    const d = diagnose(base({ student: { ...base().student, studentCode: null } }), [boom, ...RULES]);
    expect(d.ruleErrors).toEqual([{ rule: "boom", error: "kaput" }]);
    expect(d.findings.some((f) => f.rule === "missing-student-code")).toBe(true);
  });

  it("every rule has a unique id, and every repair offer names a capability", () => {
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
  });
});

describe("toPaystackTx", () => {
  it("reads a normal transaction, converting nothing (amounts stay in kobo)", async () => {
    const { toPaystackTx } = await import("./diagnose");
    expect(
      toPaystackTx({ reference: "r1", status: "success", amount: 5000000, currency: "NGN", paid_at: "2026-09-18T10:00:00Z", customer: { email: "a@b.c" }, metadata: { userId: "u1", studentId: "s1" } }),
    ).toEqual({ reference: "r1", status: "success", amountKobo: 5000000, currency: "NGN", paidAt: "2026-09-18T10:00:00Z", email: "a@b.c", metaUserId: "u1", metaStudentId: "s1" });
  });

  it("survives Paystack's awkward metadata: an empty string, a JSON string, null, garbage", async () => {
    const { toPaystackTx } = await import("./diagnose");
    expect(toPaystackTx({ reference: "r", metadata: "" })).toMatchObject({ metaUserId: null, metaStudentId: null });
    expect(toPaystackTx({ reference: "r", metadata: '{"userId":"u9"}' })).toMatchObject({ metaUserId: "u9" });
    expect(toPaystackTx({ reference: "r", metadata: null })).toMatchObject({ metaUserId: null });
    expect(toPaystackTx({ reference: "r", metadata: "{not json" })).toMatchObject({ metaUserId: null });
  });

  it("rejects anything without a reference", async () => {
    const { toPaystackTx } = await import("./diagnose");
    expect(toPaystackTx(null)).toBeNull();
    expect(toPaystackTx({ status: "success" })).toBeNull();
    expect(toPaystackTx("nope")).toBeNull();
  });
});
