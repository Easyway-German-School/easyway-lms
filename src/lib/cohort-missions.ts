import { prisma } from "@/lib/prisma";
import { cached } from "@/lib/ai-cache";
import { callModel, activeModelName } from "@/lib/ai";
import { parseModelJson } from "@/lib/safe-json";

/**
 * Daily missions, generated per COHORT rather than per student.
 *
 * This is the decision that makes the whole feature affordable. Generating for
 * each student is 43 model calls a day today and grows with the school.
 * Generating for each (level, engagement band) is six, and the difference
 * between the two students in a band is handled in plain code below — which is
 * both free and more reliable than asking a 3B model to remember a streak
 * count.
 *
 * Nobody can tell. Two A1 students who are both three days in should be
 * practising the same thing; that is what a syllabus IS. What must differ is
 * the framing, and that is the part done deterministically.
 */

export type Mission = {
  title: string;
  description: string;
  reward: string;
  category?: string;
};

/**
 * Which bucket a student falls in.
 *
 * Three bands, chosen for where behaviour actually diverges rather than for
 * neatness:
 *
 *   starting  — no streak worth protecting. Needs a reason to come back.
 *   going     — has a streak. Loss aversion does the work; the mission just
 *               has to be small enough not to break it.
 *   pushing   — deep in, exam in sight. Wants difficulty, not encouragement.
 */
export type Band = "starting" | "going" | "pushing";

export function bandFor(streak: number, examReadiness: number): Band {
  if (examReadiness >= 70) return "pushing";
  if (streak >= 3) return "going";
  return "starting";
}

const BAND_BRIEF: Record<Band, string> = {
  starting:
    "This student has no streak yet and may be about to drift away. Make the missions small, obviously finishable, and satisfying — the goal is that they come back tomorrow, not that they learn the most today.",
  going:
    "This student has a streak going. They will protect it. Missions can ask a little more, but must still be finishable on a phone in a spare ten minutes.",
  pushing:
    "This student is close to exam-ready. Give them something with teeth — a task they could get wrong, not a warm-up.",
};

function buildPrompt(level: string, band: Band, materialTitles: string[]): string {
  return [
    `Write daily missions for students at CEFR level ${level} in a Nigerian German school.`,
    "",
    BAND_BRIEF[band],
    "",
    materialTitles.length
      ? `Their tutor recently uploaded: ${materialTitles.slice(0, 5).map((t) => `"${t}"`).join(", ")}. Tie at least one mission to that.`
      : "No recent materials — base the missions on what this level normally covers.",
    "",
    "Write exactly 3 missions. Each finishable in under 15 minutes, on a phone.",
    "Be concrete: name the words, the tense, or the situation. Never 'practise your German'.",
    "",
    'Reply with ONLY a JSON array: [{"title":"…","description":"…","reward":"+20 XP"}]',
  ].join("\n");
}

function coerce(raw: unknown): Mission[] | null {
  if (!Array.isArray(raw)) return null;
  const missions = raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const value = entry as Record<string, unknown>;
      const title = String(value.title ?? "").trim();
      if (!title) return null;
      return {
        title,
        description: String(value.description ?? "").trim(),
        reward: String(value.reward ?? "+20 XP").trim(),
      } satisfies Mission;
    })
    .filter((mission): mission is Mission => mission !== null)
    .slice(0, 3);

  return missions.length ? missions : null;
}

/**
 * The cohort's missions for today, generated once and shared.
 *
 * Keyed on the date as well as the level and band, so they turn over daily
 * without anything having to expire them — a new day is simply a new key, and
 * yesterday's row stays as a record of what was set.
 */
export async function missionsForCohort(
  level: string,
  band: Band,
  today = new Date(),
): Promise<Mission[] | null> {
  const day = today.toISOString().slice(0, 10);

  // What the tutors actually uploaded for this level recently. This is the
  // difference between "practise dative prepositions" and "practise the dative
  // prepositions from Thursday's handout".
  const recent = await prisma.material.findMany({
    where: {
      level,
      createdAt: { gte: new Date(today.getTime() - 21 * 24 * 60 * 60 * 1000) },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { title: true },
  });

  const titles = recent.map((material) => material.title);

  return cached<Mission[]>(
    "cohort_missions",
    `${day}:${level}:${band}:${titles.join("|")}`,
    async () => coerce(parseModelJson(await callModel(buildPrompt(level, band, titles), 700))),
    { model: activeModelName() },
  );
}

/**
 * Make one cohort's missions read as this student's.
 *
 * Done in code, not by the model. A small model asked to "mention their
 * 7-day streak" will as often invent a 12-day one, and a student who spots
 * the system being wrong about their own record stops trusting the rest of it.
 * String interpolation cannot make that mistake.
 */
export function personalise(
  missions: Mission[],
  profile: { name?: string | null; streak?: number; examReadiness?: number },
): Mission[] {
  const streak = Number(profile.streak ?? 0);
  const firstName = (profile.name ?? "").trim().split(/\s+/)[0] || "";

  return missions.map((mission, index) => {
    if (index !== 0) return mission;

    // Only the first mission gets the personal line. Every one of them
    // addressing the student by name reads like a mail merge, which is
    // precisely the feeling this is trying to avoid.
    const opener =
      streak >= 3
        ? `${streak}-day streak on the line${firstName ? `, ${firstName}` : ""}.`
        : firstName
          ? `Morgen, ${firstName}.`
          : "";

    return opener
      ? { ...mission, description: `${opener} ${mission.description}`.trim() }
      : mission;
  });
}
