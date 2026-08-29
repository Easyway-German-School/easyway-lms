import { prisma } from "@/lib/prisma";
import { currentTenantId } from "@/lib/tenant/context";

export const MASTERY_SKILLS = ["grammar", "vocabulary", "reading", "listening", "speaking", "writing"] as const;
export type MasterySkill = (typeof MASTERY_SKILLS)[number];

const DEFAULT_MASTERY = 50;

export function normalizeSkill(value: string | null | undefined): MasterySkill {
  const skill = String(value ?? "").toLowerCase();
  if (skill.includes("grammar")) return "grammar";
  if (skill.includes("vocab")) return "vocabulary";
  if (skill.includes("read")) return "reading";
  if (skill.includes("listen")) return "listening";
  if (skill.includes("speak") || skill.includes("pronun")) return "speaking";
  return "writing";
}

/** Update one skill without allowing one unusual score to swing mastery wildly. */
export async function recordSkillOutcome(input: {
  studentId: string;
  skill: string;
  score: number;
}): Promise<void> {
  const skill = normalizeSkill(input.skill);
  const score = Math.max(0, Math.min(100, Math.round(Number(input.score))));
  if (!Number.isFinite(score)) return;

  const existing = await prisma.studentSkillMastery.findUnique({
    where: { studentId_skill: { studentId: input.studentId, skill } },
    select: { mastery: true, attempts: true },
  });
  const previous = existing?.mastery ?? DEFAULT_MASTERY;
  const attempts = existing?.attempts ?? 0;
  // First evidence is weighted more strongly; later evidence stabilizes.
  const weight = attempts < 3 ? 0.35 : 0.2;
  const mastery = Math.round((previous * (1 - weight) + score * weight) * 10) / 10;

  await prisma.studentSkillMastery.upsert({
    where: { studentId_skill: { studentId: input.studentId, skill } },
    create: { studentId: input.studentId, tenantId: currentTenantId(), skill, mastery, attempts: 1, lastScore: score, lastActivityAt: new Date() },
    update: { mastery, attempts: { increment: 1 }, lastScore: score, lastActivityAt: new Date() },
  });
}

export async function getStudentMastery(studentId: string) {
  const rows = await prisma.studentSkillMastery.findMany({
    where: { studentId },
    orderBy: { mastery: "asc" },
    select: { skill: true, mastery: true, attempts: true, lastScore: true, lastActivityAt: true },
  });
  return rows;
}
