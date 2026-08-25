import { prisma } from "@/lib/prisma";
import { notify, KIND } from "@/lib/notify";
import { calculateStreak, hasActivityToday } from "@/lib/gamification";

/**
 * The nudge that gives the streak its loss-aversion pull.
 *
 * The dashboard already shows "🔥 Streak N days" — but a number that just
 * sits there doesn't carry Duolingo's "don't break the chain" urgency. This
 * finds students with a real streak (≥2 days — a 1-day streak isn't worth
 * defending yet) who haven't done anything TODAY, and warns them once before
 * it lapses at midnight.
 *
 * Same attendance-day data every other streak display already uses
 * (gamification/route.ts, leaderboard/route.ts) — a student whose streak
 * reads one number on the dashboard and another here would trust neither.
 */
const BATCH_LIMIT = 200;
const MIN_STREAK_TO_DEFEND = 2;

function dayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export async function sendDueStreakReminders(limit = BATCH_LIMIT) {
  const day = dayKey();

  // Already warned today — exclude before the take() so a school bigger than
  // one batch still gets through everyone across a few ticks, instead of the
  // same first 200 (by default ordering) being checked and re-skipped forever.
  const alreadyNotified = await prisma.notification.findMany({
    where: { kind: KIND.streakAtRisk, dedupeKey: { startsWith: `streak-risk:${day}:` } },
    select: { userId: true },
  });
  const seen = new Set(alreadyNotified.map((n) => n.userId).filter((id): id is string => id !== null));

  const candidates = await prisma.student.findMany({
    where: { status: "active", userId: { notIn: [...seen] } },
    select: {
      userId: true,
      attendances: { select: { date: true, status: true, present: true } },
    },
    take: limit,
  });

  let notified = 0;
  for (const student of candidates) {
    const presentDates = student.attendances
      .filter((record) => record.present || record.status === "present" || record.status === "late")
      .map((record) => record.date);

    if (hasActivityToday(presentDates)) continue; // already kept it alive today

    const streak = calculateStreak(presentDates);
    if (streak < MIN_STREAK_TO_DEFEND) continue;

    try {
      await notify({
        to: { userIds: [student.userId] },
        kind: KIND.streakAtRisk,
        severity: "warning",
        title: "Your streak ends today",
        message: `You're on a ${streak}-day streak — attend today's class or check in to keep it going.`,
        link: "/dashboard",
        push: true,
        dedupeKey: `streak-risk:${day}:${student.userId}`,
      });
      notified += 1;
    } catch (error) {
      console.error("[streak-reminders] failed for", student.userId, error);
    }
  }

  return { candidates: candidates.length, notified };
}
