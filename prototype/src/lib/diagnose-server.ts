/**
 * The I/O half of the diagnosis tool: gather the facts, ask Paystack, and run the
 * (short) whitelist of repairs safely. The judgement lives in lib/diagnose.ts;
 * this file only fetches, acts, verifies and records.
 *
 * THE FIVE RULES OF A REPAIR — every one of them is enforced in `runRepair`:
 *
 *   1. RE-DERIVE BEFORE ACTING. The browser asks to "record reference X". We do not
 *      trust that: we rebuild the facts from scratch and only proceed if the
 *      diagnosis STILL produces an offer for exactly that. A stale click, a second
 *      admin who got there first, or a hand-crafted request all end at "nothing to do".
 *   2. IDEMPOTENT. Recording a payment is keyed on the Paystack reference; issuing a
 *      code never overwrites one. Running a repair twice is the same as once.
 *   3. VERIFY AFTER. Once it has acted it re-runs the same rules and reports whether
 *      the problem is actually gone — an honest "I did it but it is still there" beats
 *      a green tick.
 *   4. AUDITED. Who, what, before and after, in the immutable trail.
 *   5. NEVER RETRIED. If a step fails it stops and says so. A tool that quietly tries
 *      again is how one payment gets recorded twice.
 */

import type { Capability } from "@/lib/admin-roles";
import { hasProfilePhoto } from "@/lib/access";
import {
  diagnose,
  toPaystackTx,
  type Diagnosis,
  type Facts,
  type Finding,
  type PaystackTx,
  type RepairId,
} from "@/lib/diagnose";
import { guardedFetch, isCircuitOpen } from "@/lib/guarded-fetch";
import { verifyPaystackTransaction } from "@/lib/paystack-verify";
import { planStatusForStudent, planSuppressesLock } from "@/lib/payment-plans";
import { portalVerdict } from "@/lib/portal-verdict";
import { prisma, unguardedPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/prisma-guard";
import { accessFromStudent, STUDENT_ACCESS_SELECT } from "@/lib/student-access";
import { assignStudentCode } from "@/lib/student-code";

// ---------------------------------------------------------------------------
// Finding the student
// ---------------------------------------------------------------------------

export type StudentHit = { id: string; studentCode: string | null; level: string; name: string | null; email: string };

export async function searchStudents(query: string, take = 8): Promise<StudentHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const rows = await prisma.student.findMany({
    where: {
      OR: [
        { studentCode: { contains: q, mode: "insensitive" } },
        { user: { name: { contains: q, mode: "insensitive" } } },
        { user: { email: { contains: q, mode: "insensitive" } } },
      ],
    },
    take,
    orderBy: { createdAt: "desc" },
    select: { id: true, studentCode: true, level: true, user: { select: { name: true, email: true } } },
  });
  return rows.map((r) => ({ id: r.id, studentCode: r.studentCode, level: r.level, name: r.user?.name ?? null, email: r.user?.email ?? "" }));
}

/** A complaint incident carries the reporter's user id; the diagnosis wants the student. */
export async function studentIdForUser(userId: string): Promise<string | null> {
  const row = await prisma.student.findUnique({ where: { userId }, select: { id: true } });
  return row?.id ?? null;
}

// ---------------------------------------------------------------------------
// Asking Paystack
// ---------------------------------------------------------------------------

type PaystackResult<T> = { ok: true; value: T } | { ok: false; error: string };

const paystackHeaders = (secret: string) => ({ Authorization: `Bearer ${secret}`, "Content-Type": "application/json" });

function explain(error: unknown): string {
  if (isCircuitOpen(error)) return "Paystack has been failing and calls are paused for a moment — try again in a minute.";
  return error instanceof Error ? error.message : String(error);
}

/**
 * Every successful transaction Paystack holds for this email.
 *
 * Two calls: the customer (by email → id), then their successful transactions. A
 * 404 on the customer is an ANSWER — "this email has never paid" — not a failure.
 * Goes through guardedFetch like every other Paystack call, so it has a deadline
 * and shares the breaker: a diagnosis tool must not be able to hang on, or add load
 * to, a struggling payment provider.
 */
export async function fetchPaystackTransactions(email: string): Promise<PaystackResult<PaystackTx[]>> {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return { ok: false, error: "Paystack is not configured on this deployment." };
  try {
    const customer = await guardedFetch("paystack", `https://api.paystack.co/customer/${encodeURIComponent(email)}`, {
      headers: paystackHeaders(secret),
      cache: "no-store",
    });
    if (customer.status === 404) return { ok: true, value: [] };
    if (!customer.ok) return { ok: false, error: `Paystack answered ${customer.status} when looking up the customer.` };
    const customerId = ((await customer.json()) as { data?: { id?: number } })?.data?.id;
    if (!customerId) return { ok: true, value: [] };

    const list = await guardedFetch("paystack", `https://api.paystack.co/transaction?customer=${customerId}&status=success&perPage=50`, {
      headers: paystackHeaders(secret),
      cache: "no-store",
    });
    if (!list.ok) return { ok: false, error: `Paystack answered ${list.status} when listing transactions.` };
    const rows = ((await list.json()) as { data?: unknown[] })?.data ?? [];
    return { ok: true, value: rows.map(toPaystackTx).filter((t): t is PaystackTx => t !== null) };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

/** One transaction by reference — for a receipt the student sends that the email lookup did not find. */
export async function fetchPaystackReference(reference: string): Promise<PaystackResult<PaystackTx | null>> {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return { ok: false, error: "Paystack is not configured on this deployment." };
  try {
    const response = await guardedFetch("paystack", `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: paystackHeaders(secret),
      cache: "no-store",
    });
    if (response.status === 404) return { ok: true, value: null };
    if (!response.ok) return { ok: false, error: `Paystack answered ${response.status}.` };
    return { ok: true, value: toPaystackTx(((await response.json()) as { data?: unknown })?.data) };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

// ---------------------------------------------------------------------------
// Gathering the facts
// ---------------------------------------------------------------------------

export type LoadOptions = {
  /** Ask Paystack (the "deep check"). */
  paystack?: boolean;
  /** Extra references to look up individually and fold in (a receipt the student sent). */
  extraReferences?: string[];
  /** Reuse an earlier Paystack answer instead of asking again (used when verifying a repair). */
  reusePaystack?: Facts["paystack"];
};

export async function loadFacts(studentId: string, options: LoadOptions = {}): Promise<Facts | null> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      studentCode: true,
      // tenantId comes off STUDENT_ACCESS_SELECT now (it needs it too, for
      // the intake-start-day override) — declaring it again here duplicates
      // the key.
      user: { select: { id: true, email: true, name: true, tenantId: true } },
      ...STUDENT_ACCESS_SELECT,
    },
  });
  if (!student || !student.user) return null;

  const [plan, payments, snapshot] = await Promise.all([
    planStatusForStudent(studentId),
    prisma.payment.findMany({
      where: { studentId },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, amount: true, status: true, method: true, stripeSessionId: true, paymentIntentId: true, createdAt: true },
    }),
    prisma.accessSnapshot.findUnique({
      where: { studentId },
      select: { verdictKey: true, changedAt: true, lastWitnessAt: true, lastWitnessRendered: true },
    }),
  ]);

  const access = accessFromStudent(student, planSuppressesLock(plan?.adherence ?? null));
  const hasPhoto = hasProfilePhoto(student.admission);

  let paystack: Facts["paystack"] = options.reusePaystack ?? null;
  if (!paystack && options.paystack) {
    const listed = await fetchPaystackTransactions(student.user.email);
    if (listed.ok) {
      const transactions = [...listed.value];
      for (const reference of options.extraReferences ?? []) {
        if (transactions.some((t) => t.reference === reference)) continue;
        const one = await fetchPaystackReference(reference);
        if (one.ok && one.value) transactions.push(one.value);
      }
      paystack = { checked: true, emailChecked: student.user.email, transactions };
    } else {
      paystack = { checked: false, error: listed.error };
    }
  }

  return {
    student: { id: student.id, studentCode: student.studentCode, tenantId: student.tenantId ?? null, level: student.level },
    user: { id: student.user.id, email: student.user.email, name: student.user.name, tenantId: student.user.tenantId ?? null },
    access: {
      hasAccess: access.hasAccess,
      lockReason: access.lockReason,
      totalPaid: access.totalPaid,
      tuitionFee: access.tuitionFee,
      requiredDeposit: access.requiredDeposit,
      outstanding: access.outstanding,
      graceUntil: access.graceUntil,
      batchLabel: access.batchLabel,
    },
    hasPhoto,
    verdict: portalVerdict(access, hasPhoto),
    payments: payments.map((p) => ({
      id: p.id,
      amount: p.amount,
      status: p.status,
      method: p.method,
      references: [p.stripeSessionId, p.paymentIntentId].filter((r): r is string => Boolean(r)),
      createdAt: p.createdAt.toISOString(),
    })),
    snapshot: snapshot
      ? {
          verdictKey: snapshot.verdictKey,
          changedAt: snapshot.changedAt.toISOString(),
          lastWitnessAt: snapshot.lastWitnessAt ? snapshot.lastWitnessAt.toISOString() : null,
          lastWitnessRendered: snapshot.lastWitnessRendered,
        }
      : null,
    paystack,
  };
}

export type DiagnosisResult = {
  student: { id: string; name: string | null; email: string; studentCode: string | null; level: string };
  diagnosis: Diagnosis;
  paystack: { checked: boolean; emailChecked?: string; error?: string; transactionsSeen?: number };
  verdictKey: string;
};

const summarise = (facts: Facts, diagnosis: Diagnosis): DiagnosisResult => ({
  student: { id: facts.student.id, name: facts.user.name, email: facts.user.email, studentCode: facts.student.studentCode, level: facts.student.level },
  diagnosis,
  paystack: !facts.paystack
    ? { checked: false }
    : facts.paystack.checked
      ? { checked: true, emailChecked: facts.paystack.emailChecked, transactionsSeen: facts.paystack.transactions.length }
      : { checked: false, error: facts.paystack.error },
  verdictKey: facts.verdict.key,
});

export async function runDiagnosis(studentId: string, options: LoadOptions = {}): Promise<DiagnosisResult | null> {
  const facts = await loadFacts(studentId, options);
  if (!facts) return null;
  return summarise(facts, diagnose(facts));
}

// ---------------------------------------------------------------------------
// Repairs
// ---------------------------------------------------------------------------

export type RepairOutcome = {
  ok: boolean;
  /** True only when the same rules, re-run afterwards, no longer report the problem. */
  verified: boolean;
  message: string;
  after?: DiagnosisResult;
};

type RepairDef = {
  needs: Capability;
  /** Does this finding, in the freshly derived diagnosis, still call for this repair with these params? */
  stillApplies: (finding: Finding, params: Record<string, string>) => boolean;
  needsPaystack: boolean;
  act: (facts: Facts, params: Record<string, string>) => Promise<{ ok: boolean; message: string }>;
  /** After acting: is the problem gone? */
  resolved: (diagnosis: Diagnosis, params: Record<string, string>) => boolean;
};

const REPAIRS: Record<RepairId, RepairDef> = {
  record_paystack_payment: {
    needs: "payments",
    needsPaystack: true,
    stillApplies: (finding, params) =>
      finding.rule === "paid-not-recorded" && finding.offers.some((o) => o.id === "record_paystack_payment" && o.params.reference === params.reference),
    async act(facts, params) {
      const reference = params.reference;
      // verifyPaystackTransaction re-asks Paystack, and only records money Paystack confirms.
      const result = await verifyPaystackTransaction(reference);
      if (result.persistFailed) {
        return { ok: false, message: "Paystack confirmed the charge but it could not be written down. Nothing was recorded — reconcile this one by hand." };
      }
      if (!result.success) {
        return { ok: false, message: result.error || "Paystack could not confirm this payment, so nothing was recorded." };
      }
      return { ok: true, message: `Paystack confirmed ${reference} and it has been recorded.` };
    },
    resolved: (diagnosis, params) =>
      !diagnosis.findings.some((f) => f.rule === "paid-not-recorded" && f.offers.some((o) => o.params.reference === params.reference)),
  },

  assign_student_code: {
    needs: "students",
    needsPaystack: false,
    stillApplies: (finding) => finding.rule === "missing-student-code",
    async act(facts) {
      const row = await prisma.student.findUnique({
        where: { id: facts.student.id },
        select: { level: true, classType: true, admission: true, branch: { select: { name: true, mode: true } } },
      });
      if (!row) return { ok: false, message: "The student could not be found." };
      const code = await assignStudentCode(facts.student.id, {
        level: row.level,
        batch: (row.admission as { batch?: unknown } | null)?.batch,
        branch: row.branch,
        classType: row.classType,
      });
      return code ? { ok: true, message: `Issued student ID ${code}.` } : { ok: false, message: "Could not allocate a free student ID after several tries. Nothing was changed." };
    },
    resolved: (diagnosis) => !diagnosis.findings.some((f) => f.rule === "missing-student-code"),
  },
};

/**
 * OWN properties only. `"toString" in REPAIRS` is true (inherited from Object), so a plain
 * `in` check would let a crafted request name a prototype method and walk straight past the
 * whitelist. The whitelist is exactly the keys written above, and nothing else.
 */
const isRepairId = (id: string): id is RepairId => Object.prototype.hasOwnProperty.call(REPAIRS, id);

export function repairCapability(id: string): Capability | null {
  return isRepairId(id) ? REPAIRS[id].needs : null;
}

export async function runRepair(input: { studentId: string; repairId: string; params?: Record<string, string> }): Promise<RepairOutcome> {
  if (!isRepairId(input.repairId)) return { ok: false, verified: false, message: "That is not a repair this tool knows how to do." };
  const def = REPAIRS[input.repairId];
  const params = input.params ?? {};

  // 1. RE-DERIVE. Never act on what the browser says is wrong; rebuild the picture.
  const facts = await loadFacts(input.studentId, {
    paystack: def.needsPaystack,
    extraReferences: params.reference ? [params.reference] : [],
  });
  if (!facts) return { ok: false, verified: false, message: "That student could not be found." };
  const before = diagnose(facts);
  const finding = before.findings.find((f) => def.stillApplies(f, params));
  if (!finding) {
    return { ok: true, verified: true, message: "Nothing to do — the problem is already gone, or this is not one this tool would fix. No changes were made.", after: summarise(facts, before) };
  }

  // 2. ACT (once, never retried).
  let acted: { ok: boolean; message: string };
  try {
    acted = await def.act(facts, params);
  } catch (error) {
    acted = { ok: false, message: `The repair failed and stopped: ${error instanceof Error ? error.message : String(error)}` };
  }

  // 3. VERIFY. Re-run the same rules; reuse Paystack's earlier answer rather than asking again.
  const after = await loadFacts(input.studentId, { reusePaystack: facts.paystack });
  const afterDiagnosis = after ? diagnose(after) : null;
  const verified = Boolean(acted.ok && afterDiagnosis && def.resolved(afterDiagnosis, params));

  // 4. AUDIT — best-effort by design (see writeAudit): a logging fault must not undo a payment record.
  await writeAudit(unguardedPrisma, {
    action: "repair",
    model: "Student",
    recordId: input.studentId,
    before: { rule: finding.rule, title: finding.title, params },
    after: { repair: input.repairId, ok: acted.ok, verified, message: acted.message },
    severity: input.repairId === "record_paystack_payment" ? "high" : "medium",
    summary: `Developer console repair "${input.repairId}": ${acted.message}`,
  }).catch(() => {});

  return {
    ok: acted.ok,
    verified,
    message: acted.ok && !verified ? `${acted.message} However, re-checking still shows the problem — look at it by hand.` : acted.message,
    after: after && afterDiagnosis ? summarise(after, afterDiagnosis) : undefined,
  };
}
