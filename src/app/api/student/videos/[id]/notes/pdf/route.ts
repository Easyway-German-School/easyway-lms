import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildTranscriptPdf } from "@/lib/transcript-pdf";
import { findOwnedRecordingMaterial } from "@/lib/class-notes-access";
import type { ClassNotes } from "@/lib/class-transcription";

export const dynamic = "force-dynamic";

/** "Export as PDF" — generated on request, not pre-stored: pdf-lib is fast enough that caching a file per student per class is not worth the bucket space. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({ where: { userId: session.user.id } });
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });

  const material = await findOwnedRecordingMaterial(id, student);
  if (!material) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const transcript = material.recording?.transcript;
  if (!transcript || (transcript.status !== "ready" && !transcript.transcriptText)) {
    return NextResponse.json({ error: "Notes are not ready for this class yet" }, { status: 409 });
  }

  const notes: ClassNotes | null =
    transcript.status === "ready"
      ? {
          summary: transcript.summary || "",
          keyPoints: (transcript.keyPoints as string[] | null) ?? [],
          actionItems: (transcript.actionItems as string[] | null) ?? [],
          vocabulary: (transcript.vocabulary as Array<{ de: string; en: string; note?: string }> | null) ?? [],
          corrections: transcript.isPrivate ? ((transcript.corrections as Array<{ mistake: string; correction: string; note?: string }> | null) ?? []) : undefined,
          progressHighlights: transcript.isPrivate ? ((transcript.progressHighlights as string[] | null) ?? []) : undefined,
        }
      : null;

  const pdf = await buildTranscriptPdf({
    title: material.title,
    level: material.level ?? material.course?.level ?? null,
    recordedAt: material.recordedAt,
    notes,
    transcriptText: transcript.transcriptText,
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${material.title.replace(/[^a-zA-Z0-9 -]/g, "").trim() || "class-notes"}.pdf"`,
    },
  });
}
