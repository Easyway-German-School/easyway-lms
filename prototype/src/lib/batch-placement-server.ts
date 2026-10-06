import { prisma } from "@/lib/prisma";
import { classifyRoster } from "@/lib/cohort-classify-server";
import { readCurrentIntake } from "@/lib/intake-server";
import { batchOfAdmission } from "@/lib/class-batch";
import { decidePlacement } from "@/lib/batch-placement";

/**
 * Give every student who has no batch on record the batch the evidence says — when
 * the evidence is clear — and say plainly who is left and why.
 *
 * Runs from the daily cron AND from the "Place them now" button on /admin/cohorts, so
 * old data heals itself without anyone pressing anything, and the office can also
 * trigger it and read what it did. The rule that decides is `decidePlacement`
 * (lib/batch-placement.ts): it only ever FILLS an empty batch, never changes one.
 *
 * A student's batch is stamped with how it got there (`batchPlacedBy: "auto"`, the
 * date, and the basis) so an automatic placement can always be told from one a
 * person made, and checked.
 */

export type PlacedStudent = { id: string; name: string; batch: string; reason: string; basis: string };
export type LeftForAPerson = { id: string; name: string; reason: string };

export type PlacementReport = {
  applied: boolean;
  /** Active, non-private students found with no usable batch. */
  scanned: number;
  placed: PlacedStudent[];
  needsPerson: LeftForAPerson[];
  /** Set when there were more than `limit` to look at (the rest is picked up on the next run). */
  truncated: boolean;
};

const DEFAULT_LIMIT = 300;

export async function placeUnplacedStudents(
  opts: { apply: boolean; tenantId?: string | null; limit?: number; now?: Date } = { apply: false },
): Promise<PlacementReport> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? DEFAULT_LIMIT;

  const candidates = await prisma.student.findMany({
    where: {
      status: "active",
      deletedAt: null,
      // A private student has no batch (their timetable is their own bookings).
      classType: { not: "private" },
      ...(opts.tenantId ? { OR: [{ tenantId: opts.tenantId }, { branch: { tenantId: opts.tenantId } }] } : {}),
    },
    select: {
      id: true,
      level: true,
      admission: true,
      createdAt: true,
      classesStartedAt: true,
      levelCompletedFor: true,
      tenantId: true,
      user: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Batch lives in the admission JSON, so "has none" is decided here, not in SQL.
  const unplaced = candidates.filter((student) => !batchOfAdmission(student.admission));
  const batch = unplaced.slice(0, limit);
  const report: PlacementReport = {
    applied: opts.apply,
    scanned: unplaced.length,
    placed: [],
    needsPerson: [],
    truncated: unplaced.length > limit,
  };
  if (batch.length === 0) return report;

  const nameOf = (s: (typeof batch)[number]) => s.user?.name || s.user?.email || "Unnamed student";

  // The one thing the classifier does not hand back separately: the batch the OPEN enrolment names.
  const enrolments = await prisma.studentEnrolment.findMany({
    where: { studentId: { in: batch.map((s) => s.id) }, outcome: "ongoing", deletedAt: null },
    select: { studentId: true, batchMonth: true },
  });
  const enrolmentBatch = new Map(enrolments.map((e) => [e.studentId, e.batchMonth]));

  // The current intake is per school (tenant); classify each school's students against its own.
  const byTenant = new Map<string, typeof batch>();
  for (const student of batch) {
    const key = student.tenantId ?? "";
    byTenant.set(key, [...(byTenant.get(key) ?? []), student]);
  }

  for (const [tenantKey, students] of byTenant) {
    const intake = await readCurrentIntake(tenantKey || null);
    const { byId } = await classifyRoster(
      students.map((s) => ({
        id: s.id,
        level: s.level,
        admission: s.admission,
        createdAt: s.createdAt,
        classesStartedAt: s.classesStartedAt,
        levelCompletedFor: s.levelCompletedFor,
      })),
      intake,
      now,
    );

    for (const student of students) {
      const raw =
        student.admission && typeof student.admission === "object"
          ? (student.admission as Record<string, unknown>).batch
          : null;
      // A batch written as something that is not a month ("Jan 2026") is somebody's mistake to correct, not ours to overwrite.
      if (typeof raw === "string" && raw.trim()) {
        report.needsPerson.push({ id: student.id, name: nameOf(student), reason: `Their batch is written as “${raw.trim()}”, which is not a month` });
        continue;
      }

      const decision = decidePlacement({
        classification: byId[student.id],
        enrolmentBatchMonth: enrolmentBatch.get(student.id) ?? null,
        currentIntakeMonth: intake.month,
        now,
      });
      if (!decision.place) {
        report.needsPerson.push({ id: student.id, name: nameOf(student), reason: decision.reason });
        continue;
      }

      if (opts.apply) {
        // Re-read at the moment of writing: someone may have placed them in the meantime, and we only ever fill a gap.
        const fresh = await prisma.student.findUnique({ where: { id: student.id }, select: { admission: true } });
        if (batchOfAdmission(fresh?.admission)) continue;
        const admission =
          fresh?.admission && typeof fresh.admission === "object" && !Array.isArray(fresh.admission)
            ? (fresh.admission as Record<string, unknown>)
            : {};
        await prisma.student.update({
          where: { id: student.id },
          data: {
            admission: {
              ...admission,
              batch: decision.batch,
              batchPlacedBy: "auto",
              batchPlacedAt: now.toISOString(),
              batchPlacedBasis: decision.basis,
            } as never,
          },
        });
      }
      report.placed.push({ id: student.id, name: nameOf(student), batch: decision.batch, reason: decision.reason, basis: decision.basis });
    }
  }

  return report;
}
