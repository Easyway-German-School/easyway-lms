import { prisma } from "@/lib/prisma";
import { receivedPaymentFilter } from "@/lib/payment";
import { naira } from "@/lib/finance/receivables";
import { KIND, notify } from "@/lib/notify";

/**
 * Negotiated tuition instalment plans — the tracked replacement for setting
 * `Student.paymentGraceUntil` by hand.
 *
 * WHILE a plan is `active` and the student is keeping up, `deriveStudentAccess`
 * treats it exactly like a grace date: the 30-day part-payment lock is
 * suppressed and the balance-reminder ladder is held. A missed instalment past
 * its grace window flips the plan to `defaulted` and the lock + reminders come
 * straight back — see `sweepPaymentPlans`, run from /api/cron/tick.
 *
 * Adherence is a RUNNING-TOTAL test, not instalment-by-instalment: a student
 * paying "₦20k every Friday" just needs cumulative payments since the plan
 * started to keep up with cumulative amounts due. No Payment row is tied to a
 * particular instalment.
 */

export type Installment = { dueOn: string; amount: number; paidAt?: string | null };

const DAY_MS = 24 * 60 * 60 * 1000;

function toWholeNaira(value: unknown): number {
  return Math.max(0, Math.round(Number(value) || 0));
}

export function normaliseInstallments(raw: unknown): Installment[] {
  if (!Array.isArray(raw)) return [];
  const out: Installment[] = [];
  for (const entry of raw) {
    const row = (entry ?? {}) as Record<string, unknown>;
    const dueOn = new Date(String(row.dueOn ?? ""));
    if (Number.isNaN(dueOn.getTime())) continue;
    const amount = toWholeNaira(row.amount);
    if (amount <= 0) continue;
    out.push({
      dueOn: dueOn.toISOString(),
      amount,
      paidAt: row.paidAt ? new Date(String(row.paidAt)).toISOString() : null,
    });
  }
  return out.sort((a, b) => a.dueOn.localeCompare(b.dueOn));
}

export type PlanAdherence = {
  /** on_track — nothing overdue; behind — a due instalment is unpaid past its
   *  grace; completed — the whole plan total is covered. */
  status: "on_track" | "behind" | "completed";
  planTotal: number;
  /** Amount whose due date (+ graceDays) has passed. */
  dueByNow: number;
  /** Received payments since the plan started. */
  paidSincePlan: number;
  /** max(0, dueByNow − paidSincePlan). */
  shortfall: number;
  nextDue: { dueOn: string; amount: number } | null;
};

export function evaluatePlanAdherence(
  plan: { installments: unknown; startingPaid: number | null; graceDays: number | null },
  currentReceivedPaid: number,
  now: Date = new Date(),
): PlanAdherence {
  const installments = normaliseInstallments(plan.installments);
  const graceMs = Math.max(0, Number(plan.graceDays) || 0) * DAY_MS;
  const planTotal = installments.reduce((sum, inst) => sum + inst.amount, 0);
  const paidSincePlan = Math.max(0, toWholeNaira(currentReceivedPaid) - toWholeNaira(plan.startingPaid));

  const dueByNow = installments
    .filter((inst) => new Date(inst.dueOn).getTime() + graceMs <= now.getTime())
    .reduce((sum, inst) => sum + inst.amount, 0);

  const nextDueRow = installments.find((inst) => new Date(inst.dueOn).getTime() > now.getTime()) ?? null;
  const shortfall = Math.max(0, dueByNow - paidSincePlan);

  const status: PlanAdherence["status"] =
    paidSincePlan >= planTotal && planTotal > 0 ? "completed" : shortfall > 0 ? "behind" : "on_track";

  return {
    status,
    planTotal,
    dueByNow,
    paidSincePlan,
    shortfall,
    nextDue: nextDueRow ? { dueOn: nextDueRow.dueOn, amount: nextDueRow.amount } : null,
  };
}

/** A plan that is holding back the lock — active and not behind. */
export function planSuppressesLock(adherence: PlanAdherence | null): boolean {
  return !!adherence && (adherence.status === "on_track" || adherence.status === "completed");
}

/* -------------------------------------------------------------------------- */
/* DB helpers                                                                 */
/* -------------------------------------------------------------------------- */

async function receivedPaidFor(studentId: string): Promise<number> {
  const rows = await prisma.payment.findMany({
    where: { studentId, ...receivedPaymentFilter() },
    select: { amount: true },
  });
  return rows.reduce((sum, row) => sum + (row.amount || 0), 0);
}

export async function activePlanForStudent(studentId: string) {
  return prisma.paymentPlan.findFirst({
    where: { studentId, status: "active", deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
}

/** Active plan + its live adherence, or null when there is no active plan. */
export async function planStatusForStudent(
  studentId: string,
  now: Date = new Date(),
): Promise<{ plan: Awaited<ReturnType<typeof activePlanForStudent>>; adherence: PlanAdherence } | null> {
  const plan = await activePlanForStudent(studentId);
  if (!plan) return null;
  const adherence = evaluatePlanAdherence(plan, await receivedPaidFor(studentId), now);
  return { plan, adherence };
}

export async function createPaymentPlan(input: {
  studentId: string;
  chargeIds: string[];
  installments: Array<{ dueOn: string; amount: number }>;
  graceDays?: number;
  note?: string;
  createdById?: string;
}) {
  const installments = normaliseInstallments(input.installments);
  if (installments.length === 0) {
    throw new Error("A payment plan needs at least one dated instalment.");
  }

  const student = await prisma.student.findUnique({
    where: { id: input.studentId },
    select: { id: true, tenantId: true },
  });
  if (!student) throw new Error("Student not found.");

  // Only one active plan at a time — retire any existing one.
  await prisma.paymentPlan.updateMany({
    where: { studentId: input.studentId, status: "active", deletedAt: null },
    data: { status: "cancelled", updatedAt: new Date() },
  });

  return prisma.paymentPlan.create({
    data: {
      studentId: input.studentId,
      chargeIds: input.chargeIds,
      installments,
      graceDays: input.graceDays && input.graceDays > 0 ? Math.round(input.graceDays) : 3,
      startingPaid: await receivedPaidFor(input.studentId),
      createdById: input.createdById ?? null,
      note: input.note ?? null,
      ...(student.tenantId ? { tenantId: student.tenantId } : {}),
    },
  });
}

/**
 * Student ids whose ACTIVE plan is currently on track — the cron jobs treat
 * these exactly like a future grace date (lock held, reminders paused).
 */
export async function onTrackPlanStudentIds(now: Date = new Date()): Promise<Set<string>> {
  const plans = await prisma.paymentPlan.findMany({
    where: { status: "active", deletedAt: null },
    select: { studentId: true, installments: true, startingPaid: true, graceDays: true },
  });
  const ids = new Set<string>();
  for (const plan of plans) {
    const adherence = evaluatePlanAdherence(plan, await receivedPaidFor(plan.studentId), now);
    if (planSuppressesLock(adherence)) ids.add(plan.studentId);
  }
  return ids;
}

export async function cancelPaymentPlan(planId: string): Promise<void> {
  await prisma.paymentPlan.updateMany({
    where: { id: planId, status: "active" },
    data: { status: "cancelled", updatedAt: new Date() },
  });
}

/**
 * Cron sweep: move every active plan to `completed` or `defaulted` as its
 * adherence dictates, and tell the accountant when one defaults. Idempotent —
 * only rows still `active` are touched.
 */
export async function sweepPaymentPlans(now: Date = new Date()): Promise<{
  checked: number;
  defaulted: number;
  completed: number;
}> {
  const plans = await prisma.paymentPlan.findMany({
    where: { status: "active", deletedAt: null },
    include: { student: { select: { id: true, user: { select: { name: true } } } } },
  });

  let defaulted = 0;
  let completed = 0;

  for (const plan of plans) {
    const adherence = evaluatePlanAdherence(plan, await receivedPaidFor(plan.studentId), now);

    if (adherence.status === "completed") {
      await prisma.paymentPlan.update({
        where: { id: plan.id },
        data: { status: "completed", completedAt: now, updatedAt: now },
      });
      completed += 1;
      continue;
    }

    if (adherence.status === "behind") {
      await prisma.paymentPlan.update({
        where: { id: plan.id },
        data: { status: "defaulted", defaultedAt: now, updatedAt: now },
      });
      defaulted += 1;
      await notify({
        to: { audience: "admin", capability: "payments" },
        kind: KIND.tuitionReminder,
        severity: "warning",
        title: "Payment plan missed",
        message: `${plan.student.user?.name ?? "A student"}'s tuition payment plan is ${naira(
          adherence.shortfall,
        )} behind and has defaulted. Their portal lock and balance reminders are active again.`,
        link: `/admin/students/${plan.studentId}`,
        dedupeKey: `plan-default-${plan.id}`,
      }).catch((error) => console.error("payment plan default notify failed", { planId: plan.id, error }));
    }
  }

  return { checked: plans.length, defaulted, completed };
}
