import { prisma } from "@/lib/prisma";
import {
  matchesBatch,
  readAssignment,
  studentWhereForAssignment,
} from "@/lib/lecturer-assignment";

/**
 * Who a tutor's students are.
 *
 * This was written twice — once inside the mark-entry route and once inside
 * the gradebook — and two copies of "which students belong to this tutor" is
 * exactly the kind of duplication that ends with a gradebook showing a
 * different class from the register. There is one answer and it lives here.
 *
 * The admin-set assignment is the only source. A tutor cannot widen their own
 * roster by any route, because nothing they can send reaches this query.
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
};

export type Roster =
  | { ok: true; lecturerId: string; students: RosterStudent[] }
  | { ok: false; reason: "no-profile" | "unassigned" };

export const UNASSIGNED_MESSAGE =
  "You have not been assigned a class yet. The school office sets this.";

/**
 * What a tutor can be marking, and how heavily each one counts.
 *
 * One list, because the mark-entry grid writes these strings into `Grade.type`
 * and the gradebook reads them back as its columns. When the two had their own
 * copies, a type added to one was a column of marks the other could not see.
 * Free text would make the book unsortable, so this is the whole vocabulary.
 */
export const ASSESSMENT_TYPES = [
  "classwork",
  "speaking",
  "writing",
  "listening",
  "quiz",
  "mock exam",
] as const;
export type AssessmentType = (typeof ASSESSMENT_TYPES)[number];

export const ASSESSMENT_WEIGHTS: Record<AssessmentType, number> = {
  classwork: 1,
  speaking: 1.25,
  writing: 1.25,
  listening: 1,
  quiz: 0.75,
  "mock exam": 1.75,
};

export function isAssessmentType(value: unknown): value is AssessmentType {
  return typeof value === "string" && (ASSESSMENT_TYPES as readonly string[]).includes(value);
}

export async function resolveRoster(userId: string): Promise<Roster> {
  const lecturer = await prisma.lecturer.findUnique({ where: { userId } });
  if (!lecturer) return { ok: false, reason: "no-profile" };

  const assignment = readAssignment(lecturer);
  const where = studentWhereForAssignment(assignment);
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
      user: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return {
    ok: true,
    lecturerId: lecturer.id,
    // Batch lives in the admission JSON blob, which cannot be filtered in the
    // query, so it is applied here.
    students: rows
      .filter((row) => matchesBatch(assignment, row.admission))
      .map((row) => ({
        id: row.id,
        userId: row.userId,
        name: row.user.name || row.user.email,
        email: row.user.email,
        studentCode: row.studentCode,
        level: row.level,
        sessionSlot: row.sessionSlot,
        branchId: row.branchId,
      })),
  };
}
