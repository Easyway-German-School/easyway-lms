import { prisma } from "@/lib/prisma";
import { previousLevelBefore } from "@/lib/next-level-journey";
import { studentSeesBatch } from "@/lib/class-batch";
import { notExpiredForStudents } from "@/lib/retention";

export async function loadPreviousLevelPreview(input: {
  studentId: string;
  level: string;
  branchId: string | null;
  sessionSlot: string;
  videoOnly?: boolean;
}) {
  const level = previousLevelBefore(input.level);
  if (!level) return null;

  const enrolment = await prisma.studentEnrolment.findFirst({
    where: { studentId: input.studentId, level, outcome: "completed", deletedAt: null },
    orderBy: { endedAt: "desc" },
    select: { batchMonth: true },
  });
  const records = await prisma.material.findMany({
    where: {
      AND: [
        { OR: [{ level }, { course: { level } }] },
        ...(input.videoOnly ? [{ kind: { in: ["video", "recording"] } }] : []),
        { OR: [{ branchId: null }, { branchId: input.branchId }] },
        { OR: [{ sessionSlot: null }, { sessionSlot: input.sessionSlot }] },
        { visibleToStudents: true },
        notExpiredForStudents(),
      ],
    },
    include: {
      course: { select: { title: true, level: true } },
      lecturer: { select: { id: true, user: { select: { name: true, email: true } } } },
      recording: { select: { privateClassId: true, studentExpiresAt: true, keepForever: true } },
    },
    orderBy: [{ recordedAt: "desc" }, { createdAt: "desc" }],
  });
  const matching = records.filter((record) => studentSeesBatch(record.batch, { batch: enrolment?.batchMonth ?? null }));
  return { level, total: matching.length, materials: matching.slice(0, 3) };
}
