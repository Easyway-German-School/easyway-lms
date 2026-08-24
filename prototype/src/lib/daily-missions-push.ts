import { prisma } from "@/lib/prisma";
import { notify, KIND } from "@/lib/notify";
import { ensureTodayMissions } from "@/lib/daily-missions-server";

/**
 * The push that reaches a phone before the student opens the dashboard.
 *
 * `ensureTodayMissions` already generates today's missions lazily, the first
 * time a student loads the dashboard — that's enough for the in-app quest
 * board, but it means nobody who hasn't opened the app yet ever hears about
 * today's quests at all. This is the other half: find whoever has NOT yet
 * had today's missions generated (a cheap proxy for "hasn't opened the app
 * today"), generate theirs now, and buzz their phone once.
 *
 * A student who already opened the dashboard today already has a
 * DailyMission row for today and is skipped here — they've seen the quest
 * board; a push repeating what they already looked at is exactly the kind of
 * notification that teaches someone to ignore the bell.
 */
const BATCH_LIMIT = 40;

function dayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export async function sendDueMissionPush(limit = BATCH_LIMIT) {
  const day = dayKey();

  const alreadyGenerated = await prisma.dailyMission.findMany({
    where: { day },
    select: { userId: true },
    distinct: ["userId"],
  });
  const seen = new Set(alreadyGenerated.map((r) => r.userId));

  const activeStudents = await prisma.student.findMany({
    where: { status: "active" },
    select: { userId: true },
  });
  const pending = activeStudents.map((s) => s.userId).filter((id) => !seen.has(id)).slice(0, limit);

  let notified = 0;
  for (const userId of pending) {
    try {
      const missions = await ensureTodayMissions(userId);
      if (missions.length === 0) continue;

      const headline = missions[0];
      await notify({
        to: { userIds: [userId] },
        kind: KIND.general,
        severity: "info",
        title: "Today's quests are ready 🎯",
        message: missions.length > 1 ? `${headline.title} — and ${missions.length - 1} more.` : headline.title,
        link: "/dashboard",
        dedupeKey: `daily-missions:${day}:${userId}`,
        push: true,
      });
      notified += 1;
    } catch (error) {
      console.error("[daily-missions-push] failed for", userId, error);
    }
  }

  return { candidates: pending.length, notified };
}
