import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildCoachingMemorySummary } from "@/lib/voice-coach-memory";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({ where: { userId: session.user.id }, select: { id: true } });
  if (!student) return NextResponse.json({ targetPhrase: "Ich möchte ein Visum beantragen.", memory: null, summary: null, weeklySummary: null });
  const plan = await prisma.personalizedPlan.findUnique({ where: { studentId: student.id }, select: { plan: true } });
  const parsed = plan
    ? (JSON.parse(plan.plan) as {
        voiceCoach?: {
          targetPhrase?: string;
          memory?: unknown[];
          weeklySummary?: { text?: string; generatedAt?: string } | null;
        };
      })
    : {};
  const memory = Array.isArray(parsed.voiceCoach?.memory) ? parsed.voiceCoach!.memory! : [];
  return NextResponse.json({
    targetPhrase: parsed.voiceCoach?.targetPhrase || "Ich möchte ein Visum beantragen.",
    memory: memory.length ? memory : null,
    // Cheap to recompute on read — the same 20-attempt array, summarized —
    // so the "Becca remembers" strip never depends on a save having just run.
    summary: memory.length ? buildCoachingMemorySummary(memory as Parameters<typeof buildCoachingMemorySummary>[0]) : null,
    weeklySummary: parsed.voiceCoach?.weeklySummary ?? null,
  });
}
