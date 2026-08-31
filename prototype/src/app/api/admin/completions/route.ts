import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";
import { listCohort } from "@/lib/germany-journey-server";
import { LEVELS } from "@/lib/levels";
import {
  letterFor,
  PASS_MARK,
  REQUIRED_ASSESSMENT_TYPES,
  weightedCourseworkAverage,
} from "@/lib/grading";

/**
 * Batch & level completions — the roll-call the school never had.
 *
 * `/admin/journey` signs a batch off; `/admin/promotions` moves it up. Neither
 * groups "everyone who has finished level X" into one classified list, and a
 * student who has been signed off but not yet promoted falls between the two
 * screens. This endpoint classifies every student in a cohort into exactly one
 * bucket — all of it derived, none of it written here — and adds the results
 * readiness the office wants to see BEFORE it signs anyone off.
 *
 * Read-only and gated on `students`, the same capability as the cohort console
 * it links out to.
 */
export const dynamic = "force-dynamic";

export type CompletionBucket =
  | "neverStarted"
  | "heldBack"
  | "promoted"
  | "levelCompleted"
  | "awaitingSignoff"
  | "inProgress";

function levelRank(level: string): number {
  const index = (LEVELS as readonly string[]).indexOf(level.toUpperCase());
  return index === -1 ? 0 : index;
}

export async function GET(req: NextRequest) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const params = req.nextUrl.searchParams;
  const branchId = params.get("branchId");
  const level = params.get("level");
  const batch = params.get("batch");
  const sessionSlot = params.get("sessionSlot");

  try {
    const cohort = await listCohort({ branchId, level, batch, sessionSlot });

    // Students who were in this cohort's level and have since moved past it.
    // Only meaningful with a batch filter — without one this is "everyone who
    // has ever been promoted", which is noise, not a roll-call.
    let promotedRows: Array<{
      studentId: string;
      name: string;
      email: string;
      studentCode: string | null;
      level: string;
      batch: string | null;
      sessionSlot: string;
      branchName: string | null;
      classesStartedAt: string | null;
      levelCompletedFor: string | null;
      paymentStatus: string;
      outstanding: number;
      heldBackAt: string | null;
      heldBackReason: string | null;
      percent: number | null;
    }> = [];

    if (level && batch) {
      const higher = await prisma.student.findMany({
        where: {
          status: "active",
          ...(branchId ? { branchId } : {}),
          ...(sessionSlot ? { sessionSlot } : {}),
          level: { in: (LEVELS as readonly string[]).filter((l) => levelRank(l) > levelRank(level)) },
        },
        select: {
          id: true,
          level: true,
          sessionSlot: true,
          admission: true,
          classesStartedAt: true,
          levelCompletedFor: true,
          heldBackAt: true,
          heldBackReason: true,
          studentCode: true,
          user: { select: { name: true, email: true } },
          branch: { select: { name: true } },
        },
      });
      const wantBatch = batch.trim().toLowerCase();
      promotedRows = higher
        .filter((student) => {
          const admission = student.admission;
          const b =
            admission && typeof admission === "object" && typeof (admission as Record<string, unknown>).batch === "string"
              ? String((admission as Record<string, unknown>).batch).trim().toLowerCase()
              : "";
          return b === wantBatch;
        })
        .map((student) => ({
          studentId: student.id,
          name: student.user?.name ?? "Unknown",
          email: student.user?.email ?? "",
          studentCode: student.studentCode,
          level: student.level,
          batch,
          sessionSlot: student.sessionSlot,
          branchName: student.branch?.name ?? null,
          classesStartedAt: student.classesStartedAt?.toISOString() ?? null,
          levelCompletedFor: student.levelCompletedFor,
          paymentStatus: "n/a",
          outstanding: 0,
          heldBackAt: student.heldBackAt?.toISOString() ?? null,
          heldBackReason: student.heldBackReason,
          percent: 100,
        }));
    }

    const allIds = [...cohort.map((row) => row.studentId), ...promotedRows.map((row) => row.studentId)];

    // Coursework marks + attendance for the readiness columns, in two queries
    // rather than 2N.
    const grades = allIds.length
      ? await prisma.grade.findMany({
          where: { studentId: { in: allIds }, examId: null },
          orderBy: { createdAt: "desc" },
          select: { studentId: true, type: true, score: true },
        })
      : [];
    const examGrades = allIds.length
      ? await prisma.grade.findMany({
          where: { studentId: { in: allIds }, examId: { not: null } },
          select: { studentId: true, score: true, exam: { select: { resultsReleased: true } } },
        })
      : [];
    const attendance = allIds.length
      ? await prisma.attendance.findMany({
          where: { studentId: { in: allIds } },
          select: { studentId: true, present: true },
        })
      : [];

    const latestSkill = new Map<string, Map<string, number>>();
    for (const row of grades) {
      let marks = latestSkill.get(row.studentId);
      if (!marks) {
        marks = new Map();
        latestSkill.set(row.studentId, marks);
      }
      if (!marks.has(row.type)) marks.set(row.type, row.score);
    }
    const examsByStudent = new Map<string, { passed: number; taken: number }>();
    for (const row of examGrades) {
      const entry = examsByStudent.get(row.studentId) ?? { passed: 0, taken: 0 };
      entry.taken += 1;
      if (row.score >= PASS_MARK) entry.passed += 1;
      examsByStudent.set(row.studentId, entry);
    }
    const attendanceByStudent = new Map<string, { held: number; present: number }>();
    for (const row of attendance) {
      const entry = attendanceByStudent.get(row.studentId) ?? { held: 0, present: 0 };
      entry.held += 1;
      if (row.present) entry.present += 1;
      attendanceByStudent.set(row.studentId, entry);
    }

    function readiness(studentId: string) {
      const marks = latestSkill.get(studentId);
      const average = weightedCourseworkAverage(
        marks ? [...marks.entries()].map(([type, score]) => ({ type, score })) : [],
      );
      const marksOwed = REQUIRED_ASSESSMENT_TYPES.filter((type) => !marks?.has(type)).length;
      const exams = examsByStudent.get(studentId) ?? { passed: 0, taken: 0 };
      const att = attendanceByStudent.get(studentId);
      return {
        courseworkAverage: average,
        courseworkGrade: average === null ? null : letterFor(average),
        belowPassMark: average !== null && average < PASS_MARK,
        marksOwed,
        examsPassed: exams.passed,
        examsTaken: exams.taken,
        attendancePercent: att && att.held > 0 ? Math.round((att.present / att.held) * 100) : null,
      };
    }

    const cohortStudents = cohort.map((row) => {
      const clockElapsed = row.percent !== null && row.percent >= 100;
      let bucket: CompletionBucket;
      if (row.heldBackAt) bucket = "heldBack";
      else if (!row.classesStartedAt) bucket = "neverStarted";
      else if (row.levelCompletedFor === row.level) bucket = "levelCompleted";
      else if (clockElapsed) bucket = "awaitingSignoff";
      else bucket = "inProgress";

      return {
        studentId: row.studentId,
        name: row.name,
        email: row.email,
        studentCode: row.studentCode,
        level: row.level,
        batch: row.batch,
        sessionSlot: row.sessionSlot,
        branchName: row.branchName,
        classesStartedAt: row.classesStartedAt,
        percent: row.percent,
        daysElapsed: row.daysElapsed,
        levelCompletedFor: row.levelCompletedFor,
        heldBackReason: row.heldBackReason,
        paymentStatus: row.paymentStatus,
        outstanding: row.outstanding,
        bucket,
        ...readiness(row.studentId),
      };
    });

    const promotedStudents = promotedRows.map((row) => ({
      studentId: row.studentId,
      name: row.name,
      email: row.email,
      studentCode: row.studentCode,
      level: row.level,
      batch: row.batch,
      sessionSlot: row.sessionSlot,
      branchName: row.branchName,
      classesStartedAt: row.classesStartedAt,
      percent: row.percent,
      daysElapsed: null as number | null,
      levelCompletedFor: row.levelCompletedFor,
      heldBackReason: row.heldBackReason,
      paymentStatus: row.paymentStatus,
      outstanding: row.outstanding,
      bucket: "promoted" as CompletionBucket,
      ...readiness(row.studentId),
    }));

    const students = [...cohortStudents, ...promotedStudents];

    const buckets: Record<CompletionBucket, number> = {
      neverStarted: 0,
      heldBack: 0,
      promoted: 0,
      levelCompleted: 0,
      awaitingSignoff: 0,
      inProgress: 0,
    };
    for (const student of students) buckets[student.bucket] += 1;

    return NextResponse.json({
      filters: { branchId, level, batch, sessionSlot },
      passMark: PASS_MARK,
      buckets,
      summary: {
        total: students.length,
        finished: buckets.levelCompleted + buckets.promoted,
        belowPassMark: students.filter((s) => s.belowPassMark).length,
        marksIncomplete: students.filter((s) => s.marksOwed > 0).length,
        owing: students.filter((s) => s.outstanding > 0).length,
      },
      students,
    });
  } catch (error) {
    console.error("Completions list failed", error);
    return NextResponse.json({ error: "Unable to build the completions list" }, { status: 500 });
  }
}
