import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { storyChapterFor } from "@/lib/story/content";
import { advanceStoryPosition, getStoryProgress, saveStoryProgress } from "@/lib/story-progress";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: { id: true, germanyGoal: true },
  });
  if (!student) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const chapter = storyChapterFor(student.germanyGoal);
  if (!chapter) return NextResponse.json({ error: "No story available" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { sceneId?: unknown; beatId?: unknown; choiceOptionId?: unknown } | null;
  const sceneId = typeof body?.sceneId === "string" ? body.sceneId : "";
  const beatId = typeof body?.beatId === "string" ? body.beatId : "";
  const choiceOptionId = typeof body?.choiceOptionId === "string" ? body.choiceOptionId : undefined;

  const progress = await getStoryProgress(student.id, chapter.goalId);
  if (!progress) return NextResponse.json({ error: "No progress found — load the story first." }, { status: 409 });

  // Only ever advance from where the server thinks the student actually is.
  // A stale sceneId/beatId (a duplicate click, a resumed tab) is a no-op that
  // just returns current progress, never trusted as new state.
  if (progress.currentSceneId !== sceneId || progress.currentBeatId !== beatId) {
    return NextResponse.json({ progress });
  }

  const scene = chapter.scenes[sceneId];
  const beat = scene?.beats[beatId];
  if (!scene || !beat) return NextResponse.json({ error: "Invalid scene or beat." }, { status: 400 });
  if (beat.type === "write") return NextResponse.json({ error: "Use /api/student/story/write for this beat." }, { status: 400 });

  let nextBeatId: string | null;
  if (beat.type === "choice") {
    const option = beat.options.find((candidate) => candidate.id === choiceOptionId);
    if (!option) return NextResponse.json({ error: "Invalid choice." }, { status: 400 });
    nextBeatId = option.next;
    progress.choices.push({ sceneId, beatId, optionId: option.id, at: new Date().toISOString() });
  } else {
    nextBeatId = beat.next;
  }

  progress.history.push({ sceneId, beatId, type: beat.type, at: new Date().toISOString() });
  advanceStoryPosition(chapter, progress, sceneId, nextBeatId);
  await saveStoryProgress(student.id, chapter.goalId, progress);

  return NextResponse.json({ progress });
}
