import { prisma } from "@/lib/prisma";
import type { AzurePronunciationAssessment, AzureWordScore } from "@/lib/azure-pronunciation";

type VoiceResult = {
  confidence: number;
  issues: string[];
  corrections: string[];
  nextPractice?: string;
  practicePhrase?: string;
  wordAccuracy?: number;
  missingWords?: string[];
  extraWords?: string[];
};

type StoredAttempt = {
  targetPhrase: string;
  score: number;
  wordAccuracy: number;
  missingWords: string[];
  extraWords: string[];
  issues: string[];
  corrections: string[];
  nextPractice?: string;
  acousticFeatures: Record<string, number> | null;
  /** Azure's aggregate PronScore for this attempt, when the assessment ran. */
  pronunciationScore: number | null;
  /** Per-word, per-phoneme detail from Azure, kept so trends can be built later. */
  azureWords: AzureWordScore[] | null;
  completedAt: string;
};

const ACOUSTIC_MEMORY_CONTEXT = {
  version: 1,
  principle: "German has no single identifying frequency; acoustic features are speaker-relative evidence.",
  measuredFeatures: [
    "durationSeconds",
    "rms",
    "zeroCrossingRate",
    "estimatedPitchHz",
    "pitchConfidence",
    "spectralCentroidHz",
    "lowBandRatio",
    "lowMidBandRatio",
    "midBandRatio",
    "highMidBandRatio",
    "highBandRatio",
  ],
  usefulGermanCues: [
    "vowel length contrasts",
    "final consonant clarity",
    "cautious /ç/ and /x/ frication proxies",
    "lexical stress and intonation",
  ],
  limitations: [
    "microphone, room, compression, and noise affect measurements",
    "these summaries cannot score exact phonemes or locate sounds in time without Azure's forced alignment",
  ],
};

/* -------------------------------------------------------------------------- */
/* Turning a log of attempts into something worth coaching from              */
/* -------------------------------------------------------------------------- */

export type CoachingMemorySummary = {
  attemptCount: number;
  /** Last up to 5 word-accuracy scores, oldest first. */
  recentWordAccuracy: number[];
  trend: "improving" | "declining" | "steady" | "new";
  /** Words missed at least twice in the last 10 attempts, most-missed first. */
  recurringMissingWords: string[];
  /** Named weaknesses that showed up at least twice, most common first. */
  recurringIssueThemes: string[];
  /** Real phoneme accuracy from Azure, averaged across attempts. Only the weak ones. */
  weakPhonemes: Array<{ phoneme: string; averageAccuracy: number; occurrences: number }>;
  /**
   * This student's own rolling average, not a fixed native-speaker number —
   * see PRONUNCIATION_ACOUSTIC_ANALYSIS.md's own argument for why an absolute
   * threshold is the wrong comparison. Null until there is enough voiced,
   * confident-pitch history to average.
   */
  acousticBaseline: { estimatedPitchHz: number | null; spectralCentroidHz: number | null; rms: number | null } | null;
};

const ISSUE_THEMES: Array<{ label: string; pattern: RegExp }> = [
  { label: "vowel length", pattern: /vowel|\blang\b|\bkurz\b/i },
  { label: "final consonants", pattern: /final consonant|word ending|dropped.{0,12}ending/i },
  { label: "ch-sound (ich/ach)", pattern: /\bch\b|\bich\b|\bmachen\b|\/ç\/|\/x\//i },
  { label: "r-sound", pattern: /\br\b|\bʁ\b|guttural/i },
  { label: "stress and rhythm", pattern: /stress|rhythm|intonation/i },
];

export function buildCoachingMemorySummary(memory: StoredAttempt[]): CoachingMemorySummary {
  const recent = memory.slice(-10);
  const recentWordAccuracy = recent.slice(-5).map((attempt) => attempt.wordAccuracy);

  let trend: CoachingMemorySummary["trend"] = "new";
  if (recent.length >= 4) {
    const midpoint = Math.floor(recent.length / 2);
    const average = (list: StoredAttempt[]) =>
      list.reduce((sum, attempt) => sum + attempt.wordAccuracy, 0) / (list.length || 1);
    const delta = average(recent.slice(midpoint)) - average(recent.slice(0, midpoint));
    trend = delta > 8 ? "improving" : delta < -8 ? "declining" : "steady";
  }

  const missingWordCounts = new Map<string, number>();
  for (const attempt of recent) {
    for (const word of attempt.missingWords) missingWordCounts.set(word, (missingWordCounts.get(word) ?? 0) + 1);
  }
  const recurringMissingWords = [...missingWordCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);

  const themeCounts = new Map<string, number>();
  for (const attempt of recent) {
    const text = attempt.issues.join(" ");
    for (const theme of ISSUE_THEMES) {
      if (theme.pattern.test(text)) themeCounts.set(theme.label, (themeCounts.get(theme.label) ?? 0) + 1);
    }
  }
  const recurringIssueThemes = [...themeCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([label]) => label);

  const phonemeStats = new Map<string, { total: number; count: number }>();
  for (const attempt of recent) {
    for (const word of attempt.azureWords ?? []) {
      for (const phoneme of word.phonemes) {
        const stat = phonemeStats.get(phoneme.phoneme) ?? { total: 0, count: 0 };
        stat.total += phoneme.accuracyScore;
        stat.count += 1;
        phonemeStats.set(phoneme.phoneme, stat);
      }
    }
  }
  const weakPhonemes = [...phonemeStats.entries()]
    .map(([phoneme, stat]) => ({
      phoneme,
      averageAccuracy: Math.round(stat.total / stat.count),
      occurrences: stat.count,
    }))
    .filter((entry) => entry.averageAccuracy < 75 && entry.occurrences >= 2)
    .sort((a, b) => a.averageAccuracy - b.averageAccuracy)
    .slice(0, 5);

  const voicedAttempts = recent
    .map((attempt) => attempt.acousticFeatures)
    .filter((features): features is Record<string, number> => Boolean(features) && Number(features?.pitchConfidence ?? 0) > 0.4);
  let acousticBaseline: CoachingMemorySummary["acousticBaseline"] = null;
  if (voicedAttempts.length >= 2) {
    const averageOf = (key: string) => {
      const values = voicedAttempts.map((features) => features[key]).filter((value) => typeof value === "number" && value > 0);
      return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
    };
    const rmsValues = voicedAttempts.map((features) => features.rms).filter((value) => typeof value === "number");
    acousticBaseline = {
      estimatedPitchHz: averageOf("estimatedPitchHz"),
      spectralCentroidHz: averageOf("spectralCentroidHz"),
      rms: rmsValues.length ? Math.round((rmsValues.reduce((sum, value) => sum + value, 0) / rmsValues.length) * 1000) / 1000 : null,
    };
  }

  return {
    attemptCount: memory.length,
    recentWordAccuracy,
    trend,
    recurringMissingWords,
    recurringIssueThemes,
    weakPhonemes,
    acousticBaseline,
  };
}

/** For the route to read before coaching a new attempt — the loop this file used to leave open. */
export async function getCoachingMemorySummary(studentId: string): Promise<CoachingMemorySummary | null> {
  try {
    const existing = await prisma.personalizedPlan.findUnique({ where: { studentId }, select: { plan: true } });
    if (!existing) return null;
    const plan = JSON.parse(existing.plan) as Record<string, unknown>;
    const voiceCoach = (plan.voiceCoach && typeof plan.voiceCoach === "object" ? plan.voiceCoach : {}) as Record<string, unknown>;
    const memory: StoredAttempt[] = Array.isArray(voiceCoach.memory) ? voiceCoach.memory : [];
    return memory.length ? buildCoachingMemorySummary(memory) : null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* The weekly digest                                                         */
/* -------------------------------------------------------------------------- */

export type WeeklyCoachingSummary = { text: string; generatedAt: string };

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Regenerated at most once a week, and only on a save — never on a page load
 * — so a student opening the panel never pays a Claude call's latency for a
 * digest nobody asked to see refreshed that second.
 */
async function maybeRefreshWeeklySummary(
  current: WeeklyCoachingSummary | undefined,
  memory: StoredAttempt[],
): Promise<WeeklyCoachingSummary | null> {
  const stale = !current || Date.now() - new Date(current.generatedAt).getTime() > WEEK_MS;
  if (!stale) return current ?? null;

  const summary = buildCoachingMemorySummary(memory);
  // Three attempts is the floor for "trend" to mean anything — see buildCoachingMemorySummary.
  if (summary.attemptCount < 3) return current ?? null;

  try {
    const { generateWeeklyCoachingSummary } = await import("@/lib/ai");
    const text = await generateWeeklyCoachingSummary(summary);
    return text ? { text, generatedAt: new Date().toISOString() } : current ?? null;
  } catch {
    return current ?? null;
  }
}

/* -------------------------------------------------------------------------- */
/* Saving an attempt                                                         */
/* -------------------------------------------------------------------------- */

export async function saveVoiceCoachMemory(
  studentId: string,
  targetPhrase: string,
  result: VoiceResult,
  acousticFeatures: Record<string, number> | null = null,
  azureAssessment: AzurePronunciationAssessment | null = null,
) {
  const existing = await prisma.personalizedPlan.findUnique({ where: { studentId }, select: { plan: true } });
  let plan: Record<string, unknown> = {};
  try { plan = existing ? JSON.parse(existing.plan) as Record<string, unknown> : {}; } catch { plan = {}; }
  const previous = (plan.voiceCoach && typeof plan.voiceCoach === "object" ? plan.voiceCoach : {}) as Record<string, unknown>;
  const memory: StoredAttempt[] = Array.isArray(previous.memory) ? previous.memory : [];

  const nextMemory: StoredAttempt[] = [...memory, {
    targetPhrase,
    score: result.confidence,
    wordAccuracy: result.wordAccuracy ?? result.confidence,
    missingWords: result.missingWords ?? [],
    extraWords: result.extraWords ?? [],
    issues: result.issues,
    corrections: result.corrections,
    nextPractice: result.nextPractice,
    acousticFeatures,
    pronunciationScore: azureAssessment?.pronScore ?? null,
    azureWords: azureAssessment?.words ?? null,
    completedAt: new Date().toISOString(),
  }].slice(-20);

  const weeklySummary = await maybeRefreshWeeklySummary(previous.weeklySummary as WeeklyCoachingSummary | undefined, nextMemory);

  plan.voiceCoach = {
    ...previous,
    acousticMemoryContext: ACOUSTIC_MEMORY_CONTEXT,
    targetPhrase: result.practicePhrase || targetPhrase,
    memory: nextMemory,
    weeklySummary,
  };
  await prisma.personalizedPlan.upsert({ where: { studentId }, update: { plan: JSON.stringify(plan) }, create: { studentId, plan: JSON.stringify(plan) } });
}
