import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureRecordingStarted } from "@/lib/class-recorder";

export const dynamic = "force-dynamic";

/**
 * "Start the tape when the tutor is actually in the room, not when their
 * browser merely loaded the page."
 *
 * This used to run inline in `GET /api/live/session`, which fires on every
 * page-load — before the Lobby's quality picker, before "Start the class" is
 * even clicked, before the tutor's camera or microphone exist as far as
 * LiveKit is concerned. Every recording therefore opened on however long the
 * tutor spent on the Lobby plus whatever camera/mic permission fumbling
 * happened right after connecting, none of which a student needs to sit
 * through in a recap.
 *
 * `LiveKitClassroom` now calls this itself, once, the moment its own
 * `RoomEvent.Connected` fires for the tutor — i.e. after "Start the class"
 * has been clicked AND the room connection has actually succeeded. That is
 * still not a button a tutor can forget to press: it is the same connection
 * they always make to teach at all, just a later, truer moment than "the
 * page exists" to call "the class has started."
 *
 * `ensureRecordingStarted` is idempotent (keyed on `roomName` + an active
 * `ClassRecording` row), so a reconnect or a second tab calling this again
 * costs nothing.
 *
 * Private one-to-one classes are recorded too, as of the class-notes
 * pipeline (see [[project-class-notes-pipeline]]) — that capture becomes the
 * student's transcript and recap afterwards. The privacy half of that is
 * enforced downstream, not here: a private `ClassRecording` carries
 * `privateClassId`, its `Material` never gets `level` set, and
 * `/api/student/videos` only ever surfaces it to the one enrolled student.
 */
export async function POST(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const liveSessionId = typeof body.liveSessionId === "string" ? body.liveSessionId : "";
  if (!liveSessionId) return NextResponse.json({ error: "liveSessionId is required" }, { status: 400 });

  try {
    const live = await prisma.liveClassSession.findUnique({
      where: { id: liveSessionId },
      select: {
        roomName: true,
        tenantId: true,
        branchId: true,
        branch: { select: { name: true } },
        level: true,
        sessionSlot: true,
        privateClassId: true,
        lecturerId: true,
        startedByUserId: true,
      },
    });
    if (!live) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Only the person who opened this room, or the tutor it belongs to, may
    // start its capture — a student connecting to the same room must never
    // be able to trigger this from the client.
    const lecturer = await prisma.lecturer.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });
    const isThisTutor =
      live.startedByUserId === session.user.id || (lecturer && live.lecturerId === lecturer.id);
    if (!isThisTutor) return NextResponse.json({ error: "Not permitted" }, { status: 403 });

    const egressId = await ensureRecordingStarted({
      roomName: live.roomName,
      tenantId: live.tenantId,
      branchId: live.branchId,
      branchName: live.branch?.name ?? null,
      level: live.level,
      sessionSlot: live.sessionSlot,
      startedByUserId: session.user.id,
      privateClassId: live.privateClassId,
    });

    return NextResponse.json({ ok: true, started: Boolean(egressId) });
  } catch (error) {
    // Never let a recording hiccup read as a classroom failure to the tutor —
    // ensureRecordingStarted already swallows its own errors; this catches
    // anything above it (the lookup, the auth check).
    console.error("start-recording failed", error);
    return NextResponse.json({ ok: false, started: false });
  }
}
