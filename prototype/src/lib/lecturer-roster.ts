import { prisma } from "@/lib/prisma";
import {
  belongsToLecturer,
  isAssigned,
  readAssignment,
  studentWhereForLecturer,
} from "@/lib/lecturer-assignment";

/**
 * Who a tutor's students are.
 *
 * This was written twice — once inside the mark-entry route and once inside
 * the gradebook — and two copies of "which students belong to this tutor" is
 * exactly the kind of duplication that ends with a gradebook showing a
 * different class from the register. There is one answer and it lives here.
 *
 * The admin decides, by either of the two routes in
 * `studentWhereForLecturer` — the class assignment, or naming a student on
 * this tutor. A tutor cannot widen their own roster by any route, because
 * nothing they can send reaches this query.
 */

export type RosterStudent = {
  id: string;
  userId: string;
  name: string;
  email: string;
  studentCode: string | null;
  level: string;
  sessionSlot: string;
  branchId: string | null;
  /**
   * True when the office put this student on this tutor by name rather than
   * the student falling into their class. Worth showing: it is the difference
   * between "my A2 morning group" and "the one student I was asked to cover",
   * and a tutor who cannot tell them apart will wonder why a stranger is on
   * their register.
   */
  namedByOffice: boolean;
};

export type Roster =
  | { ok: true; lecturerId: string; students: RosterStudent[] }
  | { ok: false; reason: "no-profile" | "unassigned" };

export const UNASSIGNED_MESSAGE =
  "You have not been assigned a class yet. The school office sets this.";

/**
 * What a tutor can be marking, and how heavily each one counts, now lives in
 * `lib/grading.ts` alongside the pass mark and the letter scale — the results
 * page and the certificate need the same numbers, and they cannot import a
 * lecturer-only module. Re-exported here so the mark-entry routes that already
 * import from this file keep working.
 */
export {
  ASSESSMENT_TYPES,
  REQUIRED_ASSESSMENT_TYPES,
  OPTIONAL_ASSESSMENT_TYPES,
  ASSESSMENT_WEIGHTS,
  isAssessmentType,
  isRequiredAssessmentType,
  weightFor,
  weightedCourseworkAverage,
  type AssessmentType,
} from "@/lib/grading";

export async function resolveRoster(userId: string): Promise<Roster> {
  const lecturer = await prisma.lecturer.findUnique({ where: { userId } });
  if (!lecturer) return { ok: false, reason: "no-profile" };

  const assignment = readAssignment(lecturer);
  const where = studentWhereForLecturer(assignment, lecturer.id);
  if (!where) return { ok: false, reason: "unassigned" };

  const rows = await prisma.student.findMany({
    where: { ...(where as Record<string, unknown>), status: "active" } as never,
    select: {
      id: true,
      userId: true,
      level: true,
      sessionSlot: true,
      studentCode: true,
      branchId: true,
      admission: true,
      tutorId: true,
      user: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Batch lives in the admission JSON blob, which cannot be filtered in the
  // query, so it is applied here — and skipped for anybody named directly.
  const students = rows
    .filter((row) => belongsToLecturer(assignment, lecturer.id, row))
    .map((row) => ({
      id: row.id,
      userId: row.userId,
      name: row.user.name || row.user.email,
      email: row.user.email,
      studentCode: row.studentCode,
      level: row.level,
      sessionSlot: row.sessionSlot,
      branchId: row.branchId,
      namedByOffice: row.tutorId === lecturer.id,
    }));

  /**
   * "Unassigned" means the office has told this tutor nothing at all — no
   * class AND nobody by name. A tutor who was given one named student has an
   * assignment in every sense that matters, and telling them to go and ask the
   * office for one would send them to argue about a thing they already have.
   */
  if (!students.length && !isAssigned(assignment)) return { ok: false, reason: "unassigned" };

  return { ok: true, lecturerId: lecturer.id, students };
}
