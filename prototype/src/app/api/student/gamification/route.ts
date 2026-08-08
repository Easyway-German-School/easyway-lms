import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { calculateStreak, deriveBadges, summarizeGamification } from "@/lib/gamification";

/**
 * XP, level, streak and badges for the signed-in student.
 *
 * Everything is derived from records the school already keeps — attendance
 * rows, submissions, grades, mission ticks. There is no XP column to keep in
 * sync, so these numbers cannot disagree with the student's actual history.
 */
export async function GET() {
  const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id as string;

  const student = await prisma.student.findUnique({
    where: { userId },
    select: {
      id: true,
      level: true,
      examReadiness: true,
      createdAt: true,
      attendances: { select: { date: true, status: true, present: true } },
      grades: { select: { score: true } },
      completions: { select: { status: true } },
      assignmentSubmissions: { select: { id: true } },
      examRegistrations: { select: { id: true } },
    },
  });

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  const missionsCompleted = await prisma.missionProgress.count({
    where: { userId, done: true },
  });

  const presentDays = student.attendances.filter(
    (record) => record.present || record.status === "present" || record.status === "late",
  );
  const sessionsAttended = presentDays.length;
  const streak = calculateStreak(presentDays.map((record) => record.date));
  const completedLessons = student.completions.filter((c) => c.status === "completed").length;
  const averageGrade =
    student.grades.length > 0
      ? Math.round(student.grades.reduce((sum, g) => sum + g.score, 0) / student.grades.length)
      : null;

  const summary = summarizeGamification({
    completedLessons,
    streak,
    examReadiness: student.examReadiness ?? 0,
    averageGrade,
    submissions: student.assignmentSubmissions.length,
    sessionsAttended,
    missionsCompleted,
  });

  const badges = deriveBadges({
    sessionsAttended,
    submissions: student.assignmentSubmissions.length,
    averageGrade,
    streak,
    examsRegistered: student.examRegistrations.length,
    level: student.level,
    missionsCompleted,
  });

  const attendanceRate =
    student.attendances.length > 0
      ? Math.round((sessionsAttended / student.attendances.length) * 100)
      : null;

  return NextResponse.json({
    ...summary,
    streak,
    stats: {
      sessionsAttended,
      totalSessions: student.attendances.length,
      attendanceRate,
      submissions: student.assignmentSubmissions.length,
      completedLessons,
      averageGrade,
      examsRegistered: student.examRegistrations.length,
      missionsCompleted,
      examReadiness: student.examReadiness ?? 0,
      memberSince: student.createdAt.toISOString(),
    },
    badges,
    badgesEarned: badges.filter((badge) => badge.earned).length,
  });
}
