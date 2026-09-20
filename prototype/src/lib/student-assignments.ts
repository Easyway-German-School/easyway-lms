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
 * targets narrows it to exactly those students.
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

type VisibilityStudent = {
  id: string;
  level: string;
  branchId: string | null;
  sessionSlot: string | null;
  deliveryMode?: string | null;
  hybridOnlineSlot?: string | null;
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

export function assignmentVisibleToWhere(student: VisibilityStudent, onlineBranchId?: string | null) {
  return {
    published: true,
    level: student.level,
    AND: [
      sittingMatch(student, onlineBranchId),
      // Untargeted (everyone) or targeted at me.
      { OR: [{ targets: { none: {} } }, { targets: { some: { studentId: student.id } } }] },
    ],
  };
}

/**
 * The reverse question: given an assignment (as just created — its level,
 * branch and sitting), which students can see it? Used to notify the actual
 * audience directly by id instead of the same loose `branchId`/`sessionSlot`
 * filter `notify()`'s generic `students` target uses — which, being shared
 * by announcements that must stay campus-only or online-only, cannot itself
 * learn the hybrid-online exception without breaking those.
 */
export function studentsVisibleToAssignment(
  assignment: { level: string; branchId: string | null; sessionSlot: string | null },
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

  if (!onlineBranchId || assignment.branchId !== onlineBranchId) {
    // Campus-scoped (or school-wide) assignment. A hybrid student already
    // matches through this same clause — `branchId`/`sessionSlot` on their
    // row ARE their campus side, so no hybrid-specific handling is needed
    // for anything that isn't actually scoped to the Online branch.
    return { status: "active", level: assignment.level, ...campusMatch };
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

  return {
    status: "active",
    level: assignment.level,
    OR: [onlineOnlyMatch, hybridOnlineMatch],
  };
}
