import { prisma } from "@/lib/prisma";

/**
 * Every DailyMission row a student has ever had, rolled up two ways: by day
 * (a strip of how many of that day's missions landed) and by detectType
 * (which kind of work they actually finish vs. which they don't). Nothing
 * here is inferred — it's the same rows daily-missions-server.ts already
 * writes, just read back further than "today".
 */

const DETECT_LABELS: Record<string, string> = {
  lesson: "Lessons",
  assignment: "Assignments",
  quiz: "Quizzes",
  attendance: "Attendance",
  voice: "Speaking",
  essay: "Writing",
  generic: "General practice",
};

export type MissionHistoryDay = { day: string; total: number; done: number };

export type MissionCategoryStat = {
  detectType: string;
  label: string;
  total: number;
  done: number;
  rate: number;
};

export type MissionHistory = {
  days: MissionHistoryDay[];
  categories: MissionCategoryStat[];
  totalDone: number;
  totalMissions: number;
};

export async function missionHistoryFor(userId: string, days = 30): Promise<MissionHistory> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  const sinceKey = since.toISOString().slice(0, 10);

  const rows = await prisma.dailyMission.findMany({
    where: { userId, day: { gte: sinceKey } },
    orderBy: { day: "asc" },
    select: { day: true, done: true, detectType: true },
  });

  const byDay = new Map<string, MissionHistoryDay>();
  const byCategory = new Map<string, MissionCategoryStat>();

  for (const row of rows) {
    const dayEntry = byDay.get(row.day) ?? { day: row.day, total: 0, done: 0 };
    dayEntry.total += 1;
    if (row.done) dayEntry.done += 1;
    byDay.set(row.day, dayEntry);

    const catEntry = byCategory.get(row.detectType) ?? {
      detectType: row.detectType,
      label: DETECT_LABELS[row.detectType] ?? row.detectType,
      total: 0,
      done: 0,
      rate: 0,
    };
    catEntry.total += 1;
    if (row.done) catEntry.done += 1;
    byCategory.set(row.detectType, catEntry);
  }

  // Weakest first — this list exists to answer "what should I work on", not
  // to lead with a win.
  const categories = Array.from(byCategory.values())
    .map((c) => ({ ...c, rate: c.total > 0 ? Math.round((c.done / c.total) * 100) : 0 }))
    .sort((a, b) => a.rate - b.rate);

  return {
    days: Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day)),
    categories,
    totalDone: rows.filter((r) => r.done).length,
    totalMissions: rows.length,
  };
}
