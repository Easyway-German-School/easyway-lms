import { prisma } from "@/lib/prisma";

type VoiceResult = {
  confidence: number;
  issues: string[];
  corrections: string[];
  nextPractice?: string;
  practicePhrase?: string;
};

export async function saveVoiceCoachMemory(studentId: string, targetPhrase: string, result: VoiceResult) {
  const existing = await prisma.personalizedPlan.findUnique({ where: { studentId }, select: { plan: true } });
  let plan: Record<string, unknown> = {};
  try { plan = existing ? JSON.parse(existing.plan) as Record<string, unknown> : {}; } catch { plan = {}; }
  const previous = (plan.voiceCoach && typeof plan.voiceCoach === "object" ? plan.voiceCoach : {}) as Record<string, unknown>;
  const memory = Array.isArray(previous.memory) ? previous.memory : [];
  plan.voiceCoach = {
    ...previous,
    targetPhrase: result.practicePhrase || targetPhrase,
    memory: [...memory, { targetPhrase, score: result.confidence, issues: result.issues, corrections: result.corrections, nextPractice: result.nextPractice, completedAt: new Date().toISOString() }].slice(-20),
  };
  await prisma.personalizedPlan.upsert({ where: { studentId }, update: { plan: JSON.stringify(plan) }, create: { studentId, plan: JSON.stringify(plan) } });
}
