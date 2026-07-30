import { prisma } from "@/lib/prisma";
import { monthNameToIndex } from "@/lib/schedule";
import { nextLevelAfter } from "@/lib/levels";
import { derivePaymentStatus } from "@/lib/payment";

const TUITION_BY_LEVEL: Record<string, number> = {
  A1: 150000, A2: 150000, B1: 180000, B2: 180000, C1: 200000, C2: 220000,
};

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

export const SESSION_MONTHS = 2;

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

function batchStartAbsolute(batch: string | null, now: Date): number | null {
  const monthIndex = monthNameToIndex(batch);
  if (monthIndex === null) return null;

  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  // Same rule as the schedule engine: the most recent occurrence at or before
  // now, so a "May" batch read in July started this May, not next May.
  const year = monthIndex <= currentMonth ? currentYear : currentYear - 1;
  return year * 12 + monthIndex;
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

    const startAbsolute = batchStartAbsolute(batch, now);
    // No usable batch means no way to know the session ended. Reporting those
    // as overdue would bury the real ones in false positives.
    if (startAbsolute === null) continue;

    const monthsElapsed = currentAbsolute - startAbsolute;
    if (monthsElapsed < SESSION_MONTHS) continue;

    const totalPaid = student.payments
      .filter((p) => p.status === "completed")
      .reduce((sum, p) => sum + p.amount, 0);

    const tuitionFee = TUITION_BY_LEVEL[student.level] ?? 150000;
    const { status } = derivePaymentStatus({
      totalPaid,
      tuitionFee,
      requiredDeposit: Math.round(tuitionFee * 0.6),
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
