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
 */
export function assignmentVisibleToWhere(student: {
  id: string;
  level: string;
  branchId: string | null;
  sessionSlot: string | null;
}) {
  return {
    published: true,
    level: student.level,
    AND: [
      // Branch-specific assignments plus school-wide ones.
      { OR: [{ branchId: student.branchId }, { branchId: null }] },
      // This sitting's work plus anything set for the whole level.
      { OR: [{ sessionSlot: student.sessionSlot }, { sessionSlot: null }] },
      // Untargeted (everyone) or targeted at me.
      { OR: [{ targets: { none: {} } }, { targets: { some: { studentId: student.id } } }] },
    ],
  };
}
