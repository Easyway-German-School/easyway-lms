import { prisma } from "@/lib/prisma";
import {
  belongsToLecturer,
  isAssigned,
  matchesBatch,
  readAssignment,
  studentWhereForLecturer,
  type LecturerAssignment,
} from "@/lib/lecturer-assignment";

/**
 * Who a material is for — one answer, shared by every side that needs it.
 *
 * A material reaches people two ways:
 *   - a tutor uploaded it (or the office aimed it at one tutor by name):
 *     `lecturerId` is set, and it goes to that tutor and their roster.
 *   - the office aimed it at a cohort: `lecturerId` is null but `uploadedBy` is
 *     set, and a level + optional branch / sitting / batch describe the class.
 *     It goes to every assigned tutor whose class the cohort falls inside, and
 *     to the students in it when `visibleToStudents`.
 *
 * The tutor portal's material list, the AI "quests ready to review" nudge, the
 * "quests are live" nudge to students, and the office upload announcement all
 * read audience through here so they can never drift apart.
 */

export type MaterialAudienceRow = {
  id: string;
  level: string | null;
  branchId: string | null;
  sessionSlot: string | null;
  batch: string | null;
  visibleToStudents: boolean;
  lecturerId: string | null;
  uploadedBy: string | null;
  course?: { level: string | null } | null;
};

/** The Prisma `select` that produces a `MaterialAudienceRow`. */
export const MATERIAL_AUDIENCE_SELECT = {
  id: true,
  level: true,
  branchId: true,
  sessionSlot: true,
  batch: true,
  visibleToStudents: true,
  lecturerId: true,
  uploadedBy: true,
  course: { select: { level: true } },
} as const;

/** An office cohort upload: no owning tutor, but an admin put it there. */
export function isOfficeCohortUpload(material: MaterialAudienceRow): boolean {
  return !material.lecturerId && Boolean(material.uploadedBy);
}

function effectiveLevel(material: MaterialAudienceRow): string | null {
  return material.level ?? material.course?.level ?? null;
}

/**
 * Does an office cohort upload fall inside a tutor's assignment?
 *
 * Same "empty list on the assignment side means no restriction" rule the
 * roster uses — a tutor with no sitting chosen still covers an office upload
 * for any sitting at their level and branch.
 */
export function cohortMatchesAssignment(
  material: MaterialAudienceRow,
  assignment: LecturerAssignment,
): boolean {
  if (!isAssigned(assignment)) return false;

  const level = effectiveLevel(material);
  if (
    level &&
    assignment.levels.length &&
    !assignment.levels.map((value) => value.toUpperCase()).includes(level.toUpperCase())
  ) {
    return false;
  }
  if (material.branchId && assignment.branchIds.length && !assignment.branchIds.includes(material.branchId)) {
    return false;
  }
  if (
    material.sessionSlot &&
    assignment.sessionSlots.length &&
    !assignment.sessionSlots.map((slot) => slot.toLowerCase()).includes(material.sessionSlot.toLowerCase())
  ) {
    return false;
  }
  if (
    material.batch &&
    assignment.batches.length &&
    !assignment.batches.map((batch) => batch.toLowerCase()).includes(material.batch.toLowerCase())
  ) {
    return false;
  }
  return true;
}

/** Can this tutor review the AI output (quests / notes) for this material? */
export async function tutorMayReviewMaterial(
  material: MaterialAudienceRow,
  lecturerId: string,
): Promise<boolean> {
  if (material.lecturerId && material.lecturerId === lecturerId) return true;
  if (!isOfficeCohortUpload(material)) return false;

  const lecturer = await prisma.lecturer.findUnique({ where: { id: lecturerId } });
  if (!lecturer) return false;
  return cohortMatchesAssignment(material, readAssignment(lecturer));
}

/** User ids of every tutor who should hear about this material. */
export async function tutorUserIdsForMaterial(material: MaterialAudienceRow): Promise<string[]> {
  if (material.lecturerId) {
    const lecturer = await prisma.lecturer.findUnique({
      where: { id: material.lecturerId },
      select: { userId: true },
    });
    return lecturer?.userId ? [lecturer.userId] : [];
  }
  if (!isOfficeCohortUpload(material)) return [];

  const lecturers = await prisma.lecturer.findMany({
    where: { status: { not: "inactive" } },
    select: {
      id: true,
      userId: true,
      branchId: true,
      level: true,
      sessionSlot: true,
      branchIds: true,
      levels: true,
      sessionSlots: true,
      assignmentGroups: true,
      classTypes: true,
      batches: true,
    },
  });

  const ids = new Set<string>();
  for (const lecturer of lecturers) {
    if (!lecturer.userId) continue;
    if (cohortMatchesAssignment(material, readAssignment(lecturer))) ids.add(lecturer.userId);
  }
  return [...ids];
}

/**
 * Student ids this material should reach — the tutor's roster for a tutor
 * upload, the described cohort for an office one, and [] when it is staff-only.
 */
export async function studentIdsForMaterial(material: MaterialAudienceRow): Promise<string[]> {
  if (!material.visibleToStudents) return [];

  // A tutor's own (or by-name) upload: their roster, the same set the initial
  // "new material" notification went to.
  if (material.lecturerId) {
    const lecturer = await prisma.lecturer.findUnique({ where: { id: material.lecturerId } });
    if (!lecturer) return [];
    const assignment = readAssignment(lecturer);
    const where = studentWhereForLecturer(assignment, material.lecturerId);
    if (!where) return [];
    const rows = await prisma.student.findMany({
      where: where as never,
      select: { id: true, admission: true, tutorId: true },
    });
    return rows
      .filter((student) => belongsToLecturer(assignment, material.lecturerId, student))
      .map((student) => student.id);
  }

  // An office cohort upload.
  const level = effectiveLevel(material);
  if (!isOfficeCohortUpload(material) || !level) return [];

  const where: Record<string, unknown> = { level, deletedAt: null };
  if (material.branchId) where.branchId = material.branchId;
  if (material.sessionSlot) where.sessionSlot = material.sessionSlot;

  const students = await prisma.student.findMany({
    where: where as never,
    select: { id: true, admission: true },
  });
  return students
    .filter((student) =>
      material.batch
        ? matchesBatch({ batches: [material.batch] } as unknown as LecturerAssignment, student.admission)
        : true,
    )
    .map((student) => student.id);
}
