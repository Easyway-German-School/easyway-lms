import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { MaterialQuest } from "@/lib/material-ai";

/**
 * The student's own verdict on their attempt — "Got it" or "Not quite" —
 * after they've already seen the stored answer via the reveal endpoint.
 * Upserts on (studentId, materialId, questIndex), so marking it again just
 * flips `correct`; XP (see /api/student/gamification) counts `correct: true`
 * rows, so a later "actually, I did get it" still pays out.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; index: string }> }) {
  const { id, index } = await params;
  const questIndex = Number(index);
  if (!Number.isInteger(questIndex) || questIndex < 0) {
    return NextResponse.json({ error: "Invalid quest index" }, { status: 400 });
  }

  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({ where: { userId: session.user.id }, select: { id: true } });
  if (!student) return NextResponse.json({ error: "Student profile not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const correct = body.correct === true;

  const material = await prisma.material.findUnique({
    where: { id },
    select: { aiQuests: true, questsReviewedAt: true },
  });
  if (!material || !material.questsReviewedAt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const quest = ((material.aiQuests as unknown as MaterialQuest[] | null) ?? [])[questIndex];
  if (!quest) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.materialQuestAttempt.upsert({
    where: { studentId_materialId_questIndex: { studentId: student.id, materialId: id, questIndex } },
    update: { correct },
    create: { studentId: student.id, materialId: id, questIndex, correct },
  });

  return NextResponse.json({ correct });
}
