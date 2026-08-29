import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { MaterialQuest } from "@/lib/material-ai";

/**
 * Hands back the stored answer for one quest — the "show me" tap, after the
 * student has already attempted it themselves. A pure read: revealing an
 * answer is not the same as marking it, so this never touches
 * MaterialQuestAttempt.
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

  const material = await prisma.material.findUnique({
    where: { id },
    select: { aiQuests: true, questsReviewedAt: true },
  });
  if (!material || !material.questsReviewedAt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const quest = ((material.aiQuests as unknown as MaterialQuest[] | null) ?? [])[questIndex];
  if (!quest) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ answer: quest.answer });
}
