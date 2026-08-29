import { prisma } from "@/lib/prisma";
import { calculateStreak } from "@/lib/gamification";
import { cached } from "@/lib/ai-cache";
import { callModel, activeModelName } from "@/lib/ai";
import { profileFor } from "@/lib/learner-intelligence";

/**
 * Becca's brief — daily / weekly / monthly, hosted rather than generated.
 *
 * The FACTS are deliberately NOT a model call. Anthropic's own "morning
 * brief" can afford one because it's reading a single account's history once
 * a day; this school would be paying for one generation per student per
 * period, and the thing a brief actually needs — specific, correct numbers —
 * is exactly what a small model is worst at and a database query is best at.
 * Every number below is a real query scoped to the period; the sentences
 * wrapping them are pure functions, the same trick `scoreline()` in the
 * Kahoot result screen already uses.
 *
 * ONE line is a real model call: `personalLine`. The numbers can't be wrong
 * because a model never states them — it's handed them as already-true facts
 * plus a behaviour summary from the engine in learner-intelligence.ts (peak
 * hours, rhythm, archetype — the per-student data the school already
 * collects and otherwise only an admin ever sees) and asked to write ONE
 * sentence of framing around them. Cached per student per period per day, so
 * a student re-checking their brief five times doesn't cost five calls.
 */

export type BriefPeriod = "daily" | "weekly" | "monthly";

export type Brief = {
  period: BriefPeriod;
  headline: string;
  lines: string[];
  /** Becca's own line, from Claude — null when unfunded/unreachable. Never a fact, just framing. */
  personalNote: string | null;
};

function periodStart(period: BriefPeriod, now = new Date()): Date {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  if (period === "daily") return start;
  if (period === "weekly") {
    start.setUTCDate(start.getUTCDate() - 6);
    return start;
  }
  start.setUTCDate(start.getUTCDate() - 29);
  return start;
}

const PERIOD_WORD: Record<BriefPeriod, string> = {
  daily: "today",
  weekly: "this week",
  monthly: "this month",
};

export async function buildBrief(userId: string, period: BriefPeriod): Promise<Brief | null> {
  const student = await prisma.student.findUnique({
    where: { userId },
    select: {
      id: true,
      examReadiness: true,
      user: { select: { name: true } },
      attendances: { select: { date: true, present: true, status: true } },
    },
  });
  if (!student) return null;

  const since = periodStart(period);
  const firstName = (student.user?.name ?? "").trim().split(/\s+/)[0] || "";

  const [lessonsDone, quizzesPlayed, missionsDone] = await Promise.all([
    prisma.completion.count({
      where: { studentId: student.id, status: "completed", completedAt: { gte: since } },
    }),
    prisma.quizGamePlayer.count({
      where: { studentId: student.id, joinedAt: { gte: since }, answered: { gt: 0 } },
    }),
    prisma.dailyMission.count({ where: { userId, done: true, updatedAt: { gte: since } } }),
  ]);

  const presentDays = student.attendances.filter(
    (a) => a.present || a.status === "present" || a.status === "late",
  );
  const streak = calculateStreak(presentDays.map((a) => a.date));

  const activityCount = lessonsDone + quizzesPlayed + missionsDone;
  const greeting = firstName ? `${firstName}, ` : "";

  const headline =
    activityCount === 0
      ? `${greeting}nothing logged ${PERIOD_WORD[period]} yet — that's the easiest thing on this page to fix.`
      : period === "daily"
        ? `${greeting}here's today: ${describeActivity(lessonsDone, quizzesPlayed, missionsDone)}.`
        : `${greeting}here's ${PERIOD_WORD[period]}: ${describeActivity(lessonsDone, quizzesPlayed, missionsDone)}.`;

  const lines: string[] = [];
  if (streak >= 2) lines.push(`${streak}-day streak — don't be the one who breaks it.`);
  if (student.examReadiness >= 70) lines.push(`Exam readiness is at ${student.examReadiness}%. You could sit this and be fine.`);
  else if (student.examReadiness > 0) lines.push(`Exam readiness: ${student.examReadiness}%. Still climbing.`);
  if (activityCount > 0 && period !== "daily") lines.push(closingLine(activityCount, period));

  // The facts above must reach the student even if Claude, the cache table,
  // or the behaviour engine is unreachable — none of that may ever take the
  // whole brief down with it.
  const personalNote = await personalLine(userId, period, {
    firstName,
    streak,
    examReadiness: student.examReadiness,
    activityCount,
    activitySummary: describeActivity(lessonsDone, quizzesPlayed, missionsDone),
  }).catch(() => null);

  return { period, headline, lines, personalNote };
}

/**
 * Claude's one sentence, informed by the behaviour engine rather than
 * generic — see profileFor() in learner-intelligence.ts, which already
 * summarises this student's rhythm for the admin's at-risk view. A student
 * who studies at 11pm on weekends and a student who studies at 7am on
 * weekdays get a different sentence, not because the model is told to vary
 * it, but because the summary it's handed is actually different.
 *
 * Cached per (student, period, day) — one call feeds every check of the
 * brief that day, not one call per page load. Returns null on any failure
 * (no key configured, provider unreachable, empty reply): the deterministic
 * headline and lines already stand on their own without it.
 */
async function personalLine(
  userId: string,
  period: BriefPeriod,
  facts: { firstName: string; streak: number; examReadiness: number; activityCount: number; activitySummary: string },
): Promise<string | null> {
  const day = new Date().toISOString().slice(0, 10);

  let behaviour: string;
  try {
    behaviour = (await profileFor(userId, facts.firstName || undefined)).summary;
  } catch {
    behaviour = "";
  }

  const input = `${userId}:${period}:${day}`;
  return cached<string>(
    "student_brief_line",
    input,
    async () => {
      const prompt = [
        `You are Becca, a warm but no-nonsense mascot for a Nigerian German-language school, writing ONE sentence`,
        `for a student's ${period} brief. This is framing only — every fact you use MUST come from what's given below;`,
        `never invent a number, a streak, or an activity that isn't listed.`,
        "",
        `Student: ${facts.firstName || "the student"}`,
        `${period} so far: ${facts.activitySummary} (${facts.activityCount} total actions)`,
        `Current streak: ${facts.streak} day(s)`,
        `Exam readiness: ${facts.examReadiness}%`,
        behaviour ? `What we know about how they use the app: ${behaviour}` : "",
        "",
        "Write exactly one short sentence (under 25 words), in Becca's voice: warm, direct, a little playful, never",
        "corporate. No emoji. No quotation marks. Reply with ONLY the sentence.",
      ]
        .filter(Boolean)
        .join("\n");

      const raw = await callModel(prompt, 100, "student");
      if (!raw) return null;
      const clean = raw.trim().replace(/^["']|["']$/g, "").slice(0, 220);
      return clean || null;
    },
    { model: activeModelName() },
  );
}

function describeActivity(lessons: number, quizzes: number, missions: number): string {
  const parts: string[] = [];
  if (lessons > 0) parts.push(`${lessons} lesson${lessons === 1 ? "" : "s"} finished`);
  if (quizzes > 0) parts.push(`${quizzes} quiz game${quizzes === 1 ? "" : "s"} played`);
  if (missions > 0) parts.push(`${missions} quest${missions === 1 ? "" : "s"} cleared`);
  if (parts.length === 0) return "quiet, but the day isn't over";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function closingLine(activityCount: number, period: BriefPeriod): string {
  if (period === "monthly") {
    if (activityCount >= 20) return "That's a month with real weight behind it.";
    if (activityCount >= 8) return "Steady month. A little more and it's a strong one.";
    return "A light month — worth picking the pace back up.";
  }
  if (activityCount >= 8) return "Best week in a while.";
  if (activityCount >= 3) return "Solid week.";
  return "A quiet week — nothing that can't be caught up.";
}
