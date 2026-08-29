import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { personalFocusLine } from "@/lib/class-transcription";
import { findOwnedRecordingMaterial } from "@/lib/class-notes-access";

export const dynamic = "force-dynamic";

/**
 * The Happy-Scribe panel for one recording: summary, key points, action
 * items, vocabulary, the full transcript, and Becca's one personalised line.
 * Private lessons additionally get corrections and progress highlights — see
 * the module comment on `ClassTranscript.isPrivate` for why those are only
 * ever generated for a private, two-voice recording.
 *
 * Deliberately its own endpoint rather than folded into `/api/student/videos`
 * — that list loads every video on the shelf at once, and this is the one
 * field expensive enough (a lazily-generated, per-student model call) that it
 * must only ever run for the single recording a student actually opened.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const session = await requireAuthSession();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const student = await prisma.student.findUnique({ where: { userId: session.user.id } });
    if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });

    const material = await findOwnedRecordingMaterial(id, student);
    if (!material) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const transcript = material.recording?.transcript;
    if (!transcript || transcript.status !== "ready") {
      return NextResponse.json({ status: transcript?.status ?? "none", isPrivate: Boolean(material.recording?.privateClassId) });
    }

    const notes = {
      summary: transcript.summary,
      keyPoints: (transcript.keyPoints as string[] | null) ?? [],
      actionItems: (transcript.actionItems as string[] | null) ?? [],
      vocabulary: (transcript.vocabulary as Array<{ de: string; en: string; note?: string }> | null) ?? [],
      corrections: transcript.isPrivate ? ((transcript.corrections as Array<{ mistake: string; correction: string; note?: string }> | null) ?? []) : [],
      progressHighlights: transcript.isPrivate ? ((transcript.progressHighlights as string[] | null) ?? []) : [],
    };

    const personalFocus = await personalFocusLine(session.user.id, {
      id: transcript.id,
      vocabulary: notes.vocabulary,
      summary: notes.summary || "",
      corrections: notes.corrections,
    }).catch(() => null);

    return NextResponse.json({
      status: "ready",
      isPrivate: transcript.isPrivate,
      notes,
      personalFocus,
      generatedAt: transcript.generatedAt,
      transcriptText: transcript.transcriptText,
      // Real ASR timestamps, for click-to-seek — and the coarse tutor/student
      // guess over their indices, for both group and private classes alike.
      segments: (transcript.segments as Array<{ start: number; end: number; text: string }> | null) ?? [],
      speakerRanges: (transcript.speakerRanges as Array<{ from: number; to: number; speaker: "tutor" | "student" }> | null) ?? [],
    });
  } catch (error) {
    console.error("Failed to load class notes", error);
    return NextResponse.json({ error: "Failed to load class notes" }, { status: 500 });
  }
}
