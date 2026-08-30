import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { calculateStreak, deriveBadges, summarizeGamification } from "@/lib/gamification";
import { countCompletedStoryEpisodes } from "@/lib/story-progress";

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

  // Old self-reported rows plus new server-verified ones (see
  // src/lib/mission-detection.ts) — summed rather than switched over, so a
  // badge already earned under the old honour system is never taken back.
  const [legacyMissionsCompleted, verifiedMissionsCompleted] = await Promise.all([
    prisma.missionProgress.count({ where: { userId, done: true } }),
    prisma.dailyMission.count({ where: { userId, done: true } }),
  ]);
  const missionsCompleted = legacyMissionsCompleted + verifiedMissionsCompleted;

  /**
   * Live quiz games this student played to the end.
   *
   * Only finished games count. A game still in progress would tick XP up mid-
   * lesson and then need taking back if the tutor abandoned it, and a game the
   * laptop was closed on is not something the student did wrong.
   */
  const quizGamesPlayed = await prisma.quizGamePlayer.count({
    where: { studentId: student.id, game: { phase: "ended" }, answered: { gt: 0 } },
  });

  const materialQuestsCompleted = await prisma.materialQuestAttempt.count({
    where: { studentId: student.id, correct: true },
  });

  const storyEpisodesCompleted = await countCompletedStoryEpisodes(student.id);

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
    quizGamesPlayed,
    materialQuestsCompleted,
    storyEpisodesCompleted,
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
      quizGamesPlayed,
      materialQuestsCompleted,
      storyEpisodesCompleted,
      examReadiness: student.examReadiness ?? 0,
      memberSince: student.createdAt.toISOString(),
    },
    badges,
    badgesEarned: badges.filter((badge) => badge.earned).length,
  });
}
