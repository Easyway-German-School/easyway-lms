import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import {
  letterFor,
  PASS_MARK,
  REQUIRED_ASSESSMENT_TYPES,
  weightedCourseworkAverage,
} from "@/lib/grading";
import { resolveRoster } from "@/lib/lecturer-roster";

/**
 * The school-wide gradebook.
 *
 * The tutor gradebook shows one tutor their own class. Nothing showed the
 * office the marks across every class at once — so "which tutor is behind on
 * marking", "is anyone entering marks that look wrong", and "what is this
 * cohort actually scoring" were questions with no screen behind them. The
 * marking queue answers the same shape of question for handed-in assignments;
 * this answers it for the scores a tutor keys in by hand.
 *
 * Read-only: the office watches the book, it does not write in it. A mark is
 * the tutor's to enter and the tutor's to correct.
 *
 * Gated on `exams` — assessment oversight, the same capability as the marking
 * queue, not the front desk's `students`.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireCapability("exams");
  if (!gate.ok) return gate.response;

  const lecturers = await prisma.lecturer.findMany({
    select: { id: true, userId: true, status: true, user: { select: { name: true, email: true } } },
  });

  const rosters = await Promise.all(
    lecturers.map(async (lecturer) => ({ lecturer, roster: await resolveRoster(lecturer.userId) })),
  );

  const allStudentIds = rosters.flatMap(({ roster }) =>
    roster.ok ? roster.students.map((student) => student.id) : [],
  );

  const grades = allStudentIds.length
    ? await prisma.grade.findMany({
        where: { studentId: { in: allStudentIds }, examId: null },
        orderBy: { createdAt: "desc" },
        select: { studentId: true, type: true, score: true, createdAt: true },
      })
    : [];

  /** Newest mark per (student, type), plus when the student was last marked. */
  const latestByStudent = new Map<string, Map<string, { type: string; score: number }>>();
  const lastEntryByStudent = new Map<string, string>();
  for (const grade of grades) {
    let marks = latestByStudent.get(grade.studentId);
    if (!marks) {
      marks = new Map();
      latestByStudent.set(grade.studentId, marks);
    }
    if (!marks.has(grade.type)) marks.set(grade.type, { type: grade.type, score: grade.score });
    if (!lastEntryByStudent.has(grade.studentId)) {
      lastEntryByStudent.set(grade.studentId, grade.createdAt.toISOString());
    }
  }

  const tutors = rosters
    .flatMap(({ lecturer, roster }) => {
      if (!roster.ok) return [];

      const students = roster.students.map((student) => {
        const marks = latestByStudent.get(student.id);
        const average = weightedCourseworkAverage(marks ? [...marks.values()] : []);
        const requiredMarked = REQUIRED_ASSESSMENT_TYPES.filter((type) => marks?.has(type)).length;
        return {
          id: student.id,
          name: student.name,
          studentCode: student.studentCode,
          level: student.level,
          sessionSlot: student.sessionSlot,
          average,
          letter: average === null ? null : letterFor(average),
          passing: average === null ? null : average >= PASS_MARK,
          owed: REQUIRED_ASSESSMENT_TYPES.length - requiredMarked,
          lastEntryAt: lastEntryByStudent.get(student.id) ?? null,
        };
      });

      const graded = students.filter(
        (student): student is typeof student & { average: number } => student.average !== null,
      );

      return [
        {
          lecturerId: lecturer.id,
          name: lecturer.user.name || lecturer.user.email,
          email: lecturer.user.email,
          status: lecturer.status,
          studentCount: students.length,
          gradedCount: graded.length,
          owedTotal: students.reduce((sum, student) => sum + student.owed, 0),
          classAverage: graded.length
            ? Math.round(graded.reduce((sum, student) => sum + student.average, 0) / graded.length)
            : null,
          lastEntryAt: students.reduce<string | null>((latest, student) => {
            if (!student.lastEntryAt) return latest;
            return !latest || student.lastEntryAt > latest ? student.lastEntryAt : latest;
          }, null),
          students,
        },
      ];
    })
    .filter((tutor) => tutor.studentCount > 0)
    .sort((a, b) => b.owedTotal - a.owedTotal || a.name.localeCompare(b.name));

  return NextResponse.json({
    passMark: PASS_MARK,
    requiredTypes: REQUIRED_ASSESSMENT_TYPES,
    tutors,
    totals: {
      tutors: tutors.length,
      students: tutors.reduce((sum, tutor) => sum + tutor.studentCount, 0),
      owed: tutors.reduce((sum, tutor) => sum + tutor.owedTotal, 0),
      unmarkedStudents: tutors.reduce(
        (sum, tutor) => sum + (tutor.studentCount - tutor.gradedCount),
        0,
      ),
    },
  });
}
