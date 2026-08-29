import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * WHAT JUST HAPPENED — read once, on the screen after a class ends.
 *
 * Everything here is already in the database; the point of the endpoint is that
 * the browser cannot be trusted to compute it. A duration the client measures
 * is the length of ONE PERSON'S connection, and a student who dropped twice
 * would be told their tutor taught for nine minutes. The class's clock lives on
 * the session row, so that is where it is read from.
 *
 * The recording is looked up rather than assumed. "Check out the recording" is
 * a promise, and a screen that makes it while the egress job is still encoding
 * — or has failed — sends the student to an empty library and teaches them the
 * feature does not work.
 */
export async function GET(request: Request) {
  try {
    const session = await requireAuthSession();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sessionId = new URL(request.url).searchParams.get("sessionId")?.trim();
    if (!sessionId) return NextResponse.json({ error: "sessionId is required" }, { status: 400 });

    const live = await prisma.liveClassSession.findUnique({
      where: { id: sessionId },
      include: {
        lecturer: { select: { user: { select: { name: true } } } },
        invites: { select: { studentId: true, status: true } },
      },
    });
    if (!live) return NextResponse.json({ error: "No such class" }, { status: 404 });

    /**
     * MAY THIS PERSON READ THIS RECAP?
     *
     * A session id is not a credential. Without this check, any signed-in
     * student could walk ids and learn the roster size, the tutor and the
     * timings of every private one-to-one in the school. Four ways in, and
     * every one of them is a fact about the caller rather than about the
     * request: they run the school, they taught it, they were on the guest
     * list, or it was their own cohort's room.
     */
    const isAdmin = String(session.user.role ?? "").toLowerCase() === "admin";
    const [student, lecturer] = await Promise.all([
      prisma.student.findUnique({
        where: { userId: session.user.id },
        select: { id: true, branchId: true, level: true, sessionSlot: true },
      }),
      prisma.lecturer.findUnique({ where: { userId: session.user.id }, select: { id: true } }),
    ]);

    const taughtIt = Boolean(
      (lecturer && live.lecturerId === lecturer.id) || live.startedByUserId === session.user.id,
    );
    const wasInvited = Boolean(student && live.invites.some((invite) => invite.studentId === student.id));
    const ownCohort = Boolean(
      student &&
        live.kind === "cohort" &&
        live.branchId === student.branchId &&
        live.level === student.level &&
        live.sessionSlot === student.sessionSlot,
    );

    if (!isAdmin && !taughtIt && !wasInvited && !ownCohort) {
      return NextResponse.json({ error: "Not your class" }, { status: 403 });
    }

    // An open session is one still being taught. The end screen can be reached
    // from a student who simply left, so this is not always false.
    const stillLive = live.endedAt === null;
    const finishedAt = live.endedAt ?? new Date();
    const durationMinutes = Math.max(
      1,
      Math.round((finishedAt.getTime() - live.startedAt.getTime()) / 60_000),
    );

    const attended = live.invites.filter((invite) => invite.status === "joined").length;

    /**
     * The tape for THIS room, newest first.
     *
     * Matched on the room rather than the session because a recording belongs
     * to a capture job, not to the row that opened the class — and the two are
     * created by different systems minutes apart. `materialId` being set is the
     * only honest test of "there is something to watch": the status says
     * completed the moment the egress finishes, but the library row is what the
     * student's Watch tab actually reads.
     */
    const recording = await prisma.classRecording.findFirst({
      where: { roomName: live.roomName, startedAt: { gte: live.startedAt } },
      orderBy: { startedAt: "desc" },
      select: { status: true, materialId: true, durationSeconds: true, variant: true },
    });

    return NextResponse.json({
      title: live.title,
      kind: live.kind,
      tutorName: live.lecturer?.user?.name ?? null,
      startedAt: live.startedAt,
      endedAt: live.endedAt,
      stillLive,
      durationMinutes,
      attended,
      /** Everyone the class reached: those who came plus those still ringing. */
      onTheList: live.invites.length,
      recording: recording
        ? {
            status: recording.status,
            ready: Boolean(recording.materialId) && recording.status === "completed",
            materialId: recording.materialId,
            variant: recording.variant,
            durationSeconds: recording.durationSeconds,
          }
        : null,
    });
  } catch (error) {
    console.error("Live recap failed", error);
    // Deliberately soft: the end screen is the last thing a student sees after
    // a lesson, and it must not be an error page because a count failed.
    return NextResponse.json({ error: "Could not load the class summary" }, { status: 500 });
  }
}
