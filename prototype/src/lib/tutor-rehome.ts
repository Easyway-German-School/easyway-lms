/**
 * When a tutor's class is rewritten — or the tutor is deactivated — the
 * students who sit with them have to move with that change.
 *
 * The tutor roster is a QUERY over branch + level + sitting, so giving a
 * class to tutor B makes those students appear on B's register immediately.
 * `Student.tutorId` is a COLUMN, and nothing used to rewrite it. The student
 * dashboard, the admin roster and the enrolment history all read that column,
 * so the office would see "still with A" while B was already taking the class.
 *
 * This is the write that closes the gap: anyone named onto a tutor who no
 * longer covers them is moved to the tutor who now teaches that same course,
 * batch and level (or unlinked if nobody does), and anyone sitting in the new
 * class whose named tutor no longer covers them is pointed at this tutor.
 * Sharing a class on purpose (two active tutors still covering the same
 * sitting) is left alone — that is the explicit Move button, not an automatic
 * steal.
 *
 * COVERAGE MUST MATCH LINKING. Link-all can put an online tutor beside a
 * hybrid student as a co-tutor for the online seat. Rehome used to decide
 * "still covered?" from the campus seat alone, then strip those co-tutor rows
 * on every admin refresh — which is why "Link all 15" kept coming back as 15.
 * Coverage here now checks every seat the student occupies, the same way
 * `fittingSeat` does when linking.
 */

import { prisma } from "@/lib/prisma";
import {
  assignmentMatchesStudent,
  isAssigned,
  readAssignment,
  studentWhereForLecturer,
  type LecturerAssignment,
} from "@/lib/lecturer-assignment";
import { seatsFor, type LinkStudent } from "@/lib/tutor-class-match";
import { setStudentCoTutors, setStudentTutor } from "@/lib/tutor-pairing";

const LECTURER_ASSIGNMENT_SELECT = {
  id: true,
  status: true,
  startedAt: true,
  createdAt: true,
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

type RankedLecturer = {
  id: string;
  assignment: LecturerAssignment;
  startedAt: Date | null;
  createdAt: Date;
};

/**
 * Who may keep a named student link.
 * Inactive tutors cannot teach or open a live room, so their links are always
 * stale. On-leave is temporary — leave the pairing alone until the office
 * deactivates or moves people on purpose. Missing / unknown status is treated
 * as gone (soft-deleted tutor row).
 */
export function lecturerKeepsNamedStudents(status: string | null | undefined): boolean {
  return status === "active" || status === "probation" || status === "on_leave";
}

function asLinkStudent(student: NamedStudent): LinkStudent {
  return {
    id: student.id,
    branchId: student.branchId,
    level: student.level,
    sessionSlot: student.sessionSlot,
    classType: student.classType,
    deliveryMode: student.deliveryMode,
    hybridOnlineSlot: student.hybridOnlineSlot,
    admission: student.admission,
    tutorId: student.tutorId,
    coTutorIds: student.coTutors.map((row) => row.lecturerId),
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

/**
 * Does this tutor's assignment reach ANY seat the student occupies?
 * Must stay aligned with `fittingSeat` in tutor-class-match.ts — a hybrid
 * online co-tutor only covers the online seat, and that still counts.
 */
export function assignmentCoversAnySeat(
  assignment: LecturerAssignment,
  student: NamedStudent,
  onlineBranchId: string | null,
): boolean {
  if (!isAssigned(assignment)) return false;
  for (const seat of seatsFor(asLinkStudent(student), onlineBranchId)) {
    if (
      assignmentMatchesStudent(assignment, seat.classType, {
        branchId: seat.branchId,
        level: student.level,
        sessionSlot: seat.sessionSlot,
        admission: student.admission,
      })
    ) {
      return true;
    }
  }
  return false;
}

function scoreReplacement(
  lecturer: RankedLecturer,
  student: NamedStudent,
  onlineBranchId: string | null,
): number {
  let score = 0;
  const seats = seatsFor(asLinkStudent(student), onlineBranchId);
  for (const seat of seats) {
    if (
      assignmentMatchesStudent(lecturer.assignment, seat.classType, {
        branchId: seat.branchId,
        level: student.level,
        sessionSlot: seat.sessionSlot,
        admission: student.admission,
      })
    ) {
      score += 10;
      if (seat.branchId && lecturer.assignment.branchIds.includes(seat.branchId)) score += 3;
      if (
        lecturer.assignment.sessionSlots.some(
          (slot) => slot.toLowerCase() === seat.sessionSlot.toLowerCase(),
        )
      ) {
        score += 2;
      }
    }
  }
  // Prefer the newest tutor teaching this class ("nearest new tutor").
  const started = lecturer.startedAt?.getTime() ?? lecturer.createdAt.getTime();
  score += Math.min(started / 1e12, 1);
  return score;
}

/**
 * Pick the active tutor who teaches this student's course, batch and level.
 * When several fit, prefer the one whose seats overlap most, then the newest
 * — never leave the student unlinked just because two tutors share a class.
 */
export function pickReplacementLecturerId(
  student: NamedStudent,
  lecturers: RankedLecturer[],
  onlineBranchId: string | null,
  exceptId?: string | null,
): string | null {
  const matches = lecturers.filter(
    (lecturer) =>
      lecturer.id !== exceptId && assignmentCoversAnySeat(lecturer.assignment, student, onlineBranchId),
  );
  if (!matches.length) return null;
  if (matches.length === 1) return matches[0].id;

  matches.sort((a, b) => {
    const scoreDiff = scoreReplacement(b, student, onlineBranchId) - scoreReplacement(a, student, onlineBranchId);
    if (scoreDiff !== 0) return scoreDiff;
    const aTime = a.startedAt?.getTime() ?? a.createdAt.getTime();
    const bTime = b.startedAt?.getTime() ?? b.createdAt.getTime();
    return bTime - aTime;
  });
  return matches[0].id;
}

export type RehomeResult = { moved: number; unlinked: number };

async function loadActiveLecturers(tenantId?: string | null): Promise<{
  onlineBranchId: string | null;
  lecturers: RankedLecturer[];
  assignmentByLecturer: Map<string, LecturerAssignment>;
  statusByLecturer: Map<string, string>;
}> {
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
  const statusByLecturer = new Map(lecturerRows.map((row) => [row.id, row.status]));
  const assignmentByLecturer = new Map(lecturerRows.map((row) => [row.id, readAssignment(row)]));
  // Only tutors who can actually teach may receive a student. On-leave and
  // inactive are skipped as destinations; inactive are also force-released
  // as sources via lecturerKeepsNamedStudents.
  const lecturers = lecturerRows
    .filter((row) => row.status === "active" || row.status === "probation")
    .map((row) => ({
      id: row.id,
      assignment: readAssignment(row),
      startedAt: row.startedAt,
      createdAt: row.createdAt,
    }));

  return { onlineBranchId, lecturers, assignmentByLecturer, statusByLecturer };
}

async function rehomeNamedStudentsOfLecturer(input: {
  lecturerId: string;
  next: LecturerAssignment;
  /** When true, every named group link is treated as stale regardless of coverage. */
  forceRelease: boolean;
  tenantId?: string | null;
  alsoClaimCohort: boolean;
  /** Report what would move/unlink without writing — Mission Control / sweep dry-run. */
  dryRun?: boolean;
}): Promise<RehomeResult> {
  const { lecturerId, next, forceRelease, tenantId, alsoClaimCohort, dryRun = false } = input;
  const result: RehomeResult = { moved: 0, unlinked: 0 };
  const { onlineBranchId, lecturers, assignmentByLecturer, statusByLecturer } =
    await loadActiveLecturers(tenantId);

  const named = await prisma.student.findMany({
    where: {
      status: "active",
      OR: [{ tutorId: lecturerId }, { coTutors: { some: { lecturerId } } }],
    },
    select: STUDENT_SELECT,
    take: 1500,
  });

  for (const student of named as NamedStudent[]) {
    const covered = forceRelease ? false : assignmentCoversAnySeat(next, student, onlineBranchId);
    // Force-release (deactivation) moves private students too — a one-to-one
    // tutor who left cannot keep the pairing. Ordinary class changes still
    // leave private pairings alone via namedGroupLinkIsStale.
    if (
      !forceRelease &&
      !namedGroupLinkIsStale({ classType: student.classType, coveredByAssignment: covered })
    ) {
      continue;
    }

    if (student.tutorId === lecturerId) {
      // Prefer an active co-tutor who already covers them (Amaka was often
      // linked beside Adenike) before searching the whole school.
      const coTutorReplacement = student.coTutors
        .map((row) => row.lecturerId)
        .find((id) => {
          if (id === lecturerId) return false;
          const match = lecturers.find((lecturer) => lecturer.id === id);
          return match ? assignmentCoversAnySeat(match.assignment, student, onlineBranchId) : false;
        });
      const replacement =
        coTutorReplacement ?? pickReplacementLecturerId(student, lecturers, onlineBranchId, lecturerId);
      if (dryRun) {
        if (replacement) result.moved += 1;
        else result.unlinked += 1;
        continue;
      }
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

    if (dryRun) {
      result.unlinked += 1;
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

  if (!alsoClaimCohort || !isAssigned(next)) return result;

  const cohortWhere = studentWhereForLecturer(next, lecturerId);
  if (!cohortWhere) return result;

  const cohort = await prisma.student.findMany({
    where: { ...(cohortWhere as Record<string, unknown>), status: "active" } as never,
    select: STUDENT_SELECT,
    take: 1500,
  });

  for (const student of cohort as NamedStudent[]) {
    if (!assignmentCoversAnySeat(next, student, onlineBranchId)) continue;
    if (!student.tutorId || student.tutorId === lecturerId) continue;

    const previousAssignment = assignmentByLecturer.get(student.tutorId);
    // Do not steal from another active tutor who still covers this student.
    // An inactive / cleared previous tutor does not count as covering.
    if (
      previousAssignment &&
      lecturerKeepsNamedStudents(statusByLecturer.get(student.tutorId)) &&
      assignmentCoversAnySeat(previousAssignment, student, onlineBranchId)
    ) {
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

export async function rehomeStudentsAfterTutorAssignmentChange(input: {
  lecturerId: string;
  previous: LecturerAssignment;
  next: LecturerAssignment;
  tenantId?: string | null;
}): Promise<RehomeResult> {
  const lecturer = await prisma.lecturer.findUnique({
    where: { id: input.lecturerId },
    select: { status: true },
  });
  const forceRelease = !lecturerKeepsNamedStudents(lecturer?.status);

  return rehomeNamedStudentsOfLecturer({
    lecturerId: input.lecturerId,
    next: input.next,
    forceRelease,
    tenantId: input.tenantId,
    alsoClaimCohort: !forceRelease,
  });
}

/**
 * When a tutor is deactivated, every student named onto them must move to the
 * active tutor teaching the same course, batch and level — otherwise profiles
 * keep showing the left tutor while their card reads "0 students", and those
 * students cannot join a live class.
 */
export async function rehomeStudentsAfterTutorDeactivation(input: {
  lecturerId: string;
  tenantId?: string | null;
}): Promise<RehomeResult> {
  const row = await prisma.lecturer.findUnique({
    where: { id: input.lecturerId },
    select: LECTURER_ASSIGNMENT_SELECT,
  });
  if (!row) return { moved: 0, unlinked: 0 };

  return rehomeNamedStudentsOfLecturer({
    lecturerId: input.lecturerId,
    next: readAssignment(row),
    forceRelease: true,
    tenantId: input.tenantId,
    alsoClaimCohort: false,
  });
}

/**
 * Drop group-student links a tutor's class no longer covers, and point each
 * of those students at the tutor who does.
 *
 * The admin tutor card, the tutor's own student list and the student file all
 * read `Student.tutorId`. A class that was cleared — or a tutor marked
 * inactive — used to leave that column behind, so a tutor with nobody left
 * still read "12 students" (or "0" while profiles still named them). Called
 * before those reads so the number they show is the number of students who
 * are actually still with that tutor.
 *
 * Private pairings are left alone — see `namedGroupLinkIsStale`.
 */
export async function releaseStaleNamedStudents(input: {
  lecturerId?: string;
  tenantId?: string | null;
  /** Report what would move/unlink without writing — Mission Control / sweep dry-run. */
  dryRun?: boolean;
} = {}): Promise<RehomeResult> {
  // Stamp null-tenant co-tutor rows from their student so tenant-scoped admin
  // screens and deletes can see them. Cheap, idempotent, skipped on dry-run.
  if (!input.dryRun) {
    const orphans = await prisma.studentCoTutor.findMany({
      where: { tenantId: null },
      select: { id: true, student: { select: { tenantId: true } } },
      take: 2000,
    });
    for (const row of orphans) {
      if (!row.student.tenantId) continue;
      await prisma.studentCoTutor.update({
        where: { id: row.id },
        data: { tenantId: row.student.tenantId },
      });
    }
  }

  const lecturers = await prisma.lecturer.findMany({
    where: {
      deletedAt: null,
      ...(input.tenantId ? { tenantId: input.tenantId } : {}),
      ...(input.lecturerId ? { id: input.lecturerId } : {}),
    },
    select: { id: true, status: true },
  });

  const result: RehomeResult = { moved: 0, unlinked: 0 };
  for (const lecturer of lecturers) {
    const row = await prisma.lecturer.findUnique({
      where: { id: lecturer.id },
      select: LECTURER_ASSIGNMENT_SELECT,
    });
    if (!row) continue;
    const assignment = readAssignment(row);
    const forceRelease = !lecturerKeepsNamedStudents(lecturer.status);
    const part = await rehomeNamedStudentsOfLecturer({
      lecturerId: lecturer.id,
      next: assignment,
      forceRelease,
      tenantId: input.tenantId,
      // Do not claim a cohort while sweeping every tutor — that would race
      // between two tutors who share a sitting. Cohort claim only runs on the
      // explicit assignment-change path above.
      alsoClaimCohort: false,
      dryRun: input.dryRun,
    });
    result.moved += part.moved;
    result.unlinked += part.unlinked;
  }
  return result;
}

/**
 * Repair one student's named tutors — used on the student dashboard and live
 * poll so stuck Adenike-style links do not wait for an admin page load.
 *
 * - Inactive primary → move to covering co-tutor, else newest matching tutor
 * - Co-tutor rows on inactive tutors → dropped
 */
export async function repairStudentNamedTutors(studentId: string): Promise<RehomeResult> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      ...STUDENT_SELECT,
      status: true,
      tenantId: true,
      tutor: { select: { status: true } },
    },
  });
  if (!student || student.status !== "active") return { moved: 0, unlinked: 0 };

  const result: RehomeResult = { moved: 0, unlinked: 0 };
  const { onlineBranchId, lecturers, statusByLecturer } = await loadActiveLecturers(student.tenantId);
  const named = student as NamedStudent;

  const activeCoTutorIds = named.coTutors
    .map((row) => row.lecturerId)
    .filter((id) => lecturerKeepsNamedStudents(statusByLecturer.get(id)));

  if (activeCoTutorIds.length !== named.coTutors.length) {
    const dropped = await setStudentCoTutors({
      studentId,
      lecturerIds: activeCoTutorIds,
      quiet: true,
    });
    if (dropped.ok && dropped.changed) {
      result.unlinked += named.coTutors.length - activeCoTutorIds.length;
    }
  }

  if (!named.tutorId || lecturerKeepsNamedStudents(student.tutor?.status)) {
    return result;
  }

  const coTutorReplacement = activeCoTutorIds.find((id) => {
    const match = lecturers.find((lecturer) => lecturer.id === id);
    return match ? assignmentCoversAnySeat(match.assignment, named, onlineBranchId) : false;
  });
  const replacement =
    coTutorReplacement ?? pickReplacementLecturerId(named, lecturers, onlineBranchId, named.tutorId);

  const paired = await setStudentTutor({
    studentId,
    lecturerId: replacement,
    quiet: true,
  });
  if (paired.ok && paired.changed) {
    if (replacement) result.moved += 1;
    else result.unlinked += 1;
  }
  return result;
}
