import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({ where: { userId: session.user.id }, select: { id: true } });
  if (!student) return NextResponse.json({ targetPhrase: "Ich möchte ein Visum beantragen.", memory: null });
  const plan = await prisma.personalizedPlan.findUnique({ where: { studentId: student.id }, select: { plan: true } });
  const parsed = plan ? JSON.parse(plan.plan) as { voiceCoach?: { targetPhrase?: string; memory?: unknown } } : {};
  return NextResponse.json({
    targetPhrase: parsed.voiceCoach?.targetPhrase || "Ich möchte ein Visum beantragen.",
    memory: parsed.voiceCoach?.memory || null,
  });
}
