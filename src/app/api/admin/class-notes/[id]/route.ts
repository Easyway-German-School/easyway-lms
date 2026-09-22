import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * One class's transcript, for the office to actually LOOK at — not just count.
 *
 * `/admin/live`'s health panel lists recordings by status; this is what a click
 * on one of them opens: the same summary/vocabulary/transcript a student would
 * see on `/notes/class/[id]` (via `ClassRecap`, reused here), but reachable by
 * anyone with the `classes` capability rather than gated to the student who
 * owns the class — the office needs to read a note to judge whether the
 * pipeline is producing something worth showing a student, including one that
 * failed or is still part-way through.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("classes");
  if (!gate.ok) return gate.response;

  const { id } = await context.params;

  const recording = await prisma.classRecording.findUnique({
    where: { id },
    select: {
      id: true,
      startedAt: true,
      privateClassId: true,
      durationSeconds: true,
      material: { select: { id: true, title: true, level: true } },
      transcript: {
        select: {
          status: true,
          error: true,
          provider: true,
          generatedAt: true,
          updatedAt: true,
          transcribedUntil: true,
          summary: true,
          keyPoints: true,
          actionItems: true,
          vocabulary: true,
          corrections: true,
          progressHighlights: true,
          transcriptText: true,
          segments: true,
        },
      },
    },
  });
  if (!recording || !recording.material) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const t = recording.transcript;
  const isPrivate = Boolean(recording.privateClassId);

  return NextResponse.json({
    id: recording.id,
    materialId: recording.material.id,
    title: recording.material.title,
    level: recording.material.level,
    startedAt: recording.startedAt,
    durationSeconds: recording.durationSeconds,
    isPrivate,
    status: t?.status ?? "none",
    error: t?.error ?? null,
    provider: t?.provider ?? null,
    generatedAt: t?.generatedAt ?? null,
    transcribedUntil: t?.transcribedUntil ?? null,
    // The recap, exactly as a student would see it — empty fields simply render nothing in ClassRecap.
    recap: {
      summary: t?.summary ?? null,
      keyPoints: (t?.keyPoints as string[] | null) ?? [],
      actionItems: (t?.actionItems as string[] | null) ?? [],
      vocabulary: (t?.vocabulary as Array<{ de: string; en: string; note?: string }> | null) ?? [],
      corrections: isPrivate ? ((t?.corrections as Array<{ mistake: string; correction: string; note?: string }> | null) ?? []) : [],
      progressHighlights: isPrivate ? ((t?.progressHighlights as string[] | null) ?? []) : [],
      outline: t?.provider === "extractive",
    },
    // Full text, so the office can see the raw material behind a note that looks thin or wrong.
    transcriptText: t?.transcriptText ?? null,
    segmentCount: Array.isArray(t?.segments) ? (t!.segments as unknown[]).length : 0,
  });
}
