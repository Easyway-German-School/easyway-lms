import type { GoalId } from "@/lib/germany-goals";
import { goalFor } from "@/lib/germany-goals";
import type { StoryChapter } from "@/lib/story/types";
import { careChapter } from "@/lib/story/content/care";

/**
 * One goal track has a story so far — the "care" pilot. Every other goal
 * (and any unset/unknown goal, which goalFor() resolves to "custom") falls
 * through to null here, which is the single place the "no regression for
 * every other track" promise lives.
 */
export const STORY_CHAPTERS: Partial<Record<GoalId, StoryChapter>> = {
  care: careChapter,
};

export function storyChapterFor(goalId: string | null | undefined): StoryChapter | null {
  return STORY_CHAPTERS[goalFor(goalId).id] ?? null;
}
