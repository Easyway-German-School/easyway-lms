import { prisma, unguardedPrisma } from "@/lib/prisma";
import { resolveBatchAbsolute } from "@/lib/batch";
import { nextLevelAfter, SESSION_MONTHS, sessionDurationMonths } from "@/lib/levels";
import { DEPOSIT_RATE, derivePaymentStatus, isReceivedPayment, isRegistrationFeePayment, requiredDepositFor, tuitionFeeFor } from "@/lib/payment";
import { ensureChargeForLevel, loadStudentLedger } from "@/lib/tuition-charges";
import { writeAudit } from "@/lib/prisma-guard";
import { naira } from "@/lib/finance/receivables";
import { closeOpenEnrolment, openEnrolment } from "@/lib/student-enrolment";

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
      payments: { select: { amount: true, status: true, description: true } },
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
    const monthsAllowed = sessionDurationMonths(student.sessionSlot);
    if (monthsElapsed < monthsAllowed) continue;

    const totalPaid = student.payments
      .filter((p) => isReceivedPayment(p.status) && !isRegistrationFeePayment(p.description))
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
      monthsOverdue: monthsElapsed - monthsAllowed,
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
  /** Students promoted only because a super-admin overrode an open fee balance. */
  overridden?: string[];
};

export type PromotionOptions = {
  now?: Date;
  /**
   * Supplied only when a super-admin has chosen to move a student up DESPITE an
   * unsettled go-forward tuition balance. Without it, such a student is skipped.
   * Every override is written to the audit trail. Legacy arrears never block a
   * promotion and never need an override.
   */
  override?: { by: string; reason: string };
};

/**
 * Move students up a level. The new batch month is set to the current month so
 * their calendar regenerates from now rather than replaying the old session.
 *
 * A student who still owes on a GO-FORWARD charge (their current level or an
 * earlier one they were signed off from) is skipped unless `override` is given
 * — see PromotionOptions. This is the gate that stops the A1 -> B1 ride: you
 * cannot climb the ladder while a level below you is unpaid, and an office that
 * decides to make an exception leaves a logged reason.
 */
export async function promoteStudents(
  studentIds: string[],
  optionsOrNow: Date | PromotionOptions = {},
): Promise<PromotionResult> {
  // Back-compat: this used to take `now` as the second arg positionally.
  const options: PromotionOptions =
    optionsOrNow instanceof Date ? { now: optionsOrNow } : optionsOrNow;
  const now = options.now ?? new Date();
  const override = options.override;

  const result: PromotionResult = { promoted: [], skipped: [], overridden: [] };

  const monthName = now.toLocaleString("en-US", { month: "long" });

  for (const studentId of studentIds) {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        level: true,
        admission: true,
        branchId: true,
        tutorId: true,
        sessionSlot: true,
        classType: true,
        deliveryMode: true,
        tenantId: true,
      },
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

    // The fee gate. Blocks on money owed for a level the student has ALREADY
    // been in — not on the normal post-deposit balance of the level they are
    // moving into (its charge, if the next-level checkout created it early, is
    // the balance the 30-day lock covers, not a promotion blocker). Legacy
    // arrears never block.
    const ledger = await loadStudentLedger(studentId, now);
    const priorOwedLines = ledger.lines.filter(
      (line) => line.outstanding > 0 && !line.legacyArrears && line.level !== next,
    );
    const priorOwed = priorOwedLines.reduce((sum, line) => sum + line.outstanding, 0);
    if (priorOwed > 0) {
      if (!override) {
        const owedOn = priorOwedLines[0]?.level ?? student.level;
        result.skipped.push({
          studentId,
          reason: `Owes ${naira(priorOwed)} on ${owedOn} — settle the balance or promote with an override`,
        });
        continue;
      }
      await writeAudit(unguardedPrisma, {
        action: "promotion.fee_override",
        model: "Student",
        recordId: studentId,
        severity: "warning",
        summary: `Promoted ${student.level} → ${next} with ${naira(priorOwed)} still owed on ${priorOwedLines[0]?.level ?? student.level}. Override by ${override.by}: ${override.reason}`,
        after: {
          fromLevel: student.level,
          toLevel: next,
          priorOwed,
          owedOnLevels: priorOwedLines.map((line) => ({ level: line.level, outstanding: line.outstanding })),
          overriddenBy: override.by,
          reason: override.reason,
        },
      }).catch((auditError) => {
        console.error("promotion.fee_override audit write failed", { studentId, auditError });
      });
      result.overridden!.push(studentId);
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

    // Raise the tuition charge for the level they just moved into, so what they
    // owe follows them up the ladder instead of the old level's shortfall
    // dropping out of the maths. Idempotent — a next-level payment may have
    // created it already. Best-effort: a missing charge is repaired by the
    // backfill and receivables falls back to the per-level figure meanwhile.
    let charge: { chargeId: string; amount: number } | null = null;
    try {
      charge = await ensureChargeForLevel({ studentId, level: next, origin: "promotion" });
    } catch (chargeError) {
      console.error("Tuition charge creation failed on promotion", { studentId, next, chargeError });
    }

    // Close the level they just left and open the one they are moving into —
    // see src/lib/student-enrolment.ts. This is the record that makes
    // "returning student" and "who was here in 2024" answerable instead of
    // guessed at: Student.level only ever held the CURRENT level, so every
    // promotion used to erase where somebody had actually been. Best-effort,
    // same as the tuition charge above — a missed enrolment row is repaired by
    // the backfill and nothing here blocks the promotion itself on it.
    try {
      await closeOpenEnrolment(studentId, { outcome: "completed", now });
      await openEnrolment({
        studentId,
        level: next,
        branchId: student.branchId,
        tutorId: student.tutorId,
        sessionSlot: student.sessionSlot,
        classType: student.classType,
        deliveryMode: student.deliveryMode,
        batch: monthName,
        registeredAt: now,
        tenantId: student.tenantId,
        startedAt: now,
        tuitionChargeId: charge?.chargeId ?? null,
        feeSnapshot: charge?.amount ?? null,
        now,
      });
    } catch (enrolmentError) {
      console.error("Enrolment history update failed on promotion", { studentId, next, enrolmentError });
    }

    result.promoted.push(studentId);
  }

  return result;
}

/**
 * The other end of the "Continue to {nextLevel}" checkout — called from the
 * Paystack verify/webhook paths once a `forNextLevel` payment completes.
 *
 * Re-checks sign-off from the database rather than trusting the payment
 * metadata, and is naturally idempotent: the first call moves `Student.level`
 * to the next level, so `levelCompletedFor` (still holding the OLD level
 * string) can never again equal the new `level` — a retried webhook or a
 * verify/webhook race landing here twice for the same transition is a no-op
 * on the second call.
 */
export async function promoteIfNextLevelPayment(
  studentId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  if (String(metadata?.forNextLevel) !== "true") return;

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, level: true, levelCompletedFor: true, levelCompletedAt: true },
  });

  if (!student) return;

  // Raise the charge for the level they are paying into up front, whether or not
  // the promotion proceeds this call — the payment that just landed has to have
  // a charge to be allocated against (src/lib/finance/ledger.ts).
  const target = nextLevelAfter(student.level);
  if (target) {
    try {
      await ensureChargeForLevel({ studentId, level: target, origin: "next_level_payment" });
    } catch (chargeError) {
      console.error("Tuition charge creation failed for next-level payment", { studentId, target, chargeError });
    }
  }

  if (student.levelCompletedFor !== student.level || !student.levelCompletedAt) return;

  // No human in the loop here, so no override path. Auto-promotion proceeds
  // only when the payment that just landed has (a) cleared everything owed on
  // levels the student was already in, and (b) covered at least the 60% deposit
  // on the level they are moving into. The checkout bills exactly that total
  // (prior open balance + new-level deposit — see /api/paystack/initialize). If
  // it is short, the payment is still recorded and FIFO-allocated; the student
  // stays put until it is covered or the office promotes them by hand.
  const ledger = await loadStudentLedger(studentId);
  const targetLine = target ? ledger.lines.find((line) => line.level === target) : null;
  const priorOwed = ledger.lines
    .filter((line) => !line.legacyArrears && line.level !== target)
    .reduce((sum, line) => sum + line.outstanding, 0);
  const targetDepositMet = targetLine
    ? targetLine.allocated >= Math.round(targetLine.net * DEPOSIT_RATE)
    : false;

  if (priorOwed > 0 || !targetDepositMet) {
    console.info("promoteIfNextLevelPayment: holding promotion, balance still open", {
      studentId,
      priorOwed,
      targetDepositMet,
    });
    return;
  }

  await promoteStudents([studentId]);
}
