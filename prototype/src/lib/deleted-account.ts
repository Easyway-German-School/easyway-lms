import { Prisma } from "@prisma/client";
import { guardedPrisma, unguardedPrisma } from "@/lib/prisma";

/**
 * Re-using the email address of a student the office deleted.
 *
 * `User` is a soft-delete model (src/lib/prisma-guard.ts): deleting a student
 * turns into `deletedAt = now()` and the row — with its email — stays in the
 * table. The unique index on `User.email` still holds that address, so adding
 * the same person back used to be impossible two ways over:
 *
 *   1. the pre-check `user.findUnique({ where: { email }, select: { id: true } })`
 *      still returned the tombstone's id (the guard only hides a soft-deleted
 *      row from `findUnique` when `deletedAt` is in the selection), so the add
 *      form reported "that email already has an account";
 *   2. past that check, `user.create({ data: { email } })` hit the email unique
 *      index against the tombstone and threw P2002.
 *
 * A new enrolment reuses the tombstone because the email is globally unique.
 * Old tuition charges and enrolments are archived, while payment transactions
 * stay attached so real cash is not lost and can credit the new charge.
 */

export type EmailAccountState =
  | { kind: "free" }
  | { kind: "live"; userId: string }
  | { kind: "deleted"; userId: string; studentId: string | null; tenantId: string | null };

/**
 * What, if anything, currently holds this email address — asked on the
 * unguarded client so a soft-deleted tombstone is visible rather than hidden.
 *
 * A soft-deleted account is only reported as `deleted` (i.e. reclaimable) when
 * it was a plain student login. A deleted staff account that happened to share
 * the address is reported as `live` so the caller still refuses the add.
 */
export async function lookupEmailAccount(email: string): Promise<EmailAccountState> {
  const normalized = email.trim().toLowerCase();
  const user = await unguardedPrisma.user.findUnique({
    where: { email: normalized },
    select: {
      id: true,
      role: true,
      adminRole: true,
      tenantId: true,
      deletedAt: true,
      student: { select: { id: true } },
    },
  });

  if (!user) return { kind: "free" };
  if (!user.deletedAt) return { kind: "live", userId: user.id };

  const wasPlainStudent = user.role === "STUDENT" && user.adminRole == null;
  if (!wasPlainStudent) return { kind: "live", userId: user.id };

  return {
    kind: "deleted",
    userId: user.id,
    studentId: user.student?.id ?? null,
    tenantId: user.tenantId,
  };
}

/**
 * Archive rows that describe the former billing obligation or enrolment.
 * Payment transactions are intentionally retained: they represent real cash
 * and must remain visible to both accounting and the student's new ledger.
 * The guarded delete operations write restorable audit entries. Small batches
 * stay below the Prisma guard's destructive-write limit.
 */
async function archiveRows(
  ids: string[],
  remove: (batch: string[]) => Promise<unknown>,
): Promise<void> {
  for (let offset = 0; offset < ids.length; offset += 100) {
    await remove(ids.slice(offset, offset + 100));
  }
}

async function archiveDeletedStudentHistory(studentId: string, tenantId: string | null): Promise<void> {
  const [payments, charges, plans, enrolments] = await Promise.all([
    guardedPrisma.payment.findMany({ where: { studentId }, select: { id: true, tenantId: true } }),
    guardedPrisma.tuitionCharge.findMany({ where: { studentId }, select: { id: true } }),
    guardedPrisma.paymentPlan.findMany({ where: { studentId }, select: { id: true } }),
    guardedPrisma.studentEnrolment.findMany({
      where: { studentId, deletedAt: null },
      select: { id: true },
    }),
  ]);

  if (tenantId) {
    const unscopedPayments = payments.filter((payment) => payment.tenantId == null);
    await archiveRows(unscopedPayments.map(({ id }) => id), (ids) =>
      guardedPrisma.payment.updateMany({
        where: { id: { in: ids }, studentId, tenantId: null },
        data: { tenantId },
      }),
    );
  }

  await archiveRows(charges.map(({ id }) => id), (ids) =>
    guardedPrisma.tuitionCharge.deleteMany({ where: { id: { in: ids } } }),
  );
  await archiveRows(plans.map(({ id }) => id), (ids) =>
    guardedPrisma.paymentPlan.deleteMany({ where: { id: { in: ids } } }),
  );
  await archiveRows(enrolments.map(({ id }) => id), (ids) =>
    guardedPrisma.studentEnrolment.deleteMany({ where: { id: { in: ids } } }),
  );
}

/**
 * State to reset when a soft-deleted student is reused. These fields are
 * applied in the same nested User update that clears both tombstones.
 */
export const FRESH_ENROLMENT_STUDENT_RESET = {
  deletedAt: null,
  status: "active",
  examReadiness: 0,
  outcome: "C1 readiness + German work placement support",
  nextLive: "No live session scheduled",
  graduationDate: null,
  advanceOfferedFor: null,
  enrolmentLetterSentAt: null,
  welcomeTourSeenAt: null,
  storyTourSeenAt: null,
  tutorialsPromoSeenAt: null,
  classesStartedAt: null,
  startConfirmedAt: null,
  startConfirmedVia: null,
  startPromptSnoozedUntil: null,
  notStartedCount: 0,
  notStartedReason: null,
  levelCompletedAt: null,
  levelCompletedFor: null,
  heldBackAt: null,
  heldBackReason: null,
  journeyStages: Prisma.DbNull,
  journeySeenAt: null,
  journeyMomentPreference: "daily",
  germanyGoal: null,
  germanyGoalNote: null,
  germanyGoalSetAt: null,
  feeRemindersScheduled: Prisma.DbNull,
  paymentGraceUntil: null,
  tags: [],
};

/**
 * Archive the old active billing and enrolment rows before a deleted student
 * is reused. The caller revives User and Student together with the new details
 * in one nested write. No-op if the account is no longer a tombstone.
 */
export async function archiveDeletedAccountHistory(
  userId: string,
  tenantId: string | null,
): Promise<void> {
  const user = await unguardedPrisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      tenantId: true,
      deletedAt: true,
      student: { select: { id: true, deletedAt: true } },
    },
  });
  if (!user) return;
  if (user.tenantId !== tenantId) {
    throw new Error("Refusing to archive a deleted student account outside the current school.");
  }
  if (!user.deletedAt) return;

  if (user.student) {
    await archiveDeletedStudentHistory(user.student.id, tenantId);
  }
}
