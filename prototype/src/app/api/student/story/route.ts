import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { storyChapterFor } from "@/lib/story/content";
import { getOrStartStoryProgress } from "@/lib/story-progress";
import type { StoryChapter } from "@/lib/story/types";

export const dynamic = "force-dynamic";

/** exampleAnswer is grading-only — stripping it before the response is what keeps this an answer key, not a leak. */
function stripAnswers(chapter: StoryChapter): StoryChapter {
  const scenes = Object.fromEntries(
    Object.entries(chapter.scenes).map(([sceneId, scene]) => [
      sceneId,
      {
        ...scene,
        beats: Object.fromEntries(
          Object.entries(scene.beats).map(([beatId, beat]) => [
            beatId,
            beat.type === "write" ? { ...beat, exampleAnswer: undefined } : beat,
          ]),
        ),
      },
    ]),
  );
  return { ...chapter, scenes };
}

export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: { id: true, germanyGoal: true },
  });
  if (!student) return NextResponse.json({ available: false });

  const chapter = storyChapterFor(student.germanyGoal);
  if (!chapter) return NextResponse.json({ available: false });

  const progress = await getOrStartStoryProgress(student.id, chapter.goalId, chapter);
  return NextResponse.json({ available: true, chapter: stripAnswers(chapter), progress });
}
