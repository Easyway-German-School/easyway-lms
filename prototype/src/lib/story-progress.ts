import { prisma } from "@/lib/prisma";
import type { StoryChapter } from "@/lib/story/types";

/**
 * Per-student progress through a personalized story SERIES, stored the same
 * way voice-coach-memory.ts stores pronunciation history: a namespaced key
 * inside PersonalizedPlan.plan (one flexible JSON blob per student) rather
 * than a new table — this is progress on curated content, not a new kind of
 * record the rest of the app needs to query relationally.
 *
 * A goal's story is a SERIES of episodes (StoryChapter[]), not one chapter.
 * Episode N+1 unlocks the moment the UTC calendar day ticks over after
 * episode N was completed — same convention daily missions and streaks
 * already use elsewhere in this app, not a rolling timer. There is
 * deliberately no stored "unlocks at" timestamp: it's a pure function of
 * `completedEpisodes.at(-1).completedAt`, computed fresh on every read.
 */

export type StoryProgress = {
  chapterId: string;
  currentSceneId: string;
  currentBeatId: string;
  completedSceneIds: string[];
  choices: Array<{ sceneId: string; beatId: string; optionId: string; at: string }>;
  writingResponses: Array<{
    sceneId: string;
    beatId: string;
    prompt: string;
    response: string;
    score: number;
    feedback: string;
    at: string;
  }>;
  /** Every beat completed, capped — the real signal mission-detection reads for the "scene" mission type. */
  history: Array<{ sceneId: string; beatId: string; type: string; at: string }>;
  startedAt: string;
  lastPlayedAt: string;
};

export type StorySeriesProgress = {
  currentEpisodeIndex: number;
  /** Progress for the currently-active episode only — past episodes keep just the light record below. */
  progress: StoryProgress;
  completedEpisodes: Array<{ chapterId: string; completedAt: string }>;
};

type ChapterSummary = { id: string; title: string; synopsis: string };

export type StoryAccessState =
  | { state: "unavailable" }
  | { state: "playable"; chapter: StoryChapter; progress: StoryProgress; episodeIndex: number; episodeCount: number }
  | { state: "locked"; completedChapter: ChapterSummary; nextChapter: Omit<ChapterSummary, "id">; unlocksAt: string }
  | { state: "season-complete"; completedChapter: ChapterSummary };

const HISTORY_CAP = 60;
const COMPLETED_EPISODES_CAP = 50;

function dayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function summarize(chapter: StoryChapter): ChapterSummary {
  return { id: chapter.id, title: chapter.title, synopsis: chapter.synopsis };
}

function freshProgress(chapter: StoryChapter): StoryProgress {
  const firstSceneId = chapter.sceneOrder[0];
  const firstScene = chapter.scenes[firstSceneId];
  const now = new Date().toISOString();
  return {
    chapterId: chapter.id,
    currentSceneId: firstSceneId,
    currentBeatId: firstScene.startBeatId,
    completedSceneIds: [],
    choices: [],
    writingResponses: [],
    history: [],
    startedAt: now,
    lastPlayedAt: now,
  };
}

function isChapterComplete(chapter: StoryChapter, progress: StoryProgress): boolean {
  return progress.completedSceneIds.includes(chapter.sceneOrder[chapter.sceneOrder.length - 1]);
}

async function readPlan(studentId: string): Promise<Record<string, unknown>> {
  const existing = await prisma.personalizedPlan.findUnique({ where: { studentId }, select: { plan: true } });
  if (!existing) return {};
  try {
    return JSON.parse(existing.plan) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * A student's progress may still be in the OLD flat per-chapter shape (no
 * `currentEpisodeIndex`) if they played before episodes existed. Detected by
 * the absence of that field — wrapped as "episode 0, no completions yet"
 * rather than backfilled by a script, since this is a JSON blob, not a
 * queryable table. `resolveAccess` below is what actually decides, on this
 * same read, whether that wrapped progress is already finished and — if so —
 * backdates its completion to `lastPlayedAt`, the closest real signal that
 * already exists on the old data.
 */
function coerceSeriesProgress(raw: unknown, series: StoryChapter[]): StorySeriesProgress {
  if (raw && typeof raw === "object" && "currentEpisodeIndex" in raw) {
    return raw as StorySeriesProgress;
  }
  if (raw && typeof raw === "object" && "chapterId" in raw) {
    const legacy = raw as StoryProgress;
    const episodeIndex = Math.max(0, series.findIndex((chapter) => chapter.id === legacy.chapterId));
    const chapter = series[episodeIndex] ?? series[0];
    const completedEpisodes: StorySeriesProgress["completedEpisodes"] = [];
    if (isChapterComplete(chapter, legacy)) {
      completedEpisodes.push({ chapterId: chapter.id, completedAt: legacy.lastPlayedAt });
    }
    return { currentEpisodeIndex: episodeIndex, progress: legacy, completedEpisodes };
  }
  return { currentEpisodeIndex: 0, progress: freshProgress(series[0]), completedEpisodes: [] };
}

/**
 * The one function that decides both "has the active episode just finished"
 * and "is the next one unlocked yet" — kept together on purpose. Reseeding
 * `sp.progress` to the next episode IS the unlock grant: it only happens
 * inside the branch that has already checked the day has turned over, so
 * next-episode content structurally cannot leak into a response before the
 * gate opens (there's no separate "mark complete" step that could race a
 * separate "hand back progress" step).
 */
function resolveAccess(series: StoryChapter[], sp: StorySeriesProgress): StoryAccessState {
  const active = series[sp.currentEpisodeIndex];
  if (!sp.completedEpisodes.some((e) => e.chapterId === active.id) && isChapterComplete(active, sp.progress)) {
    sp.completedEpisodes.push({ chapterId: active.id, completedAt: new Date().toISOString() });
  }

  const done = sp.completedEpisodes.find((e) => e.chapterId === active.id);
  if (!done) {
    return { state: "playable", chapter: active, progress: sp.progress, episodeIndex: sp.currentEpisodeIndex, episodeCount: series.length };
  }

  const next = series[sp.currentEpisodeIndex + 1];
  if (!next) return { state: "season-complete", completedChapter: summarize(active) };

  if (dayKey(new Date()) > dayKey(new Date(done.completedAt))) {
    sp.currentEpisodeIndex += 1;
    sp.progress = freshProgress(next);
    return { state: "playable", chapter: next, progress: sp.progress, episodeIndex: sp.currentEpisodeIndex, episodeCount: series.length };
  }

  const unlocksAt = new Date();
  unlocksAt.setUTCHours(24, 0, 0, 0);
  return {
    state: "locked",
    completedChapter: summarize(active),
    nextChapter: { title: next.title, synopsis: next.synopsis },
    unlocksAt: unlocksAt.toISOString(),
  };
}

/** Read-only: resolves current access without persisting the migration/rollover. For the GET route, mission detection, and daily-mission gating. */
export async function getStoryAccess(studentId: string, goalId: string, series: StoryChapter[]): Promise<StoryAccessState> {
  const plan = await readPlan(studentId);
  const stored = plan.storyProgress && typeof plan.storyProgress === "object" ? (plan.storyProgress as Record<string, unknown>)[goalId] : undefined;
  if (!stored) return { state: "playable", chapter: series[0], progress: freshProgress(series[0]), episodeIndex: 0, episodeCount: series.length };
  const sp = coerceSeriesProgress(stored, series);
  return resolveAccess(series, sp);
}

/** Mutating: the version advance/write routes use — persists any migration/rollover it performs, and returns the live series progress to mutate further. */
export async function getPlayableEpisode(
  studentId: string,
  goalId: string,
  series: StoryChapter[],
): Promise<{ seriesProgress: StorySeriesProgress; chapter: StoryChapter } | null> {
  const plan = await readPlan(studentId);
  const stored = plan.storyProgress && typeof plan.storyProgress === "object" ? (plan.storyProgress as Record<string, unknown>)[goalId] : undefined;
  const sp = stored ? coerceSeriesProgress(stored, series) : { currentEpisodeIndex: 0, progress: freshProgress(series[0]), completedEpisodes: [] };

  const access = resolveAccess(series, sp);
  await saveSeriesProgress(studentId, goalId, sp);
  if (access.state !== "playable") return null;
  return { seriesProgress: sp, chapter: access.chapter };
}

/** Re-resolves access after advance/write mutated `sp.progress` in place — call this, then persist with saveSeriesProgress. */
export function describeAccessAfterMutation(series: StoryChapter[], sp: StorySeriesProgress): StoryAccessState {
  return resolveAccess(series, sp);
}

/**
 * Moves progress to whatever comes after a completed beat: the next beat in
 * the same scene, or the next scene's opening beat when this beat ends the
 * scene. Shared by the advance and write routes so scene-completion logic
 * exists in exactly one place. Unchanged by the series/episode layer above —
 * this only ever touches the single active episode's StoryProgress.
 */
export function advanceStoryPosition(chapter: StoryChapter, progress: StoryProgress, sceneId: string, nextBeatId: string | null): void {
  if (nextBeatId) {
    progress.currentBeatId = nextBeatId;
    return;
  }
  if (!progress.completedSceneIds.includes(sceneId)) progress.completedSceneIds.push(sceneId);
  const currentIndex = chapter.sceneOrder.indexOf(sceneId);
  const nextSceneId = chapter.sceneOrder[currentIndex + 1];
  if (nextSceneId) {
    progress.currentSceneId = nextSceneId;
    progress.currentBeatId = chapter.scenes[nextSceneId].startBeatId;
  }
  // else: scene was the episode's last — currentBeatId stays on the final
  // beat; resolveAccess() is what notices completion and rolls to the next
  // episode (or locks/season-completes), not this function.
}

export async function saveSeriesProgress(studentId: string, goalId: string, sp: StorySeriesProgress): Promise<void> {
  const existing = await prisma.personalizedPlan.findUnique({ where: { studentId }, select: { plan: true } });
  let plan: Record<string, unknown> = {};
  try {
    plan = existing ? (JSON.parse(existing.plan) as Record<string, unknown>) : {};
  } catch {
    plan = {};
  }
  const previousStoryProgress = (plan.storyProgress && typeof plan.storyProgress === "object" ? plan.storyProgress : {}) as Record<string, unknown>;

  const trimmed: StorySeriesProgress = {
    ...sp,
    progress: { ...sp.progress, history: sp.progress.history.slice(-HISTORY_CAP), lastPlayedAt: new Date().toISOString() },
    completedEpisodes: sp.completedEpisodes.slice(-COMPLETED_EPISODES_CAP),
  };
  plan.storyProgress = { ...previousStoryProgress, [goalId]: trimmed };

  await prisma.personalizedPlan.upsert({
    where: { studentId },
    update: { plan: JSON.stringify(plan) },
    create: { studentId, plan: JSON.stringify(plan) },
  });
}
