import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { StudyNote } from "@/lib/material-ai";

export const dynamic = "force-dynamic";

/**
 * One ready-made note, for the reader page. Scoped exactly like the list
 * (`/api/student/study-notes`): the student's level, a course at their level,
 * or a private class booked for them — and only once the tutor has signed off
 * the AI output (`questsReviewedAt`).
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: { id: true, level: true },
  });
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });

  const material = await prisma.material.findFirst({
    where: {
      id,
      aiState: "ready",
      questsReviewedAt: { not: null },
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
      aiNotes: true,
      aiSummary: true,
      aiUpdatedAt: true,
      course: { select: { level: true, title: true } },
    },
  });

  const note = material?.aiNotes as StudyNote | null;
  if (!material || !note || !note.overview) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    materialId: material.id,
    title: material.title,
    level: material.level ?? material.course?.level ?? null,
    courseTitle: material.course?.title ?? null,
    summary: material.aiSummary,
    note,
    updatedAt: material.aiUpdatedAt,
  });
}
