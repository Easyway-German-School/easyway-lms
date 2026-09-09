import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * "Why is there nothing in My Notes?" — answered for the office.
 *
 * The class-notes pipeline (lib/class-transcription.ts, driven by the cron
 * tick) turns a finished class recording into a transcript, a summary and the
 * vocabulary that class taught. When a student opens My Notes and sees
 * nothing, the cause is almost always one of:
 *
 *   - no class was recorded (the tutor never started a live room, or started
 *     it and it never reached `completed`) — so there is nothing to transcribe;
 *   - recordings exist but the transcripts are still queued — the cron is
 *     behind, or not running;
 *   - a transcript failed, or the recording was silent / too large.
 *
 * This reports each of those as a number the office can act on, plus whether
 * hosted transcription is even switched on (GROQ_API_KEY). It is read-only.
 */

const WINDOW_DAYS = 30;

export async function GET() {
  const gate = await requireCapability("classes");
  if (!gate.ok) return gate.response;

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // The same set the transcription queue considers: a finished recording,
  // attached to a Material, inside the window it looks back over.
  const eligible = await prisma.classRecording.findMany({
    where: { status: "completed", materialId: { not: null }, startedAt: { gte: since } },
    select: {
      id: true,
      startedAt: true,
      privateClassId: true,
      material: { select: { title: true, level: true } },
      transcript: { select: { status: true, error: true, updatedAt: true } },
    },
    orderBy: { startedAt: "desc" },
  });

  const byStatus: Record<string, number> = {};
  let noTranscriptYet = 0;
  const failures: Array<{
    title: string;
    level: string | null;
    isPrivate: boolean;
    status: string;
    error: string | null;
    when: string;
  }> = [];

  for (const rec of eligible) {
    const t = rec.transcript;
    if (!t) {
      noTranscriptYet += 1;
      continue;
    }
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    if (
      (t.status === "failed" || t.status === "skipped_too_large" || t.status === "none") &&
      failures.length < 8
    ) {
      failures.push({
        title: rec.material?.title ?? "Untitled class",
        level: rec.material?.level ?? null,
        isPrivate: Boolean(rec.privateClassId),
        status: t.status,
        error: t.error ?? null,
        when: (t.updatedAt ?? rec.startedAt).toISOString(),
      });
    }
  }

  // Recordings not yet in scope, so "nothing recorded" is distinguishable
  // from "recorded but stuck".
  const incompleteRecordings = await prisma.classRecording.count({
    where: { status: { not: "completed" }, startedAt: { gte: since } },
  });

  return NextResponse.json({
    windowDays: WINDOW_DAYS,
    transcriptionConfigured: Boolean(process.env.GROQ_API_KEY),
    whisperModel: process.env.GROQ_WHISPER_MODEL || "whisper-large-v3-turbo",
    eligibleRecordings: eligible.length,
    incompleteRecordings,
    ready: byStatus.ready ?? 0,
    inProgress:
      (byStatus.pending ?? 0) +
      (byStatus.transcribing ?? 0) +
      (byStatus.summarizing ?? 0) +
      noTranscriptYet,
    noTranscriptYet,
    failed: byStatus.failed ?? 0,
    skippedTooLarge: byStatus.skipped_too_large ?? 0,
    noSpeech: byStatus.none ?? 0,
    byStatus,
    failures,
  });
}
