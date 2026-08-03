import { NextResponse } from "next/server";
import { generateDailyMissions } from "@/lib/ai";
import { requireAiUser } from "@/lib/ai-guard";

type Profile = {
  level?: string;
  examReadiness?: number;
  pathway?: string;
  streak?: number;
  completedLessons?: number;
};

function buildAdaptiveMissions(profile: Profile, aiMissions: Array<any>) {
  const level = profile.level || "B1";
  const readiness = Number(profile.examReadiness ?? 0);
  const streak = Number(profile.streak ?? 0);
  const completedLessons = Number(profile.completedLessons ?? 0);
  const pathway = profile.pathway || "Language training";

  const base = (Array.isArray(aiMissions) ? aiMissions : []).map((mission, index) => ({
    id: mission.id || `mission-${index}`,
    title: mission.title,
    description: mission.description,
    reward: mission.reward || "+20 XP",
    category: mission.category || "Focus",
    target: mission.target || "Complete this task",
    done: mission.done ?? false,
  }));

  const adaptive: Array<any> = [];

  if (readiness < 55) {
    adaptive.push({
      id: "adaptive-exam-focus",
      title: "Exam readiness warm-up",
      description: "Work through a small structured exercise to strengthen your exam skills.",
      reward: "+35 XP",
      category: "Exam",
      target: `Focus on ${level} exam task completion`,
    });
  }

  if (streak < 3) {
    adaptive.push({
      id: "adaptive-streak-booster",
      title: "Streak booster practice",
      description: "Do a short speaking or listening session to keep your learning streak alive.",
      reward: "+25 XP",
      category: "Streak",
      target: `Maintain a ${Math.max(3, streak + 1)}-day streak`,
    });
  }

  if (completedLessons > 6) {
    adaptive.push({
      id: "adaptive-review-session",
      title: "Review and refine",
      description: "Look back at your recent lessons and correct any recurring mistakes.",
      reward: "+30 XP",
      category: "Review",
      target: "Review 2 recent lessons",
    });
  }

  if (pathway.toLowerCase().includes("nursing")) {
    adaptive.push({
      id: "adaptive-nursing-vocab",
      title: "Nursing vocabulary drill",
      description: "Practice key medical expressions for patient communication.",
      reward: "+30 XP",
      category: "Vocabulary",
      target: "Use 10 medical words in sentences",
    });
  }

  const merged = [...adaptive, ...base];
  return merged.slice(0, 4).map((mission, index) => ({ ...mission, id: mission.id || `daily-${index}` }));
}

export async function POST(req: Request) {
  const gate = await requireAiUser();
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json();
    const profile = (body.profile || {}) as Profile;

    /**
     * Cohort first, per-student only as a fallback.
     *
     * The cohort generator answers from cache for everyone after the first
     * student of the day at that level and band — 43 students become one model
     * call, which is what keeps this inside a free tier or on the office
     * machine. `generateDailyMissions` stays as the fallback for the case
     * where the cohort call has not been made yet and cannot be made now.
     */
    const { missionsForCohort, bandFor, personalise } = await import("@/lib/cohort-missions");

    const band = bandFor(Number(profile.streak ?? 0), Number(profile.examReadiness ?? 0));
    const cohort = await missionsForCohort(profile.level || "A1", band);

    const aiMissions = cohort
      ? personalise(cohort, {
          name: (body.profile?.name as string) ?? null,
          streak: Number(profile.streak ?? 0),
          examReadiness: Number(profile.examReadiness ?? 0),
        })
      : await generateDailyMissions(profile);

    const missions = buildAdaptiveMissions(profile, aiMissions);
    return NextResponse.json({ missions });
  } catch (error) {
    console.error("daily-missions error", error);
    return NextResponse.json({ missions: [] }, { status: 500 });
  }
}
