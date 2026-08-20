import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";

export async function GET() {
  // The other half of the same fix as /api/admin/dashboard: this checked only
  // `role === "admin"`, so every sub-role reached it regardless of preset.
  const gate = await requireCapability("reports");
  if (!gate.ok) return gate.response;

  const [cachedPlans, students, masteryBySkill, lowMastery] = await Promise.all([
    prisma.personalizedPlan.count(),
    prisma.student.count({ where: { status: "active" } }),
    prisma.studentSkillMastery.groupBy({ by: ["skill"], _avg: { mastery: true }, _count: { _all: true } }),
    prisma.studentSkillMastery.findMany({ where: { mastery: { lt: 50 } }, orderBy: { mastery: "asc" }, take: 20, select: { skill: true, mastery: true, attempts: true, student: { select: { user: { select: { name: true, email: true } } } } } }),
  ]);
  const strategies = ["deterministic", "fewshot", "hybrid"];

  return NextResponse.json({
    cachedPlans,
    students,
    studentsWithMastery: new Set(lowMastery.map((row) => row.student.user.email)).size,
    masteryBySkill: masteryBySkill.map((row) => ({ skill: row.skill, average: Math.round((row._avg.mastery ?? 0) * 10) / 10, learners: row._count._all })),
    weakestLearners: lowMastery.map((row) => ({ skill: row.skill, mastery: row.mastery, attempts: row.attempts, student: row.student.user.name || row.student.user.email })),
    strategies,
  });
}
