import { NextResponse } from "next/server";

import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { GRID_WEEKS, buildActivityGrid } from "@/lib/activity-grid";

export const dynamic = "force-dynamic";

/**
 * The student's study grid: what they did on each of the last twelve weeks'
 * days, counted from records the school already keeps (attendance, handed-in
 * homework, daily missions, quests, live quizzes). Nothing new is tracked for
 * this — see src/lib/activity-grid.ts for what counts and why it never shames.
 */
export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id as string;

  const student = await prisma.student.findUnique({ where: { userId }, select: { id: true } });
  if (!student) return NextResponse.json({ error: "Not a student account" }, { status: 403 });

  // A day of slack on the front so a UTC edge never clips the first column.
  const since = new Date(Date.now() - (GRID_WEEKS * 7 + 8) * 86_400_000);

  const [attendance, submissions, missions, quests, quizzes] = await Promise.all([
    prisma.attendance.findMany({
      where: { studentId: student.id, date: { gte: since }, OR: [{ present: true }, { status: { in: ["present", "late"] } }] },
      select: { date: true },
    }),
    prisma.assignmentSubmission.findMany({
      where: { studentId: student.id, submittedAt: { gte: since } },
      select: { submittedAt: true },
    }),
    prisma.dailyMission.findMany({
      where: { userId, done: true, createdAt: { gte: since } },
      select: { detectedAt: true, createdAt: true },
    }),
    prisma.materialQuestAttempt.findMany({
      where: { studentId: student.id, correct: true, createdAt: { gte: since } },
      select: { createdAt: true },
    }),
    prisma.quizGamePlayer.findMany({
      where: { studentId: student.id, answered: { gt: 0 }, joinedAt: { gte: since } },
      select: { joinedAt: true },
    }),
  ]);

  const grid = buildActivityGrid([
    ...attendance.map((r) => r.date),
    ...submissions.map((r) => r.submittedAt),
    ...missions.map((r) => r.detectedAt ?? r.createdAt),
    ...quests.map((r) => r.createdAt),
    ...quizzes.map((r) => r.joinedAt),
  ]);

  return NextResponse.json(grid);
}
