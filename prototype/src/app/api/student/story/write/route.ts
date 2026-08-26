import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { storyChapterFor } from "@/lib/story/content";
import { advanceStoryPosition, getStoryProgress, saveStoryProgress } from "@/lib/story-progress";
import { gradeStoryWriting } from "@/lib/ai";
import { reserveStudentAiRequest } from "@/lib/ai-limits";
import { recordSkillOutcome } from "@/lib/skill-mastery";

export const dynamic = "force-dynamic";
const MAX_RESPONSE_LENGTH = 2000;

export async function POST(request: NextRequest) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const quota = await reserveStudentAiRequest(session.user.id, "storyWriting");
  if (!quota.allowed) return NextResponse.json({ error: "Daily writing-practice limit reached. Try again tomorrow." }, { status: 429 });

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: { id: true, germanyGoal: true },
  });
  if (!student) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const chapter = storyChapterFor(student.germanyGoal);
  if (!chapter) return NextResponse.json({ error: "No story available" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { sceneId?: unknown; beatId?: unknown; response?: unknown } | null;
  const sceneId = typeof body?.sceneId === "string" ? body.sceneId : "";
  const beatId = typeof body?.beatId === "string" ? body.beatId : "";
  const response = typeof body?.response === "string" ? body.response.trim() : "";
  if (!response) return NextResponse.json({ error: "A written response is required." }, { status: 400 });
  if (response.length > MAX_RESPONSE_LENGTH) return NextResponse.json({ error: "Keep it under 2000 characters." }, { status: 400 });

  const progress = await getStoryProgress(student.id, chapter.goalId);
  if (!progress) return NextResponse.json({ error: "No progress found — load the story first." }, { status: 409 });
  if (progress.currentSceneId !== sceneId || progress.currentBeatId !== beatId) {
    return NextResponse.json({ error: "This beat is no longer current." }, { status: 409 });
  }

  const scene = chapter.scenes[sceneId];
  const beat = scene?.beats[beatId];
  if (!scene || !beat || beat.type !== "write") return NextResponse.json({ error: "Invalid beat." }, { status: 400 });

  const graded = await gradeStoryWriting({
    prompt: beat.prompt,
    promptGerman: beat.promptGerman,
    response,
    goalId: chapter.goalId,
    sceneTitle: scene.title,
  });

  const masteryBefore = await prisma.studentSkillMastery.findUnique({
    where: { studentId_skill: { studentId: student.id, skill: "writing" } },
    select: { mastery: true },
  });
  await recordSkillOutcome({ studentId: student.id, skill: "writing", score: graded.score });
  const masteryAfter = await prisma.studentSkillMastery.findUnique({
    where: { studentId_skill: { studentId: student.id, skill: "writing" } },
    select: { mastery: true },
  });

  const now = new Date().toISOString();
  progress.writingResponses.push({ sceneId, beatId, prompt: beat.prompt, response, score: graded.score, feedback: graded.feedback, at: now });
  progress.history.push({ sceneId, beatId, type: "write", at: now });
  advanceStoryPosition(chapter, progress, sceneId, beat.next);
  await saveStoryProgress(student.id, chapter.goalId, progress);

  return NextResponse.json({
    score: graded.score,
    feedback: graded.feedback,
    corrections: graded.corrections,
    achievementTitle: graded.achievementTitle,
    masteryBefore: masteryBefore?.mastery ?? null,
    masteryAfter: masteryAfter?.mastery ?? null,
    progress,
  });
}
