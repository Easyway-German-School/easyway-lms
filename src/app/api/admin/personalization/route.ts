import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";

/**
 * STUDY PLAN HEALTH — is the personalised study plan working, and for whom.
 *
 * WHAT THIS USED TO RETURN, AND WHY IT WAS REPLACED. Three numbers: a count of
 * cached plans, a count of students, and a hardcoded array of the three
 * strategy names the planner supports. The screen printed them as "Planner
 * strategies: 3 · deterministic, fewshot, hybrid", which is a fact about our
 * source code being read by somebody who wanted a fact about their school.
 * Nobody could act on any of it, and the page was fairly described as
 * unintelligible.
 *
 * WHAT IT RETURNS NOW. The same underlying tables, asked the questions the
 * office actually has: how much of the roster the planner knows anything
 * about, which skill the school as a whole is weakest at, and which named
 * students are struggling in which skill — one row per student rather than one
 * row per skill, so a learner weak in four things appears once with four
 * problems rather than filling the list four times over.
 *
 * COVERAGE IS RETURNED FIRST AND NEVER HIDDEN. A "school average of 62% in
 * listening" drawn from nine assessed students out of two hundred is not a
 * school average, and a screen that renders it identically to a real one is
 * actively misleading.
 */

export const dynamic = "force-dynamic";

/** Below this, a skill is treated as needing help rather than as a score. */
const WEAK_BELOW = 50;

export async function GET() {
  // The other half of the same fix as /api/admin/dashboard: this checked only
  // `role === "admin"`, so every sub-role reached it regardless of preset.
  const gate = await requireCapability("reports");
  if (!gate.ok) return gate.response;

  const [activeStudents, cachedPlans, latestPlan, bySkill, weakRows, assessedStudents] = await Promise.all([
    prisma.student.count({ where: { status: "active" } }),
    prisma.personalizedPlan.count(),
    prisma.personalizedPlan.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    prisma.studentSkillMastery.groupBy({
      by: ["skill"],
      _avg: { mastery: true },
      _count: { _all: true },
    }),
    prisma.studentSkillMastery.findMany({
      where: { mastery: { lt: WEAK_BELOW } },
      orderBy: { mastery: "asc" },
      take: 200,
      select: {
        skill: true,
        mastery: true,
        attempts: true,
        lastActivityAt: true,
        student: { select: { id: true, level: true, user: { select: { name: true, email: true } } } },
      },
    }),
    prisma.studentSkillMastery.findMany({ distinct: ["studentId"], select: { studentId: true } }),
  ]);

  /**
   * One row per STUDENT. The old shape was one row per weak skill, so a
   * learner struggling with four things occupied four of the twenty visible
   * slots and pushed three other people off the list entirely.
   */
  const byStudent = new Map<
    string,
    { studentId: string; name: string; level: string; weakest: number; skills: Array<{ skill: string; mastery: number; attempts: number }> }
  >();
  for (const row of weakRows) {
    const key = row.student.id;
    const entry = byStudent.get(key) ?? {
      studentId: key,
      name: row.student.user.name || row.student.user.email || "Unnamed",
      level: row.student.level,
      weakest: 100,
      skills: [],
    };
    entry.skills.push({ skill: row.skill, mastery: Math.round(row.mastery), attempts: row.attempts });
    entry.weakest = Math.min(entry.weakest, Math.round(row.mastery));
    byStudent.set(key, entry);
  }

  const skills = bySkill
    .map((row) => ({
      skill: row.skill,
      average: Math.round((row._avg.mastery ?? 0) * 10) / 10,
      learners: row._count._all,
    }))
    .sort((a, b) => a.average - b.average);

  const assessed = assessedStudents.length;
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    coverage: {
      activeStudents,
      assessed,
      /**
       * Whether the figures below are worth drawing at all. Under a third of
       * the roster and the screen says so instead of charting it.
       */
      trustworthy: activeStudents > 0 && assessed / activeStudents >= 0.33 && assessed >= 10,
      cachedPlans,
      lastPlanAt: latestPlan?.updatedAt?.toISOString() ?? null,
    },
    weakestSkill: skills[0] ?? null,
    strongestSkill: skills.length ? skills[skills.length - 1] : null,
    skills,
    needHelp: [...byStudent.values()].sort((a, b) => a.weakest - b.weakest).slice(0, 20),
  });
}
