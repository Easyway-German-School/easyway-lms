import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { analyzePronunciation } from "@/lib/ai";
import { requireAuthSession } from "@/lib/auth";
import { reserveStudentAiRequest } from "@/lib/ai-limits";
import { recordSkillOutcome } from "@/lib/skill-mastery";
import { getCoachingMemorySummary, saveVoiceCoachMemory } from "@/lib/voice-coach-memory";

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { phrase, expectedPhrase } = body;

    if (!phrase || phrase.trim().length < 3) {
      return NextResponse.json(
        { error: "Phrase must be at least 3 characters" },
        { status: 400 }
      );
    }

    const quota = await reserveStudentAiRequest(session.user.id, "pronunciation");
    if (!quota.allowed) {
      return NextResponse.json({ error: "Daily pronunciation limit reached. Try again tomorrow." }, { status: 429 });
    }

    const student = await prismaStudentForSession(session.user.id);
    const coachingMemory = student ? await getCoachingMemorySummary(student.id) : null;
    const result = await analyzePronunciation(phrase, typeof expectedPhrase === "string" ? expectedPhrase : phrase, null, null, coachingMemory);

    let masteryBefore: number | null = null;
    let masteryAfter: number | null = null;
    if (student) {
      const { prisma } = await import("@/lib/prisma");
      const before = await prisma.studentSkillMastery.findUnique({
        where: { studentId_skill: { studentId: student.id, skill: "speaking" } },
        select: { mastery: true },
      });
      masteryBefore = before?.mastery ?? null;

      await recordSkillOutcome({ studentId: student.id, skill: "speaking", score: result.confidence });
      await saveVoiceCoachMemory(student.id, typeof expectedPhrase === "string" ? expectedPhrase : phrase, result);

      const after = await prisma.studentSkillMastery.findUnique({
        where: { studentId_skill: { studentId: student.id, skill: "speaking" } },
        select: { mastery: true },
      });
      masteryAfter = after?.mastery ?? null;
    }

    return NextResponse.json({ ...result, masteryBefore, masteryAfter });
  } catch (error) {
    console.error("Pronunciation analysis error:", error);
    return NextResponse.json(
      { error: "Failed to analyze pronunciation" },
      { status: 500 }
    );
  }
}

async function prismaStudentForSession(userId: string) {
  const { prisma } = await import("@/lib/prisma");
  return prisma.student.findUnique({ where: { userId }, select: { id: true } });
}
