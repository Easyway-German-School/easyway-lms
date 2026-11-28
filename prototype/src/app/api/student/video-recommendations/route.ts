import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notExpiredForStudents } from "@/lib/retention";
import { callModel } from "@/lib/ai";
import { parseModelJson } from "@/lib/safe-json";
import { profileFor } from "@/lib/learner-intelligence";
import { goalFor, isKnownGoal } from "@/lib/germany-goals";

export const dynamic = "force-dynamic";

type Recommendation = {
  videoId: string;
  reason: string;
  priority: number;
};

function deterministicRecommendations(
  videos: Array<{
    id: string;
    title: string;
    kind: string;
    positionSeconds: number;
    durationSeconds: number | null;
    completed: boolean;
    recordedAt: string | null;
  }>,
  goalLabel: string | null,
): Recommendation[] {
  return videos
    .map((video, index) => {
      const unfinished = !video.completed;
      const inProgress = video.positionSeconds > 30;
      const recent = video.recordedAt ? new Date(video.recordedAt).getTime() : 0;
      let reason = inProgress
        ? "Continue where you stopped."
        : video.kind === "recording"
          ? "A recent class recording for your level."
          : "A focused lesson for your current level.";
      if (!inProgress && goalLabel && video.kind === "recording") {
        reason = `Keeps you moving toward: ${goalLabel.replace(/^I am /, "").replace(/\.$/, "")}.`;
      }
      return {
        videoId: video.id,
        priority:
          (inProgress ? 40 : 0) +
          (unfinished ? 25 : -20) +
          (video.kind === "recording" ? 15 : 0) +
          Math.min(20, Math.max(0, Date.now() - recent <= 14 * 86400000 ? 20 : 0)) -
          index,
        reason,
      };
    })
    .sort((left, right) => right.priority - left.priority)
    .slice(0, 3);
}

export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const student = await prisma.student.findUnique({
      where: { userId: session.user.id },
      select: {
        id: true,
        level: true,
        pathway: true,
        germanyGoal: true,
        germanyGoalNote: true,
        examReadiness: true,
        user: { select: { name: true } },
      },
    });
    if (!student) return NextResponse.json({ recommendations: [] });

    const goalLabel = isKnownGoal(student.germanyGoal) ? goalFor(student.germanyGoal).label : null;

    let behaviourSummary = "";
    try {
      const firstName = (student.user?.name ?? "").trim().split(/\s+/)[0] || undefined;
      behaviourSummary = (await profileFor(session.user.id as string, firstName)).summary;
    } catch {
      behaviourSummary = "";
    }

    const records = await prisma.material.findMany({
      where: {
        kind: { in: ["video", "recording"] },
        OR: [{ level: student.level }, { course: { level: student.level } }],
        ...notExpiredForStudents(),
      },
      include: {
        course: { select: { title: true, level: true } },
        videoProgress: { where: { studentId: student.id }, take: 1 },
      },
      orderBy: [{ recordedAt: "desc" }, { createdAt: "desc" }],
      take: 40,
    });

    const candidates = records.map((record) => {
      const progress = record.videoProgress[0];
      return {
        id: record.id,
        title: record.title,
        description: record.description,
        aiSummary: record.aiSummary,
        kind: record.kind,
        level: record.level ?? record.course?.level ?? student.level,
        courseTitle: record.course?.title ?? null,
        recordedAt: record.recordedAt?.toISOString() ?? record.createdAt.toISOString(),
        positionSeconds: progress?.positionSeconds ?? 0,
        durationSeconds: record.durationSeconds,
        completed: progress?.completed ?? false,
      };
    });

    const fallback = deterministicRecommendations(candidates, goalLabel);
    const prompt = `You recommend German learning videos for one student. Choose ONLY from the candidate IDs below. Never invent an ID.

Student:
${JSON.stringify({
  name: student.user.name,
  level: student.level,
  pathway: student.pathway,
  germanyGoal: student.germanyGoal,
  goalLabel,
  goalNote: student.germanyGoalNote,
  examReadiness: student.examReadiness,
  behaviourSummary: behaviourSummary || null,
})}

Candidates:
${JSON.stringify(
  candidates.map(
    ({ id, title, description, aiSummary, kind, level, courseTitle, recordedAt, positionSeconds, durationSeconds, completed }) => ({
      id,
      title,
      description,
      aiSummary,
      kind,
      level,
      courseTitle,
      recordedAt,
      positionSeconds,
      durationSeconds,
      completed,
    }),
  ),
)}

Return ONLY JSON: {"recommendations":[{"videoId":"candidate id","reason":"one short student-friendly sentence","priority":1}]}
Rules: recommend at most 3; prefer unfinished or in-progress videos; prefer recent class recordings; connect the reason to the student's Germany goal or study rhythm when the candidate supports it; do not recommend completed videos unless there is no better option.`;

    const raw = await callModel(prompt, 900, "student");
    const parsed = parseModelJson<{
      recommendations?: Array<{ videoId?: unknown; reason?: unknown; priority?: unknown }>;
    }>(raw);
    const allowed = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const recommendations = Array.isArray(parsed?.recommendations)
      ? parsed.recommendations
          .map((item) => ({
            videoId: String(item.videoId ?? ""),
            reason: String(item.reason ?? "").trim(),
            priority: Number(item.priority ?? 0),
          }))
          .filter((item) => allowed.has(item.videoId) && item.reason)
          .slice(0, 3)
      : fallback;

    return NextResponse.json({
      recommendations,
      videos: recommendations.map((item) => allowed.get(item.videoId)).filter(Boolean),
      source: recommendations === fallback ? "deterministic" : "claude",
    });
  } catch (error) {
    console.error("Video recommendations failed", error);
    return NextResponse.json({ recommendations: [] }, { status: 200 });
  }
}
