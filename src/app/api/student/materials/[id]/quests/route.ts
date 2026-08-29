import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { MaterialQuest } from "@/lib/material-ai";

export const dynamic = "force-dynamic";

/**
 * The quest list for one material — never the `answer` field. That is only
 * ever sent from the `reveal` endpoint, after the student has actually tried,
 * so a network tab can't spoil it any earlier than the UI does.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({ where: { userId: session.user.id }, select: { id: true } });
  if (!student) return NextResponse.json({ error: "Student profile not found" }, { status: 404 });

  const material = await prisma.material.findUnique({
    where: { id },
    select: { aiQuests: true, questsReviewedAt: true },
  });
  if (!material || !material.questsReviewedAt) {
    return NextResponse.json({ quests: [] });
  }

  const attempts = await prisma.materialQuestAttempt.findMany({
    where: { studentId: student.id, materialId: id },
    select: { questIndex: true, correct: true },
  });
  const attemptByIndex = new Map(attempts.map((attempt) => [attempt.questIndex, attempt.correct]));

  const quests = ((material.aiQuests as unknown as MaterialQuest[] | null) ?? []).map((quest, index) => ({
    index,
    title: quest.title,
    task: quest.task,
    xp: quest.xp,
    correct: attemptByIndex.get(index) ?? null,
  }));

  return NextResponse.json({ quests });
}
