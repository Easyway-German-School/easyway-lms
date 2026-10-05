import { prisma } from "@/lib/prisma";
import {
  belongsToLecturer,
  readAssignment,
  studentWhereForLecturer,
  teachingGroups,
  type GroupRosterStudent,
  type TeachingGroup,
} from "@/lib/lecturer-assignment";

/**
 * A tutor's classes, split by batch, from nothing but the tutor.
 *
 * `teachingGroups` needs the tutor's students to know which batches they really
 * have (September AND October, say), and several routes need the classes without
 * otherwise loading a roster — the live-state poll that runs every ten seconds on
 * an open dashboard, the "go live" chooser. This is the cheapest honest way to
 * give them that: four columns and the batch, through the SAME clause every other
 * roster uses (`studentWhereForLecturer` + `belongsToLecturer`), so a class here
 * can never disagree with the roster it opens.
 */
export async function tutorRosterForGroups(
  lecturer: Parameters<typeof readAssignment>[0] & { id: string },
): Promise<GroupRosterStudent[]> {
  const assignment = readAssignment(lecturer);
  const where = studentWhereForLecturer(assignment, lecturer.id);
  if (!where) return [];

  const rows = await prisma.student.findMany({
    where: { ...(where as Record<string, unknown>), status: "active" } as never,
    select: {
      branchId: true,
      level: true,
      sessionSlot: true,
      admission: true,
      tutorId: true,
      coTutors: { select: { lecturerId: true } },
    },
  });
  return rows.filter((student) => belongsToLecturer(assignment, lecturer.id, student));
}

export async function tutorTeachingGroups(
  lecturer: Parameters<typeof readAssignment>[0] & { id: string },
  branchNames: Map<string, string>,
): Promise<TeachingGroup[]> {
  const assignment = readAssignment(lecturer);
  const roster = await tutorRosterForGroups(lecturer);
  return teachingGroups(assignment, branchNames, lecturer.id, roster);
}
