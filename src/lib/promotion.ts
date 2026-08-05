import { prisma } from "@/lib/prisma";
import { resolveBatchAbsolute } from "@/lib/batch";
import { nextLevelAfter, SESSION_MONTHS } from "@/lib/levels";
import { derivePaymentStatus, requiredDepositFor, tuitionFeeFor } from "@/lib/payment";

/**
 * Who has finished a level but is still sitting in it.
 *
 * A level runs for SESSION_MONTHS from the batch month. Nothing in the schema
 * records "this student's session ended", so it is derived the same way the
 * timetable generator derives the batch start — from the batch name on the
 * admission payload. Deriving it the same way matters: if this disagreed with
 * the calendar, the office would be chasing students whose classes are still
 * running.
 *
 * Promotion is deliberately manual. A student can be held back for unpaid fees
 * or a failed assessment, so this reports and the office decides.
 */

// Re-exported from levels.ts, where it also serves client code.
export { SESSION_MONTHS };

export type PromotionCandidate = {
  studentId: string;
  name: string;
  email: string;
  studentCode: string | null;
  level: string;
  nextLevel: string | null;
  sessionSlot: string;
  branchName: string | null;
  batch: string | null;
  /** Whole months since the batch started. */
  monthsElapsed: number;
  monthsOverdue: number;
  /**
   * Surfaced because an unpaid student is usually held back rather than moved
   * up, and the office needs to see that before promoting a batch.
   */
  paymentStatus: "Pending" | "Partial" | "Completed";
  totalPaid: number;
  tuitionFee: number;
  /** True when C2 — there is no level to move up to. */
  atTopOfLadder: boolean;
};

/**
 * Whole months since a student's batch began, or null when the batch name is
 * unusable.
 *
 * Exported so the student-facing advance offer derives "your level is
 * finished" from exactly the same arithmetic as the office's promotion report.
 * Two implementations would eventually disagree, and then the portal would be
 * congratulating a student the office still has mid-level.
 */
export function monthsSinceBatchStart(
  batch: string | null,
  now: Date = new Date(),
  registeredAt: Date | null = null,
): number | null {
  const startAbsolute = batchStartAbsolute(batch, now, registeredAt);
  if (startAbsolute === null) return null;
  return now.getFullYear() * 12 + now.getMonth() - startAbsolute;
}

/**
 * One shared rule, in lib/batch.ts, for which calendar month a batch name
 * points at. Passing the registration date matters here more than anywhere:
 * without it a student who registered for a batch still ahead of them read as
 * having started a year ago, and this list would put them up for promotion
 * before their first lesson.
 */
function batchStartAbsolute(batch: string | null, now: Date, registeredAt: Date | null = null): number | null {
  return resolveBatchAbsolute(batch, { registeredAt, now });
}

export async function findPromotionCandidates(opts: {
  branchId?: string | null;
  level?: string | null;
  now?: Date;
} = {}): Promise<PromotionCandidate[]> {
  const now = opts.now ?? new Date();
  const currentAbsolute = now.getFullYear() * 12 + now.getMonth();

  const students = await prisma.student.findMany({
    where: {
      status: "active",
      ...(opts.branchId ? { branchId: opts.branchId } : {}),
      ...(opts.level ? { level: opts.level.toUpperCase() } : {}),
    },
    include: {
      user: { select: { name: true, email: true } },
      branch: { select: { name: true } },
      payments: { select: { amount: true, status: true } },
    },
  });

  const candidates: PromotionCandidate[] = [];

  for (const student of students) {
    const admission =
      typeof student.admission === "object" && student.admission !== null
        ? (student.admission as Record<string, unknown>)
        : {};
    const batch = typeof admission.batch === "string" && admission.batch.trim() ? admission.batch : null;

    const startAbsolute = batchStartAbsolute(batch, now, student.createdAt);
    // No usable batch means no way to know the session ended. Reporting those
    // as overdue would bury the real ones in false positives.
    if (startAbsolute === null) continue;

    const monthsElapsed = currentAbsolute - startAbsolute;
    if (monthsElapsed < SESSION_MONTHS) continue;

    const totalPaid = student.payments
      .filter((p) => p.status === "completed")
      .reduce((sum, p) => sum + p.amount, 0);

    // Abuja charges more for the same level, so the branch has to go in.
    const feeLookup = { level: student.level, branch: student.branch?.name ?? null, classType: student.classType };
    const tuitionFee = tuitionFeeFor(feeLookup);
    const { status } = derivePaymentStatus({
      totalPaid,
      tuitionFee,
      requiredDeposit: requiredDepositFor(feeLookup),
    });

    candidates.push({
      studentId: student.id,
      name: student.user.name ?? "Unknown",
      email: student.user.email,
      studentCode: student.studentCode,
      level: student.level,
      nextLevel: nextLevelAfter(student.level),
      sessionSlot: student.sessionSlot,
      branchName: student.branch?.name ?? null,
      batch,
      monthsElapsed,
      monthsOverdue: monthsElapsed - SESSION_MONTHS,
      paymentStatus: status,
      totalPaid,
      tuitionFee,
      atTopOfLadder: nextLevelAfter(student.level) === null,
    });
  }

  // Longest overdue first — that is the order the office needs to work in.
  return candidates.sort((a, b) => b.monthsOverdue - a.monthsOverdue);
}

export type PromotionResult = {
  promoted: string[];
  skipped: Array<{ studentId: string; reason: string }>;
};

/**
 * Move students up a level. The new batch month is set to the current month so
 * their calendar regenerates from now rather than replaying the old session.
 */
export async function promoteStudents(studentIds: string[], now = new Date()): Promise<PromotionResult> {
  const result: PromotionResult = { promoted: [], skipped: [] };

  const monthName = now.toLocaleString("en-US", { month: "long" });

  for (const studentId of studentIds) {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, level: true, admission: true },
    });

    if (!student) {
      result.skipped.push({ studentId, reason: "Student not found" });
      continue;
    }

    const next = nextLevelAfter(student.level);
    if (!next) {
      result.skipped.push({ studentId, reason: `Already at ${student.level}, the top of the ladder` });
      continue;
    }

    const admission =
      typeof student.admission === "object" && student.admission !== null
        ? (student.admission as Record<string, unknown>)
        : {};

    await prisma.student.update({
      where: { id: studentId },
      data: {
        level: next,
        admission: { ...admission, batch: monthName } as any,
      },
    });

    result.promoted.push(studentId);
  }

  return result;
}
