/**
 * When a tutor's class is rewritten, the students who actually sit in it
 * have to move with it.
 *
 * The tutor roster is a QUERY over branch + level + sitting, so giving a
 * class to tutor B makes those students appear on B's register immediately.
 * `Student.tutorId` is a COLUMN, and nothing used to rewrite it. The student
 * dashboard, the admin roster and the enrolment history all read that column,
 * so the office would see "still with A" while B was already taking the class.
 *
 * This is the write that closes the gap: anyone named onto a tutor who no
 * longer covers them is moved to the one tutor who now uniquely does (or
 * unlinked if nobody does), and anyone sitting in the new class whose named
 * tutor no longer covers them is pointed at this tutor. Sharing a class on
 * purpose (two tutors still covering the same sitting) is left alone — that
 * is the explicit Move button, not an automatic steal.
 */

import { prisma } from "@/lib/prisma";
import {
  assignmentMatchesStudent,
  isAssigned,
  readAssignment,
  studentWhereForLecturer,
  type LecturerAssignment,
  type SeatClassType,
} from "@/lib/lecturer-assignment";
import { setStudentCoTutors, setStudentTutor } from "@/lib/tutor-pairing";

const LECTURER_ASSIGNMENT_SELECT = {
  id: true,
  status: true,
  branchId: true,
  level: true,
  sessionSlot: true,
  branchIds: true,
  levels: true,
  sessionSlots: true,
  assignmentGroups: true,
  classTypes: true,
  batches: true,
  pathways: true,
} as const;

const STUDENT_SELECT = {
  id: true,
  tutorId: true,
  branchId: true,
  level: true,
  sessionSlot: true,
  classType: true,
  deliveryMode: true,
  hybridOnlineSlot: true,
  admission: true,
  coTutors: { select: { lecturerId: true } },
} as const;

type NamedStudent = {
  id: string;
  tutorId: string | null;
  branchId: string | null;
  level: string;
  sessionSlot: string;
  classType: string;
  deliveryMode: string;
  hybridOnlineSlot: string | null;
  admission: unknown;
  coTutors: { lecturerId: string }[];
};

function primaryClassType(student: NamedStudent): SeatClassType {
  if (student.classType === "private") return "private";
  if (student.deliveryMode === "online") return "online";
  return "physical";
}

function primaryAttempt(student: NamedStudent, onlineBranchId: string | null) {
  const classType = primaryClassType(student);
  const branchId =
    classType === "online" ? (student.branchId ?? onlineBranchId) : student.branchId;
  const sessionSlot =
    classType === "online" && student.deliveryMode === "hybrid"
      ? student.hybridOnlineSlot || student.sessionSlot
      : student.sessionSlot;
  return {
    classType,
    student: {
      branchId,
      level: student.level,
      sessionSlot,
      admission: student.admission,
    },
  };
}

/**
 * A named link is only "still theirs" when this tutor's class actually covers
 * that student. `belongsToLecturer` cannot answer this: it returns true the
 * moment `tutorId` matches, which is exactly the link we are deciding whether
 * to keep. Using it here left a tutor with no class showing 12 students after
 * everyone had been moved on.
 *
 * Private students are the exception. Naming one onto a tutor is the assignment
 * — there is often no group class to match — so that link is never stale.
 */
export function namedGroupLinkIsStale(input: { classType: string; coveredByAssignment: boolean }): boolean {
  if (input.classType === "private") return false;
  return !input.coveredByAssignment;
}

function assignmentCoversNamedStudent(
  assignment: LecturerAssignment,
  student: NamedStudent,
  onlineBranchId: string | null,
): boolean {
  const attempt = primaryAttempt(student, onlineBranchId);
  return assignmentMatchesStudent(assignment, attempt.classType, attempt.student);
}

function uniqueMatchingLecturerId(
  student: NamedStudent,
  lecturers: Array<{ id: string; assignment: LecturerAssignment }>,
  onlineBranchId: string | null,
  exceptId?: string | null,
): string | null {
  const attempt = primaryAttempt(student, onlineBranchId);
  const matches = lecturers.filter(
    (lecturer) =>
      lecturer.id !== exceptId &&
      assignmentMatchesStudent(lecturer.assignment, attempt.classType, attempt.student),
  );
  return matches.length === 1 ? matches[0].id : null;
}

export type RehomeResult = { moved: number; unlinked: number };

export async function rehomeStudentsAfterTutorAssignmentChange(input: {
  lecturerId: string;
  previous: LecturerAssignment;
  next: LecturerAssignment;
  tenantId?: string | null;
}): Promise<RehomeResult> {
  const { lecturerId, next, tenantId } = input;
  const result: RehomeResult = { moved: 0, unlinked: 0 };

  const [onlineBranch, lecturerRows] = await Promise.all([
    prisma.branch.findFirst({
      where: { mode: "online", ...(tenantId ? { tenantId } : {}) },
      select: { id: true },
    }),
    prisma.lecturer.findMany({
      where: { deletedAt: null, ...(tenantId ? { tenantId } : {}) },
      select: LECTURER_ASSIGNMENT_SELECT,
    }),
  ]);
  const onlineBranchId = onlineBranch?.id ?? null;
  // Only an active tutor can receive a student. On-leave and inactive tutors
  // stay in the coverage check below so we do not pull a class off someone
  // who is away but still assigned to it.
  const lecturers = lecturerRows
    .filter((row) => row.status === "active")
    .map((row) => ({
      id: row.id,
      assignment: readAssignment(row),
    }));
  const assignmentByLecturer = new Map(lecturerRows.map((row) => [row.id, readAssignment(row)]));

  const named = await prisma.student.findMany({
    where: {
      status: "active",
      OR: [{ tutorId: lecturerId }, { coTutors: { some: { lecturerId } } }],
    },
    select: STUDENT_SELECT,
    take: 1500,
  });

  for (const student of named as NamedStudent[]) {
    const covered = assignmentCoversNamedStudent(next, student, onlineBranchId);
    if (!namedGroupLinkIsStale({ classType: student.classType, coveredByAssignment: covered })) continue;

    if (student.tutorId === lecturerId) {
      const replacement = uniqueMatchingLecturerId(student, lecturers, onlineBranchId, lecturerId);
      const paired = await setStudentTutor({
        studentId: student.id,
        lecturerId: replacement,
        quiet: true,
      });
      if (paired.ok && paired.changed) {
        if (replacement) result.moved += 1;
        else result.unlinked += 1;
      }
      continue;
    }

    const remaining = student.coTutors.map((row) => row.lecturerId).filter((id) => id !== lecturerId);
    const dropped = await setStudentCoTutors({
      studentId: student.id,
      lecturerIds: remaining,
      quiet: true,
    });
    if (dropped.ok && dropped.changed) result.unlinked += 1;
  }

  if (!isAssigned(next)) return result;

  const cohortWhere = studentWhereForLecturer(next, lecturerId);
  if (!cohortWhere) return result;

  const cohort = await prisma.student.findMany({
    where: { ...(cohortWhere as Record<string, unknown>), status: "active" } as never,
    select: STUDENT_SELECT,
    take: 1500,
  });

  for (const student of cohort as NamedStudent[]) {
    if (!assignmentCoversNamedStudent(next, student, onlineBranchId)) continue;
    if (!student.tutorId || student.tutorId === lecturerId) continue;

    const previousAssignment = assignmentByLecturer.get(student.tutorId);
    if (previousAssignment && assignmentCoversNamedStudent(previousAssignment, student, onlineBranchId)) {
      continue;
    }

    const paired = await setStudentTutor({
      studentId: student.id,
      lecturerId,
      quiet: true,
    });
    if (paired.ok && paired.changed) result.moved += 1;
  }

  return result;
}

/**
 * Drop group-student links a tutor's class no longer covers, and point each
 * of those students at the one tutor who does.
 *
 * The admin tutor card, the tutor's own student list and the student file all
 * read `Student.tutorId`. A class that was cleared used to leave that column
 * behind, so a tutor with nobody left still read "12 students" on every one of
 * those screens. Called before those reads so the number they show is the
 * number of students who are actually still with that tutor.
 *
 * Private pairings are left alone — see `namedGroupLinkIsStale`.
 */
export async function releaseStaleNamedStudents(input: {
  lecturerId?: string;
  tenantId?: string | null;
} = {}): Promise<RehomeResult> {
  const lecturers = await prisma.lecturer.findMany({
    where: {
      deletedAt: null,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.lecturerId ? { id: input.lecturerId } : {}),
    },
    select: { id: true },
  });

  const result: RehomeResult = { moved: 0, unlinked: 0 };
  for (const lecturer of lecturers) {
    const row = await prisma.lecturer.findUnique({
      where: { id: lecturer.id },
      select: LECTURER_ASSIGNMENT_SELECT,
    });
    if (!row) continue;
    const assignment = readAssignment(row);
    const part = await rehomeStudentsAfterTutorAssignmentChange({
      lecturerId: lecturer.id,
      previous: assignment,
      next: assignment,
      tenantId: input.tenantId,
    });
    result.moved += part.moved;
    result.unlinked += part.unlinked;
  }
  return result;
}
