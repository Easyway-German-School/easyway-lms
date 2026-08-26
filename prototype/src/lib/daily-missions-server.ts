import { prisma } from "@/lib/prisma";
import { missionsForCohort, bandFor, personalise, type Mission } from "@/lib/cohort-missions";
import { calculateStreak } from "@/lib/gamification";
import { detectionFor, ctxSince } from "@/lib/mission-detection";
import { storyChapterFor } from "@/lib/story/content";

/**
 * Missions the STUDENT can act on, decided by the SERVER.
 *
 * Before this, the mission list lived only in the browser: the dashboard
 * called `/api/ai/daily-missions` with whatever profile fields it happened to
 * have in state, got back a fresh (and differently-shuffled) set on every
 * load, and the only record of "today's missions" was a client-writable
 * `done` flag against a client-invented id. Nothing server-side could answer
 * "what were today's missions" independently of the browser that generated
 * them — which meant nothing server-side could check whether they'd actually
 * been done, or push a notification about them before the student opened the
 * app.
 *
 * `ensureTodayMissions` is the one place that answer now lives: generate once
 * per student per day, persist it, and re-run detection against real records
 * on every read rather than trusting whatever was last written.
 */

function dayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export type DailyMissionView = {
  id: string;
  title: string;
  description: string;
  reward: string;
  detectType: string;
  done: boolean;
};

async function studentProfile(userId: string) {
  const student = await prisma.student.findUnique({
    where: { userId },
    select: {
      id: true,
      level: true,
      examReadiness: true,
      tenantId: true,
      germanyGoal: true,
      user: { select: { name: true } },
      completions: { where: { status: "completed" }, select: { id: true } },
      attendances: { select: { date: true, present: true, status: true } },
    },
  });
  if (!student) return null;

  const presentDays = student.attendances.filter(
    (a) => a.present || a.status === "present" || a.status === "late",
  );
  const streak = calculateStreak(presentDays.map((a) => a.date));

  return {
    studentId: student.id,
    tenantId: student.tenantId,
    level: student.level,
    examReadiness: student.examReadiness ?? 0,
    name: student.user?.name ?? null,
    germanyGoal: student.germanyGoal,
    streak,
    completedLessons: student.completions.length,
  };
}

/**
 * Missions that don't come from the model at all — the same deterministic
 * top-ups `buildAdaptiveMissions` used to add client-side, ported here so
 * they exist even when the cohort generator has nothing cached yet.
 */
function fallbackMissions(profile: NonNullable<Awaited<ReturnType<typeof studentProfile>>>): Mission[] {
  const missions: Mission[] = [];
  if (profile.examReadiness < 55) {
    missions.push({
      title: "Exam readiness warm-up",
      description: "Work through a short structured exercise to strengthen your exam skills.",
      reward: "+35 XP",
      detectType: "lesson",
    });
  }
  if (profile.streak < 3) {
    missions.push({
      title: "Streak booster practice",
      description: "Finish one lesson today to keep your streak alive.",
      reward: "+25 XP",
      detectType: "lesson",
    });
  }
  missions.push({
    title: "Show up today",
    description: "Open a lesson, play a quiz, or join your class — anything that moves you forward.",
    reward: "+15 XP",
    detectType: "generic",
  });
  return missions.slice(0, 3);
}

/**
 * Goal-gated top-up, applied after either mission source resolves (cohort-
 * personalized or fallback) — not folded into fallbackMissions() itself,
 * since that function only runs on one of the two branches below. Only ever
 * changes anything for a student whose germanyGoal has a matching story
 * (currently just "care"); everyone else's missions are untouched.
 */
function withStoryMission(missions: Mission[], profile: NonNullable<Awaited<ReturnType<typeof studentProfile>>>): Mission[] {
  if (!storyChapterFor(profile.germanyGoal)) return missions;
  const storyMission: Mission = {
    title: "Continue your story",
    description: "Play the next scene of your personalized story — speak, choose, and write your way through it.",
    reward: "+25 XP",
    detectType: "scene",
  };
  return [storyMission, ...missions];
}

/**
 * The day's missions for this student — generated once, read many times.
 *
 * Idempotent per (userId, day): a second call the same day is a pure read
 * plus a fresh detection pass, never a regeneration. Detection is re-run on
 * every call rather than cached, because the whole point is that "done" can
 * flip from false to true between two reads without the student touching a
 * checkbox.
 */
export async function ensureTodayMissions(userId: string): Promise<DailyMissionView[]> {
  const profile = await studentProfile(userId);
  if (!profile) return [];

  const day = dayKey();
  const existing = await prisma.dailyMission.findMany({
    where: { userId, day },
    orderBy: { index: "asc" },
  });

  let rows = existing;
  if (rows.length === 0) {
    const band = bandFor(profile.streak, profile.examReadiness);
    const cohort = await missionsForCohort(profile.level || "A1", band);
    const missions = cohort
      ? personalise(cohort, { name: profile.name, streak: profile.streak, examReadiness: profile.examReadiness })
      : fallbackMissions(profile);

    const toCreate = withStoryMission(missions.length ? missions : fallbackMissions(profile), profile).slice(0, 3);
    await prisma.dailyMission.createMany({
      data: toCreate.map((mission, index) => ({
        userId,
        day,
        index,
        title: mission.title,
        description: mission.description,
        reward: mission.reward,
        detectType: mission.detectType,
        tenantId: profile.tenantId,
      })),
      skipDuplicates: true,
    });
    rows = await prisma.dailyMission.findMany({ where: { userId, day }, orderBy: { index: "asc" } });
  }

  const since = ctxSince();
  const undone = rows.filter((row) => !row.done);
  if (undone.length > 0) {
    const results = await Promise.all(
      undone.map((row) =>
        detectionFor(row.detectType as never, {
          userId,
          studentId: profile.studentId,
          tenantId: profile.tenantId,
          since,
        }).catch(() => false),
      ),
    );
    const now = new Date();
    await Promise.all(
      undone.map((row, i) =>
        results[i]
          ? prisma.dailyMission.update({ where: { id: row.id }, data: { done: true, detectedAt: now } })
          : Promise.resolve(),
      ),
    );
    for (let i = 0; i < undone.length; i++) {
      if (results[i]) undone[i].done = true;
    }
  }

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    reward: row.reward,
    detectType: row.detectType,
    done: row.done,
  }));
}
