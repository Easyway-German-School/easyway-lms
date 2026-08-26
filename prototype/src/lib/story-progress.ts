import { prisma } from "@/lib/prisma";
import type { StoryChapter } from "@/lib/story/types";

/**
 * Per-student progress through a personalized story chapter, stored the same
 * way voice-coach-memory.ts stores pronunciation history: a namespaced key
 * inside PersonalizedPlan.plan (one flexible JSON blob per student) rather
 * than a new table — this is progress on curated content, not a new kind of
 * record the rest of the app needs to query relationally.
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

const HISTORY_CAP = 60;

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

async function readPlan(studentId: string): Promise<Record<string, unknown>> {
  const existing = await prisma.personalizedPlan.findUnique({ where: { studentId }, select: { plan: true } });
  if (!existing) return {};
  try {
    return JSON.parse(existing.plan) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Returns existing progress for this goal's chapter, or a freshly-started one if none exists yet. */
export async function getOrStartStoryProgress(studentId: string, goalId: string, chapter: StoryChapter): Promise<StoryProgress> {
  const plan = await readPlan(studentId);
  const storyProgress = (plan.storyProgress && typeof plan.storyProgress === "object" ? plan.storyProgress : {}) as Record<string, StoryProgress>;
  const existing = storyProgress[goalId];
  if (existing && existing.chapterId === chapter.id) return existing;

  const started = freshProgress(chapter);
  await saveStoryProgress(studentId, goalId, started);
  return started;
}

export async function getStoryProgress(studentId: string, goalId: string): Promise<StoryProgress | null> {
  const plan = await readPlan(studentId);
  const storyProgress = (plan.storyProgress && typeof plan.storyProgress === "object" ? plan.storyProgress : {}) as Record<string, StoryProgress>;
  return storyProgress[goalId] ?? null;
}

/**
 * Moves progress to whatever comes after a completed beat: the next beat in
 * the same scene, or the next scene's opening beat when this beat ends the
 * scene. Shared by the advance and write routes so scene-completion logic
 * exists in exactly one place.
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
  // else: chapter complete — currentBeatId stays on the final beat; the
  // client treats completedSceneIds.length === chapter.sceneOrder.length as done.
}

export async function saveStoryProgress(studentId: string, goalId: string, progress: StoryProgress): Promise<void> {
  const existing = await prisma.personalizedPlan.findUnique({ where: { studentId }, select: { plan: true } });
  let plan: Record<string, unknown> = {};
  try { plan = existing ? JSON.parse(existing.plan) as Record<string, unknown> : {}; } catch { plan = {}; }
  const previousStoryProgress = (plan.storyProgress && typeof plan.storyProgress === "object" ? plan.storyProgress : {}) as Record<string, StoryProgress>;

  const trimmed: StoryProgress = { ...progress, history: progress.history.slice(-HISTORY_CAP), lastPlayedAt: new Date().toISOString() };
  plan.storyProgress = { ...previousStoryProgress, [goalId]: trimmed };

  await prisma.personalizedPlan.upsert({
    where: { studentId },
    update: { plan: JSON.stringify(plan) },
    create: { studentId, plan: JSON.stringify(plan) },
  });
}
