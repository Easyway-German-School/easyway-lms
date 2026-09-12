/**
 * The database half of the cohort classifier — see cohort-classify.ts for what
 * it decides and why.
 *
 * One batch of grouped queries over a roster (never per-student), then every
 * student is run through the pure classifier. Read-only: this never writes a
 * batch month or a start date, it only reports what it would.
 */

import { prisma } from "@/lib/prisma";
import { batchFromAdmission } from "@/lib/batch";
import {
  classifyCohortStatus,
  type CohortClassification,
  type CohortSignals,
  type CohortStatus,
} from "@/lib/cohort-classify";
import type { CurrentIntake } from "@/lib/intake";

/** Key the /admin/cohorts worklist writes an office decision under. */
export const COHORT_STATUS_KEY = "cohortStatus";

/**
 * Pull a "this is what they are" decision off the admission blob, whether a
 * staff member recorded it from the /admin/cohorts worklist or the student
 * answered it themselves from the CohortCheckMoment popup. Shape:
 *   { cohortStatus: "ongoing", cohortStatusStartedOn: "2026-03-01",
 *     cohortStatusAt: "2026-09-08T…", cohortStatusBy: "student" | "<admin name>" }
 */
export function readCohortOverride(admission: unknown): CohortSignals["officeOverride"] {
  if (!admission || typeof admission !== "object") return null;
  const blob = admission as Record<string, unknown>;
  const status = blob[COHORT_STATUS_KEY];
  if (status !== "new" && status !== "ongoing" && status !== "returning") return null;
  return {
    status,
    startedOn: typeof blob.cohortStatusStartedOn === "string" ? blob.cohortStatusStartedOn : null,
    setAt: typeof blob.cohortStatusAt === "string" ? blob.cohortStatusAt : null,
    by: typeof blob.cohortStatusBy === "string" ? blob.cohortStatusBy : null,
  };
}

export type RosterStudent = {
  id: string;
  level: string;
  admission: unknown;
  createdAt: Date;
  classesStartedAt: Date | null;
  levelCompletedFor: string | null;
};

export type RosterClassification = {
  byId: Record<string, CohortClassification>;
  tally: Record<CohortStatus, number> & { mismatches: number };
};

const EMPTY_TALLY: RosterClassification["tally"] = {
  new: 0,
  ongoing: 0,
  returning: 0,
  unknown: 0,
  mismatches: 0,
};

export async function classifyRoster(
  students: RosterStudent[],
  currentIntake: CurrentIntake,
  now: Date = new Date(),
): Promise<RosterClassification> {
  const ids = students.map((s) => s.id);
  if (ids.length === 0) return { byId: {}, tally: { ...EMPTY_TALLY } };

  const [attendance, grades, submissions, quests, enrolments, startedEvents] = await Promise.all([
    prisma.attendance.groupBy({
      by: ["studentId"],
      where: { studentId: { in: ids }, status: { in: ["present", "late"] } },
      _min: { date: true },
      _count: { _all: true },
    }),
    prisma.grade.groupBy({
      by: ["studentId"],
      where: { studentId: { in: ids } },
      _min: { createdAt: true },
      _count: { _all: true },
    }),
    prisma.assignmentSubmission.groupBy({
      by: ["studentId"],
      where: { studentId: { in: ids }, submittedAt: { not: null } },
      _min: { submittedAt: true },
      _count: { _all: true },
    }),
    prisma.materialQuestAttempt.groupBy({
      by: ["studentId"],
      where: { studentId: { in: ids } },
      _min: { createdAt: true },
      _count: { _all: true },
    }),
    prisma.studentEnrolment.findMany({
      where: { studentId: { in: ids }, deletedAt: null },
      select: { studentId: true, outcome: true, startedAt: true, batchMonth: true },
    }),
    prisma.journeyEvent.groupBy({
      by: ["studentId"],
      where: { studentId: { in: ids }, type: "started" },
      _min: { occurredAt: true },
    }),
  ]);

  const attById = new Map(attendance.map((r) => [r.studentId, r]));
  const gradeById = new Map(grades.map((r) => [r.studentId, r]));
  const subById = new Map(submissions.map((r) => [r.studentId, r]));
  const questById = new Map(quests.map((r) => [r.studentId, r]));
  const startedById = new Map(startedEvents.map((r) => [r.studentId, r]));

  const enrolById = new Map<string, typeof enrolments>();
  for (const row of enrolments) {
    const list = enrolById.get(row.studentId);
    if (list) list.push(row);
    else enrolById.set(row.studentId, [row]);
  }

  const byId: Record<string, CohortClassification> = {};
  const tally = { ...EMPTY_TALLY };

  for (const student of students) {
    const att = attById.get(student.id);
    const grade = gradeById.get(student.id);
    const sub = subById.get(student.id);
    const quest = questById.get(student.id);
    const evs = enrolById.get(student.id) ?? [];

    const classworkCount =
      (grade?._count._all ?? 0) + (sub?._count._all ?? 0) + (quest?._count._all ?? 0);
    const priorEnrolmentsCompleted = evs.filter(
      (e) => e.outcome === "completed" || e.outcome === "transferred",
    ).length;
    const openEnrolment = evs.find((e) => e.outcome === "ongoing") ?? null;

    const classification = classifyCohortStatus({
      registeredAt: student.createdAt,
      storedBatch: batchFromAdmission(student.admission),
      level: student.level,
      classesStartedAt: student.classesStartedAt,
      levelCompletedFor: student.levelCompletedFor,
      firstAttendanceAt: att?._min.date ?? null,
      attendanceCount: att?._count._all ?? 0,
      firstGradeAt: grade?._min.createdAt ?? null,
      firstSubmissionAt: sub?._min.submittedAt ?? null,
      firstQuestAt: quest?._min.createdAt ?? null,
      classworkCount,
      priorEnrolmentsCompleted,
      currentEnrolmentStartedAt: openEnrolment?.startedAt ?? null,
      currentEnrolmentBatchMonth: openEnrolment?.batchMonth ?? null,
      journeyStartedAt: startedById.get(student.id)?._min.occurredAt ?? null,
      currentIntake,
      now,
      officeOverride: readCohortOverride(student.admission),
    });

    byId[student.id] = classification;
    tally[classification.status] += 1;
    if (classification.mismatch) tally.mismatches += 1;
  }

  return { byId, tally };
}
