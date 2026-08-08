import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isEffectivelyComplete } from "@/lib/video-library";

export const dynamic = "force-dynamic";

/**
 * Saves where a student stopped watching.
 *
 * Called on a timer while the player runs and once on unload. Kept to a tiny
 * body and a single upsert because it fires repeatedly on exactly the weak
 * connections this whole feature exists for — anything heavier would compete
 * with the video it is trying to track.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const materialId = typeof body?.materialId === "string" ? body.materialId : "";
    const positionSeconds = Math.max(0, Math.round(Number(body?.positionSeconds) || 0));
    const durationSeconds = Math.max(0, Math.round(Number(body?.durationSeconds) || 0));

    if (!materialId) {
      return NextResponse.json({ error: "materialId is required" }, { status: 400 });
    }

    const student = await prisma.student.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });
    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const existing = await prisma.videoProgress.findUnique({
      where: { studentId_materialId: { studentId: student.id, materialId } },
      select: { positionSeconds: true, completed: true },
    });

    // Position only ever moves forward. Scrubbing back to re-hear a phrase is
    // normal in a language class and must not throw away the fact that the
    // student had already reached the end.
    const furthest = Math.max(existing?.positionSeconds ?? 0, positionSeconds);
    const completed = existing?.completed || isEffectivelyComplete(furthest, durationSeconds);

    // The runtime is worth recording the first time a real player reports it:
    // most uploads arrive with no duration, and without one the progress bar
    // and "Continue watching" have nothing to work from.
    if (durationSeconds > 0) {
      await prisma.material.updateMany({
        where: { id: materialId, durationSeconds: null },
        data: { durationSeconds },
      });
    }

    await prisma.videoProgress.upsert({
      where: { studentId_materialId: { studentId: student.id, materialId } },
      update: { positionSeconds: furthest, completed },
      create: { studentId: student.id, materialId, positionSeconds: furthest, completed },
    });

    return NextResponse.json({ ok: true, positionSeconds: furthest, completed });
  } catch (error) {
    console.error("Failed to save video progress", error);
    return NextResponse.json({ error: "Failed to save progress" }, { status: 500 });
  }
}
