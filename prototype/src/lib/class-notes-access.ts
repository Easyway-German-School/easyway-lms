import { prisma } from "@/lib/prisma";

/**
 * The one access check every class-notes route needs, in one place rather
 * than copied three times with room for one copy to drift.
 *
 * A group recording is visible to a student by level, same as the video
 * library itself. A PRIVATE recording is never visible by level — its
 * `Material.level` is deliberately left null at creation (see
 * class-recorder.ts) specifically so a level-based query cannot surface it —
 * and is instead scoped through the `privateClasses` relation to the one
 * student it was actually booked for. Both checks run as a single query
 * rather than "fetch then compare in code", so there is no path where the
 * fetch succeeds and a later check is forgotten.
 */
export async function findOwnedRecordingMaterial(materialId: string, student: { id: string; level: string }) {
  return prisma.material.findFirst({
    where: {
      id: materialId,
      OR: [
        { level: student.level },
        { course: { level: student.level } },
        { privateClasses: { some: { studentId: student.id } } },
      ],
    },
    select: {
      id: true,
      title: true,
      level: true,
      recordedAt: true,
      course: { select: { level: true } },
      recording: { select: { privateClassId: true, transcript: true } },
    },
  });
}

export type OwnedRecordingMaterial = NonNullable<Awaited<ReturnType<typeof findOwnedRecordingMaterial>>>;
