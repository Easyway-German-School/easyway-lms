import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteRecordingObject } from "@/lib/recording";

export const dynamic = "force-dynamic";

/**
 * The tutor's own call, made right after ending a class the end-of-class
 * prompt flagged as short (see `ShortRecordingPrompt` in LiveCallContext):
 * delete this recording outright instead of letting it sit through the
 * normal hold-and-48h-grace review. See the field comment on
 * `ClassRecording.tutorDiscardRequestedAt` in schema.prisma.
 *
 * Ownership is resolved from `startedByUserId` — the tutor whose join
 * started this capture — never from a claim in the request body. This can
 * fire after the class's `LiveClassSession` has already closed (the popup
 * appears once the tutor leaves), so it cannot reuse `/api/live/presence`'s
 * `endedAt: null` lookup; `startedByUserId` is the one fact on the capture
 * itself that survives past the close.
 */
export async function POST(request: Request) {
  try {
    const session = await requireAuthSession();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const roomName = String(body.roomName ?? "");
    if (!roomName) return NextResponse.json({ error: "roomName is required" }, { status: 400 });

    const recording = await prisma.classRecording.findFirst({
      where: { roomName, startedByUserId: session.user.id, privateClassId: null },
      orderBy: { startedAt: "desc" },
      select: { id: true, status: true, objectKey: true, materialId: true },
    });
    if (!recording) return NextResponse.json({ ok: true, found: false });

    // Still recording or still encoding/uploading: `finaliseRecording` has not
    // run yet. Just flag it — the row-level check added there deletes the
    // object the moment there is one to delete, unconditionally.
    if (recording.status === "active" || recording.status === "restarting") {
      await prisma.classRecording.update({ where: { id: recording.id }, data: { tutorDiscardRequestedAt: new Date() } });
      return NextResponse.json({ ok: true, found: true, pending: true });
    }

    // Already purged/failed/aborted: nothing left to delete.
    if (recording.status !== "completed") return NextResponse.json({ ok: true, found: true, pending: false });

    // `finaliseRecording` already ran — for a class this short it often beats
    // the tutor to the popup. The recording is either HELD (no Material, the
    // default for a short one) or, rarely, already on the shelf. Either way,
    // delete it now rather than wait: the tutor already made the call.
    if (recording.objectKey && !(await deleteRecordingObject(recording.objectKey))) {
      return NextResponse.json({ error: "Could not delete the file from storage" }, { status: 502 });
    }
    if (recording.materialId) {
      await prisma.material.delete({ where: { id: recording.materialId } }).catch(() => {});
    }
    await prisma.classRecording.update({
      where: { id: recording.id },
      data: {
        status: "purged",
        purgedAt: new Date(),
        fileUrl: null,
        tutorDiscardRequestedAt: new Date(),
        error: "Discarded by the tutor right after class ended.",
      },
    });

    return NextResponse.json({ ok: true, found: true, pending: false });
  } catch (error) {
    console.error("Recording discard request failed", error);
    return NextResponse.json({ error: "Could not delete the recording" }, { status: 500 });
  }
}

// Storage delete + a DB write; generous but not long.
export const maxDuration = 30;
