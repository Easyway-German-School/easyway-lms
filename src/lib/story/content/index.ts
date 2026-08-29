import type { GoalId } from "@/lib/germany-goals";
import { goalFor } from "@/lib/germany-goals";
import type { StoryChapter } from "@/lib/story/types";
import { careEpisode1 } from "@/lib/story/content/care/episode-1";
import { careEpisode2 } from "@/lib/story/content/care/episode-2";
import { ausbildungEpisode1 } from "@/lib/story/content/ausbildung/episode-1";
import { ausbildungEpisode2 } from "@/lib/story/content/ausbildung/episode-2";
import { workEpisode1 } from "@/lib/story/content/work/episode-1";
import { workEpisode2 } from "@/lib/story/content/work/episode-2";
import { studyEpisode1 } from "@/lib/story/content/study/episode-1";
import { studyEpisode2 } from "@/lib/story/content/study/episode-2";

/**
 * Four goal tracks have a story series so far — the "real professional work"
 * tracks with a genuine institutional first day (care, ausbildung, work,
 * study). Every other goal (family/aupair/settle/explore, and any
 * unset/unknown goal, which goalFor() resolves to "custom") falls through to
 * null here, which is the single place the "no regression for every other
 * track" promise lives — they stay on the voice-only GenericTandemChat.
 *
 * Each entry is an ORDERED array of episodes, not a single chapter — episode
 * N+1 unlocks the day after episode N completes (see story-progress.ts).
 * Adding episode 3+ later is a content-only change: append to the array.
 */
export const STORY_SERIES: Partial<Record<GoalId, StoryChapter[]>> = {
  care: [careEpisode1, careEpisode2],
  ausbildung: [ausbildungEpisode1, ausbildungEpisode2],
  work: [workEpisode1, workEpisode2],
  study: [studyEpisode1, studyEpisode2],
};

export function storySeriesFor(goalId: string | null | undefined): StoryChapter[] | null {
  const series = STORY_SERIES[goalFor(goalId).id];
  return series?.length ? series : null;
}
