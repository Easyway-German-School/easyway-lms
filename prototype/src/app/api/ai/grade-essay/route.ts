import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { gradeEssay } from "@/lib/ai";
import { requireAuthSession } from "@/lib/auth";
import { reserveStudentAiRequest } from "@/lib/ai-limits";
import { recordSkillOutcome } from "@/lib/skill-mastery";

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { essay } = body;

    if (!essay || essay.trim().length < 10) {
      return NextResponse.json(
        { error: "Essay must be at least 10 characters" },
        { status: 400 }
      );
    }

    const quota = await reserveStudentAiRequest(session.user.id, "essay");
    if (!quota.allowed) {
      return NextResponse.json({ error: "Daily essay feedback limit reached. Try again tomorrow." }, { status: 429 });
    }

    const result = await gradeEssay(essay);
    const student = await prismaStudentForSession(session.user.id);

    let masteryBefore: number | null = null;
    let masteryAfter: number | null = null;
    if (student) {
      const { prisma } = await import("@/lib/prisma");
      const before = await prisma.studentSkillMastery.findUnique({
        where: { studentId_skill: { studentId: student.id, skill: "writing" } },
        select: { mastery: true },
      });
      masteryBefore = before?.mastery ?? null;

      await recordSkillOutcome({ studentId: student.id, skill: "writing", score: result.score });

      const after = await prisma.studentSkillMastery.findUnique({
        where: { studentId_skill: { studentId: student.id, skill: "writing" } },
        select: { mastery: true },
      });
      masteryAfter = after?.mastery ?? null;
    }

    // Generate AI-driven next steps based on the grade
    const { generateEssayNextSteps } = await import("@/lib/ai");
    const nextStep = await generateEssayNextSteps(result.score, result.feedback, essay);

    return NextResponse.json({
      ...result,
      nextStep, // Add AI-generated suggestion
      masteryBefore,
      masteryAfter,
    });
  } catch (error) {
    console.error("Essay grading error:", error);
    return NextResponse.json(
      { error: "Failed to grade essay" },
      { status: 500 }
    );
  }
}

async function prismaStudentForSession(userId: string) {
  const { prisma } = await import("@/lib/prisma");
  return prisma.student.findUnique({ where: { userId }, select: { id: true } });
}
