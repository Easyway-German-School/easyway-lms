import { prisma, unguardedPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/prisma-guard";
import { MONTH_NAMES, batchFromAdmission, monthNameToIndex } from "@/lib/batch";
import { nextLevelAfter } from "@/lib/levels";
import { instantToZonedParts } from "@/lib/school-time";
import { cohortTiming } from "@/lib/graduation";
import { scanDeskCandidates } from "@/lib/graduation-server";
import { SWEEP_ORDER, classifySweep, sweepYear, type SweepReason } from "@/lib/batch-sweep";

/**
 * Sweeps the whole student database for one batch ("August") and says, for every
 * learner who belongs to it by ANY sign, whether and why they are on the desk's lists.
 * Read-only. The only thing it can change is `adoptIntoBatch`, below, and only for the
 * learners whose own record proves they were in the batch.
 */

export type SweepRow = {
  studentId: string;
  name: string;
  email: string;
  branch: string;
  level: string;
  reason: SweepReason;
  detail: string;
  evidence: string[];
};

export type SweepResult = {
  month: string;
  year: number;
  /** Every learner in the school looked at. */
  scanned: number;
  /** How many of them belong to this batch by some sign. */
  total: number;
  counts: Record<SweepReason, number>;
  rows: SweepRow[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const when = (date: Date) =>
  date.toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Lagos" });

export async function sweepBatch(options: {
  where?: Record<string, unknown>;
  tenantId?: string | null;
  month: string;
  now?: Date;
}): Promise<SweepResult | null> {
  const now = options.now ?? new Date();
  const monthIndex = monthNameToIndex(options.month);
  if (monthIndex === null) return null;
  const month = MONTH_NAMES[monthIndex];
  const today = instantToZonedParts(now);
  const year = sweepYear(monthIndex, today.year, today.month - 1);

  // EVERY learner, any status — a withdrawn learner is part of the picture, not a blind spot.
  const students = await prisma.student.findMany({
    where: { ...(options.where ?? {}) },
    select: {
      id: true,
      status: true,
      level: true,
      admission: true,
      createdAt: true,
      classesStartedAt: true,
      levelCompletedFor: true,
      sessionSlot: true,
      branch: { select: { name: true } },
      user: { select: { name: true, email: true } },
    },
  });
  const ids = students.map((s) => s.id);

  const [histories, candidates] = await Promise.all([
    ids.length
      ? prisma.studentEnrolment.findMany({
          where: { studentId: { in: ids }, deletedAt: null },
          select: { studentId: true, batchMonth: true, batchYear: true },
        })
      : Promise.resolve([]),
    scanDeskCandidates({ where: options.where, tenantId: options.tenantId ?? null, now }),
  ]);
  const onDesk = new Set(candidates.map((c) => c.studentId));
  const historyHit = new Set(
    histories
      .filter((h) => monthNameToIndex(h.batchMonth) === monthIndex && (h.batchYear == null || h.batchYear === year))
      .map((h) => h.studentId),
  );

  const inMonth = (date: Date | null) => {
    if (!date) return false;
    const parts = instantToZonedParts(date);
    return parts.month - 1 === monthIndex && parts.year === year;
  };

  const rows: SweepRow[] = [];
  const counts = Object.fromEntries(SWEEP_ORDER.map((r) => [r, 0])) as Record<SweepReason, number>;

  for (const student of students) {
    const admission = asRecord(student.admission);
    const label = batchFromAdmission(admission);
    const movedUp =
      typeof admission.classesStartedAtBeforePromotion === "string" ||
      Boolean(student.levelCompletedFor && student.levelCompletedFor.toUpperCase() !== student.level.toUpperCase());

    // When does THEIR batch end — only worth asking when the label is this month.
    let endsOn: string | null = null;
    if (label && monthNameToIndex(label) === monthIndex) {
      const timing = cohortTiming({ batch: label, sessionSlot: student.sessionSlot, registeredAt: student.createdAt, now });
      endsOn = timing ? when(timing.endsOn) : null;
    }

    const verdict = classifySweep({
      month,
      status: student.status,
      hasNextLevel: Boolean(nextLevelAfter(student.level)),
      label,
      movedUp,
      levelNow: student.level,
      onDesk: onDesk.has(student.id),
      endsOn,
      signals: {
        history: historyHit.has(student.id),
        started: inMonth(student.classesStartedAt),
        registered: inMonth(student.createdAt),
      },
    });
    if (!verdict.belongs) continue;

    counts[verdict.reason] += 1;
    rows.push({
      studentId: student.id,
      name: student.user?.name ?? "Unnamed",
      email: student.user?.email ?? "",
      branch: student.branch?.name ?? "Unassigned",
      level: student.level,
      reason: verdict.reason,
      detail: verdict.detail,
      evidence: verdict.evidence,
    });
  }

  rows.sort(
    (a, b) => SWEEP_ORDER.indexOf(a.reason) - SWEEP_ORDER.indexOf(b.reason) || a.name.localeCompare(b.name),
  );
  return { month, year, scanned: students.length, total: rows.length, counts, rows };
}

export type AdoptResult = {
  added: Array<{ studentId: string; name: string }>;
  skipped: Array<{ studentId: string; name: string; reason: string }>;
};

/**
 * Writes the batch onto learners who have none. Only learners the sweep calls
 * "no batch on record, but they clearly were in it" are touched — their own history
 * row or first-day date proves the month — and the server re-runs the sweep at the
 * moment of the press, so the browser's list is never trusted.
 */
export async function adoptIntoBatch(
  studentIds: string[],
  options: { where?: Record<string, unknown>; tenantId?: string | null; month: string; now?: Date; by?: string },
): Promise<AdoptResult> {
  const result: AdoptResult = { added: [], skipped: [] };
  const sweep = await sweepBatch({ where: options.where, tenantId: options.tenantId, month: options.month, now: options.now });
  if (!sweep) {
    result.skipped.push({ studentId: "", name: "", reason: "That is not a month" });
    return result;
  }
  const eligible = new Map(sweep.rows.filter((r) => r.reason === "no_label_strong").map((r) => [r.studentId, r]));

  for (const studentId of studentIds) {
    const row = eligible.get(studentId);
    if (!row) {
      result.skipped.push({ studentId, name: studentId, reason: "Not a learner the sweep can safely add" });
      continue;
    }
    try {
      const student = await prisma.student.findUnique({ where: { id: studentId }, select: { admission: true } });
      if (!student) {
        result.skipped.push({ studentId, name: row.name, reason: "Student not found" });
        continue;
      }
      const admission = asRecord(student.admission);
      if (batchFromAdmission(admission)) {
        result.skipped.push({ studentId, name: row.name, reason: "Already has a batch now" });
        continue;
      }
      await prisma.student.update({
        where: { id: studentId },
        data: { admission: { ...admission, batch: sweep.month } as never },
      });
      await prisma.journeyEvent
        .create({
          data: {
            studentId,
            type: "registered",
            stage: row.level,
            label: `Added to the ${sweep.month} batch by the office`,
            detail: row.evidence.join("; "),
            source: "admin",
          },
        })
        .catch(() => undefined);
      await writeAudit(unguardedPrisma, {
        action: "batch.adopt",
        model: "Student",
        recordId: studentId,
        severity: "info",
        summary: `Put ${row.name} on the ${sweep.month} batch (${row.evidence.join("; ")}).`,
        after: { batch: sweep.month, by: options.by ?? null },
      }).catch((error) => console.error("batch adopt audit failed", { studentId, error }));
      result.added.push({ studentId, name: row.name });
    } catch (error) {
      console.error("Adopt into batch failed", { studentId, error });
      result.skipped.push({ studentId, name: row.name, reason: "Something went wrong — try again" });
    }
  }
  return result;
}
