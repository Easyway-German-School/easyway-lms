/**
 * Which assignments a student may see — the one rule shared by the student
 * assignments list (/api/student/assignments) and anything else that needs
 * to ask the same question, such as the "you can submit assignments now"
 * nudge in assignment-availability-nudge.ts. Kept in one place so the two
 * cannot drift: a nudge that used a looser rule than the list itself could
 * tell a student to go look at work they still would not be shown.
 *
 * Two conditions live in an explicit AND rather than as sibling keys, because
 * a second top-level `OR` would overwrite the first and quietly widen the
 * query to every branch in the school.
 *
 * The targeting rule: an assignment with NO targets goes to the whole level,
 * which is how every assignment behaved before targeting existed. One or more
 * targets used to be the only other way in, which is how a student in the
 * right level, batch and tutor silently saw nothing: batch-scoped creates
 * froze the current roster as named targets, and anyone the snapshot missed
 * (joined later, intake stored as "September 2026" instead of "September")
 * matched neither hole. Their own tutor's homework for this class is now a
 * third path, still sitting-scoped, still batch-scoped when the assignment
 * names a month.
 *
 * The sitting works the same way as the branch: NULL means every sitting, so
 * nothing set before sessions became a boundary changes who it reaches. It
 * matters because one branch runs the same level three times a day under three
 * different tutors, and homework from the morning lesson appearing on the
 * evening class's dashboard is work they were never given.
 *
 * HYBRID STUDENTS HAVE TWO SITTINGS. `branchId`/`sessionSlot` on the student
 * row are their CAMPUS side — an online tutor's assignment, scoped to the
 * Online branch and the student's `hybridOnlineSlot`, could never match a
 * hybrid student through this rule alone, so their online tutor's homework
 * was invisible to them no matter how it was scoped (short of the tutor
 * targeting them by name). `onlineBranchId` adds that second path as an
 * alternative match, not a replacement — a campus assignment still needs
 * the campus match, an online one the online match.
 */

import { batchOfAdmission } from "@/lib/class-batch";

type VisibilityStudent = {
  id: string;
  level: string;
  branchId: string | null;
  sessionSlot: string | null;
  deliveryMode?: string | null;
  hybridOnlineSlot?: string | null;
  tutorId?: string | null;
  coTutorIds?: string[] | null;
  coTutors?: { lecturerId: string }[] | null;
  admission?: unknown;
};

function sittingMatch(student: VisibilityStudent, onlineBranchId: string | null | undefined) {
  const campusMatch = {
    AND: [
      { OR: [{ branchId: student.branchId }, { branchId: null }] },
      { OR: [{ sessionSlot: student.sessionSlot }, { sessionSlot: null }] },
    ],
  };

  if (student.deliveryMode !== "hybrid" || !student.hybridOnlineSlot || !onlineBranchId) {
    return campusMatch;
  }

  const onlineMatch = {
    AND: [{ branchId: onlineBranchId }, { OR: [{ sessionSlot: student.hybridOnlineSlot }, { sessionSlot: null }] }],
  };

  return { OR: [campusMatch, onlineMatch] };
}

function tutorIdsOf(student: VisibilityStudent): string[] {
  const ids = [
    student.tutorId,
    ...(student.coTutorIds ?? []),
    ...(student.coTutors ?? []).map((row) => row.lecturerId),
  ].filter((id): id is string => Boolean(id));
  return [...new Set(ids)];
}

export function assignmentVisibleToWhere(student: VisibilityStudent, onlineBranchId?: string | null) {
  const tutorIds = tutorIdsOf(student);
  const studentBatch = batchOfAdmission(student.admission) || null;
  const classMatch = [{ level: student.level }, sittingMatch(student, onlineBranchId)];

  const audience: Record<string, unknown>[] = [
    {
      AND: [...classMatch, { targets: { none: {} } }],
    },
    { targets: { some: { studentId: student.id } } },
  ];

  if (tutorIds.length) {
    audience.push({
      AND: [
        ...classMatch,
        { lecturerId: { in: tutorIds } },
        studentBatch ? { OR: [{ batch: null }, { batch: studentBatch }] } : { batch: null },
      ],
    });
  }

  return {
    published: true,
    AND: [{ OR: audience }],
  };
}

/**
 * The reverse question: given an assignment (as just created — its level,
 * branch and sitting), which students can see it? Used to notify the actual
 * audience directly by id instead of the same loose `branchId`/`sessionSlot`
 * filter `notify()`'s generic `students` target uses — which, being shared
 * by announcements that must stay campus-only or online-only, cannot itself
 * learn the hybrid-online exception without breaking those.
 *
 * When the assignment has a named tutor, the audience is that tutor's
 * students (primary or co-tutor), not every student at the sitting.
 */
export function studentsVisibleToAssignment(
  assignment: {
    level: string;
    branchId: string | null;
    sessionSlot: string | null;
    lecturerId?: string | null;
  },
  onlineBranchId: string | null | undefined,
) {
  // `assignment.branchId`/`sessionSlot` are fixed values here (this is the
  // reverse of assignmentVisibleToWhere) — null means "every branch"/"every
  // sitting" on the ASSIGNMENT's side, so it drops out of the where entirely
  // rather than becoming an `OR branchId: null` (that would ask for students
  // with no branch, which is a different, much rarer thing).
  const campusMatch = {
    ...(assignment.branchId === null ? {} : { branchId: assignment.branchId }),
    ...(assignment.sessionSlot === null ? {} : { sessionSlot: assignment.sessionSlot }),
  };

  const taughtBy = assignment.lecturerId
    ? {
        OR: [
          { tutorId: assignment.lecturerId },
          { coTutors: { some: { lecturerId: assignment.lecturerId } } },
        ],
      }
    : null;

  if (!onlineBranchId || assignment.branchId !== onlineBranchId) {
    // Campus-scoped (or school-wide) assignment. A hybrid student already
    // matches through this same clause — `branchId`/`sessionSlot` on their
    // row ARE their campus side, so no hybrid-specific handling is needed
    // for anything that isn't actually scoped to the Online branch.
    return {
      status: "active",
      level: assignment.level,
      ...campusMatch,
      ...(taughtBy ? { AND: [taughtBy] } : {}),
    };
  }

  // Scoped to the Online branch: reach online-only students through their
  // own branchId, and hybrid students through `hybridOnlineSlot` instead —
  // their `branchId` is their campus branch, not Online, so they'd never
  // match campusMatch for an assignment scoped this way.
  const onlineOnlyMatch = {
    branchId: onlineBranchId,
    ...(assignment.sessionSlot === null ? {} : { sessionSlot: assignment.sessionSlot }),
  };
  const hybridOnlineMatch = {
    deliveryMode: "hybrid",
    ...(assignment.sessionSlot === null ? {} : { hybridOnlineSlot: assignment.sessionSlot }),
  };

  const sittingAudience = { OR: [onlineOnlyMatch, hybridOnlineMatch] };

  return {
    status: "active",
    level: assignment.level,
    ...(taughtBy ? { AND: [sittingAudience, taughtBy] } : sittingAudience),
  };
}
