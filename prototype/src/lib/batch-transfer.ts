import type { Prisma } from "@prisma/client";

import { prisma, unguardedPrisma } from "@/lib/prisma";
import {
  batchFromAdmission,
  batchYearFromAdmission,
  monthNameToIndex,
  MONTH_NAMES,
  resolveBatchWindow,
} from "@/lib/batch";
import { getStudentAccess } from "@/lib/student-access";
import { realignStudentCodeById } from "@/lib/student-code";
import { PART_PAYMENT_LOCK_DAYS } from "@/lib/access";
import { KIND, notify } from "@/lib/notify";
import { reassignTutorForPlacement } from "@/lib/tutor-auto-assign";
import { writeAudit } from "@/lib/prisma-guard";
import { readCurrentIntake } from "@/lib/intake-server";

/**
 * MOVING STUDENTS TO ANOTHER BATCH - the one place that does it.
 *
 * "August" is a batch, not a year, and a batch is a place a student sits: a
 * tutor, a timetable, a student ID, a register. Until this existed there was no
 * way to say "these August students now go to October" - the only batch move
 * was a bare month-name rewrite that left the tutor, the start date and the
 * year behind, and the promotion report landed everybody in whatever the
 * calendar month happened to be.
 *
 * THE WORKFLOW, which is the point:
 *
 *   1. The office picks students and a DESTINATION (month + year). That is
 *      recorded on the student as `admission.pendingBatchTransfer` - nothing
 *      else changes yet.
 *   2. The move TAKES EFFECT only once the student's tuition deposit has
 *      cleared. A student who has not paid does not get into October's class,
 *      does not land on October's tutor's register, and is not counted in the
 *      October roll. Whoever has already paid moves immediately.
 *   3. Taking effect is one operation (`activatePaidBatchTransfer`): the batch
 *      and its year on the admission, the enrolment history, a fresh "have you
 *      started?" clock, the student ID, and the tutor(s) who teach the
 *      destination batch. Then the student is told.
 *
 * Step 2 is triggered from every place money lands (Paystack verify + webhook,
 * the office recording a payment, the student opening their portal) and, as the
 * backstop for any path that was missed, from the daily cron
 * (`sweepPendingBatchTransfers`).
 */

export type BatchDestination = { month: string; year: number };

export function formatDestination(destination: BatchDestination): string {
  return `${destination.month} ${destination.year}`;
}

export function readPendingBatchTransfer(admission: unknown): BatchDestination | null {
  if (!admission || typeof admission !== "object") return null;
  const pending = (admission as Record<string, unknown>).pendingBatchTransfer;
  if (!pending || typeof pending !== "object") return null;

  const value = pending as Record<string, unknown>;
  const monthIndex = monthNameToIndex(value.month);
  if (monthIndex === null || typeof value.year !== "number" || !Number.isInteger(value.year)) return null;
  return { month: MONTH_NAMES[monthIndex], year: value.year };
}

export function withPendingBatchTransfer(
  admission: unknown,
  destination: BatchDestination,
  scheduledBy?: string | null,
): Record<string, unknown> {
  const current: Record<string, unknown> = admission && typeof admission === "object"
    ? (admission as Record<string, unknown>)
    : {};
  return {
    ...current,
    pendingBatchTransfer: {
      ...destination,
      scheduledAt: new Date().toISOString(),
      ...(scheduledBy ? { scheduledBy } : {}),
    },
  };
}

/** `admission` with any scheduled move taken off it. */
export function withoutPendingBatchTransfer(admission: unknown): Record<string, unknown> {
  const current = admission && typeof admission === "object" ? { ...(admission as Record<string, unknown>) } : {};
  delete current.pendingBatchTransfer;
  return current;
}

/**
 * Is this a destination the office is allowed to send somebody to? Not in the
 * past - a student cannot be moved into a batch that has already finished - and
 * not absurdly far ahead, which is almost always a typo'd year.
 */
export function parseBatchDestination(
  month: unknown,
  year: unknown,
  now: Date = new Date(),
): { ok: true; destination: BatchDestination } | { ok: false; error: string } {
  const monthIndex = monthNameToIndex(month);
  const numericYear = typeof year === "number" ? year : Number(year);
  if (monthIndex === null || !Number.isInteger(numericYear)) {
    return { ok: false, error: "Choose a destination batch (month and year)." };
  }
  const absolute = numericYear * 12 + monthIndex;
  const currentAbsolute = now.getFullYear() * 12 + now.getMonth();
  if (absolute < currentAbsolute) {
    return { ok: false, error: "A destination batch cannot be in the past." };
  }
  if (numericYear > now.getFullYear() + 5) {
    return { ok: false, error: "That destination year looks wrong." };
  }
  return { ok: true, destination: { month: MONTH_NAMES[monthIndex], year: numericYear } };
}

/**
 * Where a student lands when nobody chose. The school's current intake - the
 * batch it is enrolling for right now - unless that has already slipped into
 * the past (a setting nobody updated), in which case the calendar month. Never
 * a batch that has already finished.
 */
export async function defaultDestination(tenantId: string | null | undefined, now: Date = new Date()): Promise<BatchDestination> {
  const calendar: BatchDestination = { month: MONTH_NAMES[now.getMonth()], year: now.getFullYear() };
  try {
    const intake = await readCurrentIntake(tenantId);
    const parsed = parseBatchDestination(intake.month, intake.year, now);
    return parsed.ok ? parsed.destination : calendar;
  } catch {
    return calendar;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The batch (month + year) a student's admission says they are in right now. */
export function currentBatchOf(admission: unknown, registeredAt?: Date | null): BatchDestination | null {
  const month = batchFromAdmission(admission);
  if (!month) return null;
  const monthIndex = monthNameToIndex(month);
  if (monthIndex === null) return null;
  const year =
    batchYearFromAdmission(admission) ??
    resolveBatchWindow(month, { registeredAt: registeredAt ?? null })?.year ??
    null;
  return year === null ? null : { month: MONTH_NAMES[monthIndex], year };
}

/**
 * Activate a scheduled move once the student's tuition deposit is cleared.
 * Safe to call from anywhere, any number of times, concurrently: it returns
 * false without touching anything unless there is a scheduled move AND the
 * deposit has cleared, and only one caller can claim a given scheduled move.
 */
export async function activatePaidBatchTransfer(studentId: string): Promise<boolean> {
  // Cheap exit first - this runs on every payment and every portal load.
  const early = await prisma.student.findUnique({ where: { id: studentId }, select: { admission: true } });
  if (!early || !readPendingBatchTransfer(early.admission)) return false;

  const access = await getStudentAccess(studentId);
  if (!access?.depositCleared) return false;

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      level: true,
      branchId: true,
      tutorId: true,
      tenantId: true,
      sessionSlot: true,
      classType: true,
      deliveryMode: true,
      createdAt: true,
      admission: true,
    },
  });
  if (!student) return false;

  const fromBatch = currentBatchOf(student.admission, student.createdAt);
  let activated: BatchDestination | null = null;

  await prisma.$transaction(async (tx) => {
    const current = await tx.student.findUnique({
      where: { id: studentId },
      select: { admission: true },
    });
    if (!current) return;

    const admission = asRecord(current.admission);
    const destination = readPendingBatchTransfer(admission);
    if (!destination) return;

    const pending = asRecord(admission.pendingBatchTransfer);
    const scheduledAt = typeof pending.scheduledAt === "string" ? pending.scheduledAt : null;
    const { pendingBatchTransfer: _pending, ...cleanAdmission } = admission;
    const nextAdmission = { ...cleanAdmission, batch: destination.month, batchYear: destination.year };

    // Claim it. Paystack's verify call, its webhook, the office and the
    // student's own portal can all reach this within the same second; only the
    // writer whose scheduled-move stamp still matches gets to run the rest, so
    // the enrolment history is not written twice.
    const claim = await tx.student.updateMany({
      where: {
        id: studentId,
        ...(scheduledAt
          ? { admission: { path: ["pendingBatchTransfer", "scheduledAt"], equals: scheduledAt } }
          : {}),
      },
      data: {
        admission: nextAdmission as Prisma.InputJsonValue,
        // A new batch is a new first day. Carrying the old start date over is
        // not harmless: `classesHaveBegun` trusts it over the batch window, so
        // an August start date would have the October register marking a
        // student absent for classes that were never held.
        classesStartedAt: null,
        startConfirmedAt: null,
        startConfirmedVia: null,
        startPromptSnoozedUntil: null,
        notStartedCount: 0,
        notStartedReason: null,
      },
    });
    if (claim.count === 0) return;

    const open = await tx.studentEnrolment.findFirst({
      where: { studentId, outcome: "ongoing", deletedAt: null },
      orderBy: { createdAt: "desc" },
    });

    if (!(open?.batchMonth === destination.month && open.batchYear === destination.year)) {
      if (open) {
        await tx.studentEnrolment.update({
          where: { id: open.id },
          data: {
            endedAt: new Date(),
            outcome: "transferred",
            outcomeNote: `Moved to ${formatDestination(destination)} after tuition deposit cleared`,
          },
        });
      }

      await tx.studentEnrolment.create({
        data: {
          studentId: student.id,
          level: student.level,
          branchId: student.branchId,
          tutorId: student.tutorId,
          sessionSlot: student.sessionSlot,
          classType: student.classType,
          deliveryMode: student.deliveryMode,
          batchMonth: destination.month,
          batchYear: destination.year,
          startedAt: null,
          outcome: "ongoing",
          // Same level, so the same tuition charge and the fee it was struck at.
          ...(open?.tuitionChargeId ? { tuitionChargeId: open.tuitionChargeId } : {}),
          ...(open?.feeSnapshot != null ? { feeSnapshot: open.feeSnapshot } : {}),
          ...(student.tenantId ? { tenantId: student.tenantId } : {}),
        },
      });
    }

    activated = destination;
  });

  if (!activated) return false;
  const destination: BatchDestination = activated;
  const label = formatDestination(destination);

  // Everything below is best-effort and individually isolated: the move itself
  // is committed, and a failed notification must never undo it or hide it.
  await realignStudentCodeById(studentId).catch((error) => {
    console.error("Student code realign failed after batch transfer", { studentId, error });
  });

  const tutorOutcome = await reassignTutorForPlacement(studentId, `the ${label} batch`).catch((error) => {
    console.error("Tutor re-placement failed after batch transfer", { studentId, error });
    return null;
  });

  await grantFreshBalanceWindow(studentId, destination).catch((error) => {
    console.error("Balance window after batch transfer failed", { studentId, error });
  });

  await writeAudit(unguardedPrisma, {
    action: "student.batch_transfer",
    model: "Student",
    recordId: studentId,
    severity: "info",
    summary: `Moved from ${fromBatch ? formatDestination(fromBatch) : "no batch"} to ${label} (tuition deposit cleared). Tutor: ${tutorOutcome ?? "unchanged"}.`,
    after: { from: fromBatch, to: destination, tutor: tutorOutcome },
  }).catch((error) => console.error("batch transfer audit write failed", { studentId, error }));

  const window = resolveBatchWindow(destination.month, { batchYear: destination.year });
  const begins = window?.hasBegun
    ? "The batch is under way, so you can join in now."
    : window
      ? `Classes begin on ${window.startsOn.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.`
      : "";
  await notify({
    to: { studentIds: [studentId] },
    kind: KIND.announcement,
    severity: "success",
    title: `You're now in the ${label} batch`,
    message: `The office has moved you to the ${label} batch. Your timetable, tutor and student ID have been updated. ${begins}`.trim(),
    link: "/dashboard",
    push: true,
    dedupeKey: `batch-moved:${studentId}:${destination.month}:${destination.year}`,
  }).catch((error) => console.error("Batch move notification failed", { studentId, error }));

  return true;
}

/**
 * A part-payer's balance lock runs 30 days from their oldest open charge - which
 * for somebody moved from August to October is an August date, so they would be
 * locked out the moment they arrived. Give them the same 30 days the batch
 * itself gives anybody: from the destination batch's first day. Only ever moves
 * the grace date later, never earlier, and only for someone with a balance.
 */
async function grantFreshBalanceWindow(studentId: string, destination: BatchDestination): Promise<void> {
  const access = await getStudentAccess(studentId);
  if (!access?.depositCleared || access.outstandingBalance <= 0) return;

  const window = resolveBatchWindow(destination.month, { batchYear: destination.year });
  if (!window) return;
  const target = new Date(window.startsOn.getTime() + PART_PAYMENT_LOCK_DAYS * 24 * 60 * 60 * 1000);

  const student = await prisma.student.findUnique({ where: { id: studentId }, select: { paymentGraceUntil: true } });
  if (student?.paymentGraceUntil && student.paymentGraceUntil.getTime() >= target.getTime()) return;
  await prisma.student.update({ where: { id: studentId }, data: { paymentGraceUntil: target } });
}

export type TransferTarget = { id: string; admission: unknown; createdAt: Date };

export type TransferSummary = {
  /** Students given a (new) scheduled move. */
  scheduled: number;
  /** Of everyone selected, those whose move took effect now. */
  activated: number;
  /** Scheduled but waiting on the tuition deposit. */
  awaitingPayment: number;
  /** Already in the destination batch - nothing to do. */
  alreadyThere: number;
  failed: number;
};

/**
 * Schedule a move for each student, and activate it straight away for anybody
 * whose deposit has already cleared. Scope (tenant, branch) is the caller's
 * business - pass only students the admin is allowed to touch.
 */
export async function scheduleBatchTransfers(
  targets: TransferTarget[],
  destination: BatchDestination,
  scheduledBy: string | null,
): Promise<TransferSummary> {
  const summary: TransferSummary = { scheduled: 0, activated: 0, awaitingPayment: 0, alreadyThere: 0, failed: 0 };
  const label = formatDestination(destination);

  const place = async (student: TransferTarget) => {
    try {
      const pending = readPendingBatchTransfer(student.admission);
      const here = currentBatchOf(student.admission, student.createdAt);
      const alreadyThere = here?.month === destination.month && here.year === destination.year;

      if (alreadyThere && !pending) {
        summary.alreadyThere += 1;
        return;
      }
      if (alreadyThere && pending) {
        // They are where the office wants them; a stale, different pending move
        // would only drag them away later when they pay.
        await prisma.student.update({
          where: { id: student.id },
          data: { admission: withoutPendingBatchTransfer(student.admission) as Prisma.InputJsonValue },
        });
        summary.alreadyThere += 1;
        return;
      }

      const sameAsPending = pending?.month === destination.month && pending.year === destination.year;
      if (!sameAsPending) {
        await prisma.student.update({
          where: { id: student.id },
          data: {
            admission: withPendingBatchTransfer(student.admission, destination, scheduledBy) as Prisma.InputJsonValue,
          },
        });
        summary.scheduled += 1;
      }

      if (await activatePaidBatchTransfer(student.id)) {
        summary.activated += 1;
        return;
      }

      summary.awaitingPayment += 1;
      await notify({
        to: { studentIds: [student.id] },
        kind: KIND.announcement,
        severity: "info",
        title: `Your place is reserved for the ${label} batch`,
        message: `The office has placed you in the ${label} batch. It takes effect, and your new tutor and timetable appear, as soon as your tuition deposit is confirmed.`,
        link: "/payments",
        push: true,
        dedupeKey: `batch-reserved:${student.id}:${destination.month}:${destination.year}`,
      }).catch((error) => console.error("Batch reservation notification failed", { studentId: student.id, error }));
    } catch (error) {
      summary.failed += 1;
      console.error("Batch transfer failed for a student", { studentId: student.id, error });
    }
  };

  // Bounded concurrency: each activation is a dozen queries plus notifications.
  const CONCURRENCY = 8;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    await Promise.all(targets.slice(i, i + CONCURRENCY).map(place));
  }
  return summary;
}

/** Take a scheduled move off each student. Returns how many actually had one. */
export async function cancelBatchTransfers(targets: TransferTarget[]): Promise<number> {
  let cancelled = 0;
  for (const student of targets) {
    if (!readPendingBatchTransfer(student.admission)) continue;
    await prisma.student.update({
      where: { id: student.id },
      data: { admission: withoutPendingBatchTransfer(student.admission) as Prisma.InputJsonValue },
    });
    cancelled += 1;
  }
  return cancelled;
}

/**
 * The daily backstop. Payments reach the database by several roads (Paystack
 * verify, the Paystack webhook, Stripe, the office keying one in, a waiver or a
 * payment plan changing what is owed) and each has to remember to ask whether a
 * scheduled move can now go ahead. This asks on their behalf, for everyone.
 */
export async function sweepPendingBatchTransfers(limit = 300): Promise<{
  pending: number;
  activated: number;
  stillWaiting: number;
  failed: number;
}> {
  const rows = await prisma.student.findMany({
    where: { admission: { path: ["pendingBatchTransfer", "month"], string_contains: "" } },
    select: { id: true },
    take: limit,
  });

  let activated = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      if (await activatePaidBatchTransfer(row.id)) activated += 1;
    } catch (error) {
      failed += 1;
      console.error("Batch transfer sweep failed for a student", { studentId: row.id, error });
    }
  }
  return { pending: rows.length, activated, stillWaiting: rows.length - activated - failed, failed };
}

export function activeBatchFromAdmission(admission: unknown): string | null {
  return batchFromAdmission(admission);
}
