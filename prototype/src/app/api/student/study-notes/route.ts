import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { StudyNote } from "@/lib/material-ai";

export const dynamic = "force-dynamic";

/**
 * Ready-made notes — the tutor's uploaded documents, written up.
 *
 * When a tutor uploads a handout to the lesson builder, `material-ai.ts`
 * summarises it into a study note (`Material.aiNotes`). A student sees it here
 * only once the tutor has signed off the AI output (`questsReviewedAt`), the
 * same gate the quests pass through — the model's output never reaches a
 * student unmoderated.
 *
 * `preparing` is how many of this student's materials are still being written
 * up (or failed), so the My Notes hub can show Becca's "still working on it"
 * line instead of silence.
 */
export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: { id: true, level: true, branchId: true, sessionSlot: true },
  });
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });

  // Every document material this student can see — level / course level / a
  // private class booked for them — then narrowed by the office targeting the
  // Materials list already honours: a branch- or sitting-specific office
  // upload, and staff-only ones, stay out. (Batch is not filtered here; it is
  // rare on a study-note handout and would break the `preparing` count below.)
  const scope = {
    kind: { notIn: ["recording", "video", "audio"] },
    visibleToStudents: true,
    AND: [
      {
        OR: [
          { level: student.level },
          { course: { level: student.level } },
          { privateClasses: { some: { studentId: student.id } } },
        ],
      },
      { OR: [{ branchId: null }, { branchId: student.branchId }] },
      { OR: [{ sessionSlot: null }, { sessionSlot: student.sessionSlot }] },
    ],
  };

  const rows = await prisma.material.findMany({
    where: { ...scope, aiState: "ready", questsReviewedAt: { not: null } },
    orderBy: [{ aiUpdatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      title: true,
      level: true,
      aiNotes: true,
      aiUpdatedAt: true,
      course: { select: { level: true } },
    },
  });

  const notes = rows
    .map((row) => {
      const note = row.aiNotes as StudyNote | null;
      if (!note || !note.overview) return null;
      return {
        materialId: row.id,
        title: row.title,
        level: row.level ?? row.course?.level ?? null,
        overviewPreview: note.overview.slice(0, 180),
        sectionCount: Array.isArray(note.sections) ? note.sections.length : 0,
        vocabularyCount: Array.isArray(note.vocabulary) ? note.vocabulary.length : 0,
        updatedAt: row.aiUpdatedAt,
      };
    })
    .filter(Boolean);

  const preparing = await prisma.material.count({
    where: {
      AND: [
        scope,
        {
          OR: [
            { aiState: { in: ["pending", "failed"] } },
            { aiState: "ready", questsReviewedAt: null },
          ],
        },
      ],
    },
  });

  return NextResponse.json({ notes, preparing });
}
