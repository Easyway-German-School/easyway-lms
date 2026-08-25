import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStudentMastery, MASTERY_SKILLS } from "@/lib/skill-mastery";

/**
 * Per-skill mastery for the student's own dashboard — the general-audience
 * version of what PremiumProgressPanel already shows private-class students,
 * reusing the same StudentSkillMastery rows rather than a second calculation.
 *
 * getStudentMastery() only returns rows for skills with at least one graded
 * outcome, so a skill nobody has graded yet is filled in here rather than
 * silently missing from the response.
 */
export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });

  const rows = await getStudentMastery(student.id);
  const bySkill = new Map(rows.map((row) => [row.skill, row]));

  const skills = MASTERY_SKILLS.map((skill) => {
    const row = bySkill.get(skill);
    return {
      skill,
      mastery: row?.mastery ?? null,
      attempts: row?.attempts ?? 0,
      lastActivityAt: row?.lastActivityAt?.toISOString() ?? null,
    };
  });

  return NextResponse.json({ skills });
}
