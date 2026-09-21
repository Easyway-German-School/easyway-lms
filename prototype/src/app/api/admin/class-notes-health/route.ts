import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";
import { ffmpegHealth } from "@/lib/audio-extract";
import { activeModelName } from "@/lib/ai";
import { EXTRACTIVE_PROVIDER } from "@/lib/class-transcription";

export const dynamic = "force-dynamic";
// Streaming a large recording out of the bucket, extracting its audio, then an
// ASR + summary call each — the slowest thing the app does. 300s is the Pro
// plan's ceiling and this needs most of it when a class ran to a full GB.
export const maxDuration = 120;

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
      durationSeconds: true,
      material: { select: { title: true, level: true } },
      transcript: { select: { status: true, error: true, updatedAt: true, provider: true, transcribedUntil: true } },
    },
    orderBy: { startedAt: "desc" },
  });

  const byStatus: Record<string, number> = {};
  let noTranscriptYet = 0;
  /** Ready, but written by plain extraction while no AI model was reachable. */
  let outlines = 0;
  /** Recordings transcribed part of the way — how much of their audio is done. */
  let partialCount = 0;
  let partialDone = 0;
  let partialTotal = 0;
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
    if (t.status === "ready" && t.provider === EXTRACTIVE_PROVIDER) outlines += 1;
    if (t.status === "partial") {
      partialCount += 1;
      const total = rec.durationSeconds ?? 0;
      partialDone += Math.min(t.transcribedUntil ?? 0, total);
      partialTotal += total;
    }
    if (
      // A part-way recording only counts as a problem when it has something to say —
      // "the read was too slow" — otherwise it is simply still working.
      (t.status === "failed" || t.status === "skipped_too_large" || t.status === "none" || (t.status === "partial" && t.error)) &&
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

  // The document side (uploaded handouts → "Ready-made notes"), by state.
  const docRows = await prisma.material.groupBy({
    by: ["aiState"],
    where: {
      kind: { notIn: ["recording", "audio", "video"] },
      createdAt: { gte: since },
    },
    _count: { _all: true },
  });
  const docsByState: Record<string, number> = {};
  for (const row of docRows) docsByState[row.aiState] = row._count._all;
  const docsAwaitingReview = await prisma.material.count({
    where: {
      kind: { notIn: ["recording", "audio", "video"] },
      createdAt: { gte: since },
      aiState: "ready",
      questsReviewedAt: null,
    },
  });

  return NextResponse.json({
    windowDays: WINDOW_DAYS,
    transcriptionConfigured: Boolean(process.env.GROQ_API_KEY),
    whisperModel: process.env.GROQ_WHISPER_MODEL || "whisper-large-v3-turbo",
    // Does ffmpeg actually run in this environment — the thing large-recording
    // transcription depends on.
    ffmpeg: await ffmpegHealth(),
    eligibleRecordings: eligible.length,
    incompleteRecordings,
    ready: byStatus.ready ?? 0,
    outlines,
    partial: { count: partialCount, percent: partialTotal > 0 ? Math.round((partialDone / partialTotal) * 100) : 0 },
    // Which model would write the next recap — so "why is it an outline?" has an answer.
    notesModel: activeModelName("learning-content"),
    inProgress:
      (byStatus.pending ?? 0) +
      (byStatus.partial ?? 0) +
      (byStatus.transcribing ?? 0) +
      (byStatus.summarizing ?? 0) +
      noTranscriptYet,
    noTranscriptYet,
    failed: byStatus.failed ?? 0,
    skippedTooLarge: byStatus.skipped_too_large ?? 0,
    noSpeech: byStatus.none ?? 0,
    byStatus,
    failures,
    // Everything still waiting for the queue — what the background run is working down.
    backlog: await (await import("@/lib/class-notes-runner")).countBacklog(),
    documents: {
      byState: docsByState,
      ready: docsByState.ready ?? 0,
      pending: (docsByState.none ?? 0) + (docsByState.pending ?? 0),
      failed: docsByState.failed ?? 0,
      skipped: docsByState.skipped ?? 0,
      awaitingTutorReview: docsAwaitingReview,
    },
  });
}

/**
 * POST — start working the backlog NOW, in the background.
 *
 * This used to run a batch inside the request and rely on the browser to keep
 * pressing until the queue was empty, so closing the tab stopped it and a batch
 * that took too long came back as a 504. It now just STARTS the same
 * self-driving run the daily tick and the end of every recorded class start
 * (lib/class-notes-runner.ts): the run happens in its own function, works one
 * item at a time inside a time budget, and keeps re-starting itself while it is
 * getting somewhere. Pressing this and closing the page is fine.
 *
 * Nothing about WHAT gets written changes: `generateTranscriptForRecording`
 * still notifies the class as each recap lands, and `processMaterialQueue`
 * still routes a written-up handout to its tutor for sign-off (students are
 * told when the tutor approves, `KIND.studyNotesReady`). No review gate is
 * bypassed.
 */
export async function POST() {
  const gate = await requireCapability("classes");
  if (!gate.ok) return gate.response;

  const { kickClassNotes, runClassNotes, countBacklog } = await import("@/lib/class-notes-runner");

  if (await kickClassNotes()) {
    const left = await countBacklog();
    return NextResponse.json({ started: true, remaining: left.recordings + left.documents });
  }

  // No secret or public address to call ourselves on (local dev): do a short,
  // bounded run right here instead, so the button still does something.
  const summary = await runClassNotes({ budgetMs: 100_000 });
  return NextResponse.json({ started: false, inline: true, ...summary });
}
