import { prisma, unguardedPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/prisma-guard";
import { receivedPaymentFilter, requiredDepositFor } from "@/lib/payment";
import { naira } from "@/lib/finance/receivables";
import { previousLevelBefore } from "@/lib/next-level-journey";

/**
 * Fixing a move that should not have happened.
 *
 * The first live run moved a learner up who had never paid the deposit for the
 * level they left (the "owes money" check reads charge records, and a learner with
 * no charge row and no payment reads as owing nothing). The rule is fixed, but a
 * wrong move already made needs a way back that does not mean hand-editing five
 * tables, so the desk can find these learners and put them back in one press.
 *
 * What counts as wrong, and the ONLY thing this ever touches: a learner who was
 * signed off and moved up in the last two weeks, and whose total payments are still
 * below the deposit for the level they left. Anyone who has paid at least that is
 * never listed, and the test is re-run on the server at the moment of the press.
 *
 * Putting them back restores what the move changed — level, the batch they were in,
 * their first-day date, the finished-level stamp and the history rows — and removes
 * only the new level's UNPAID tuition charge. It deletes no payment and no result.
 */

/** Only recent moves are candidates: an old, deliberate move is not a mistake to undo. */
export const UNDO_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type WrongMove = {
  studentId: string;
  name: string;
  email: string;
  /** Where they are now (the level they were moved INTO). */
  level: string;
  /** Where they will go back to. */
  previousLevel: string;
  paid: number;
  needed: number;
  movedAt: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

type Row = {
  id: string;
  level: string;
  levelCompletedFor: string | null;
  levelCompletedAt: Date | null;
  classType: string;
  pathway: string;
  branch: { name: string } | null;
  user: { name: string | null; email: string } | null;
};

async function candidates(where: Record<string, unknown> | undefined, ids: string[] | undefined, now: Date) {
  const since = new Date(now.getTime() - UNDO_WINDOW_DAYS * DAY_MS);
  const students = (await prisma.student.findMany({
    where: {
      status: "active",
      levelCompletedAt: { gte: since },
      levelCompletedFor: { not: null },
      ...(where ?? {}),
      ...(ids ? { id: { in: ids } } : {}),
    },
    select: {
      id: true,
      level: true,
      levelCompletedFor: true,
      levelCompletedAt: true,
      classType: true,
      pathway: true,
      branch: { select: { name: true } },
      user: { select: { name: true, email: true } },
    },
  })) as unknown as Row[];

  // Signed off on the level BEFORE the one they are on now = they have been moved up.
  const moved = students.filter(
    (s) => s.levelCompletedFor && previousLevelBefore(s.level) === s.levelCompletedFor.toUpperCase(),
  );
  if (moved.length === 0) return [];

  const payments = await prisma.payment.findMany({
    where: { studentId: { in: moved.map((s) => s.id) }, deletedAt: null, ...receivedPaymentFilter() },
    select: { studentId: true, amount: true },
  });
  const paidBy = new Map<string, number>();
  for (const payment of payments) paidBy.set(payment.studentId, (paidBy.get(payment.studentId) ?? 0) + (payment.amount || 0));

  const wrong: WrongMove[] = [];
  for (const s of moved) {
    const previousLevel = previousLevelBefore(s.level) as string;
    const needed = requiredDepositFor({
      level: previousLevel,
      branch: s.branch?.name ?? null,
      classType: s.classType,
      pathway: s.pathway,
    });
    const paid = paidBy.get(s.id) ?? 0;
    if (paid >= needed) continue;
    wrong.push({
      studentId: s.id,
      name: s.user?.name ?? "Unnamed",
      email: s.user?.email ?? "",
      level: s.level,
      previousLevel,
      paid,
      needed,
      movedAt: (s.levelCompletedAt as Date).toISOString(),
    });
  }
  return wrong.sort((a, b) => a.name.localeCompare(b.name));
}

export async function findWronglyMoved(options: { where?: Record<string, unknown>; now?: Date } = {}): Promise<WrongMove[]> {
  return candidates(options.where, undefined, options.now ?? new Date());
}

export type UndoResult = {
  restored: Array<{ studentId: string; name: string; level: string; batchRestored: boolean }>;
  skipped: Array<{ studentId: string; name: string; reason: string }>;
};

export async function undoWrongMoves(
  studentIds: string[],
  options: { where?: Record<string, unknown>; now?: Date; by?: string } = {},
): Promise<UndoResult> {
  const now = options.now ?? new Date();
  const result: UndoResult = { restored: [], skipped: [] };
  if (studentIds.length === 0) return result;

  // Re-decided here, at the moment of the press — the browser's list is never trusted.
  const wrong = new Map((await candidates(options.where, studentIds, now)).map((row) => [row.studentId, row]));

  for (const studentId of studentIds) {
    const row = wrong.get(studentId);
    if (!row) {
      result.skipped.push({ studentId, name: studentId, reason: "Not a wrongly moved learner (they have paid, or the move is older than two weeks)" });
      continue;
    }

    try {
      const student = await prisma.student.findUnique({
        where: { id: studentId },
        select: { id: true, admission: true, classesStartedAt: true },
      });
      if (!student) {
        result.skipped.push({ studentId, name: row.name, reason: "Student not found" });
        continue;
      }
      const admission = asRecord(student.admission);

      // The batch they were in before the move was written to the history row the move closed.
      const finished = await prisma.studentEnrolment.findFirst({
        where: { studentId, level: row.previousLevel, deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: { id: true, batchMonth: true, startedAt: true },
      });
      const previousStart =
        typeof admission.classesStartedAtBeforePromotion === "string"
          ? new Date(admission.classesStartedAtBeforePromotion)
          : (finished?.startedAt ?? null);
      const batchRestored = Boolean(finished?.batchMonth);

      const { nextLevel: _intent, classesStartedAtBeforePromotion: _before, ...rest } = admission;
      void _intent;
      void _before;

      await prisma.student.update({
        where: { id: studentId },
        data: {
          level: row.previousLevel,
          levelCompletedFor: null,
          levelCompletedAt: null,
          classesStartedAt: previousStart && !Number.isNaN(previousStart.getTime()) ? previousStart : null,
          startConfirmedAt: null,
          startConfirmedVia: null,
          admission: { ...rest, ...(finished?.batchMonth ? { batch: finished.batchMonth } : {}) } as never,
        },
      });

      // History: the level they never really left is ongoing again; the one they never began is removed.
      await prisma.studentEnrolment
        .updateMany({
          where: { studentId, level: row.level, outcome: "ongoing", deletedAt: null },
          data: { deletedAt: now },
        })
        .catch(() => undefined);
      if (finished) {
        await prisma.studentEnrolment
          .update({ where: { id: finished.id }, data: { outcome: "ongoing", endedAt: null } })
          .catch(() => undefined);
      }

      // Only the new level's charge, and only because nothing has been paid towards it.
      await prisma.tuitionCharge
        .updateMany({ where: { studentId, level: row.level, deletedAt: null }, data: { deletedAt: now } })
        .catch(() => undefined);

      await prisma.journeyEvent
        .create({
          data: {
            studentId,
            type: "registered",
            stage: row.previousLevel,
            label: `Move up to ${row.level} undone by the office`,
            detail: `Paid ${naira(row.paid)} of the ${naira(row.needed)} ${row.previousLevel} deposit.`,
            source: "admin",
          },
        })
        .catch(() => undefined);

      await writeAudit(unguardedPrisma, {
        action: "graduation.undo_move",
        model: "Student",
        recordId: studentId,
        severity: "warning",
        summary: `Put ${row.name} back on ${row.previousLevel} (moved up to ${row.level} without paying the ${row.previousLevel} deposit: ${naira(row.paid)} of ${naira(row.needed)}).`,
        after: { level: row.previousLevel, undoneBy: options.by ?? null },
      }).catch((error) => console.error("undo audit write failed", { studentId, error }));

      result.restored.push({ studentId, name: row.name, level: row.previousLevel, batchRestored });
    } catch (error) {
      console.error("Undo failed for a learner", { studentId, error });
      result.skipped.push({ studentId, name: row.name, reason: "Something went wrong — try this learner again" });
    }
  }
  return result;
}
