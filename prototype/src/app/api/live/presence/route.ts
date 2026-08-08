import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  addInvites,
  closeLiveSession,
  declineInvite,
  liveWhere,
  ringStudents,
  touchLiveSession,
} from "@/lib/live-presence";
import { stopRecordingForRoom } from "@/lib/class-recorder";

export const dynamic = "force-dynamic";

/**
 * Everything that CHANGES a live session, behind one POST.
 *
 * Split from /api/live/state because the two have opposite shapes: state is
 * polled by every student on every page and must stay a cheap read, while these
 * are rare, authenticated writes. Folding them together would mean a GET that
 * sometimes writes, which is the kind of thing that quietly gets cached.
 *
 *   heartbeat  tutor: I am still here          (every ~45s)
 *   end        tutor: class is over            (leave / end class)
 *   ring       tutor: buzz these students again
 *   decline    student: not joining, stop asking
 */

type Action = "heartbeat" | "end" | "ring" | "decline";

export async function POST(request: Request) {
  try {
    const session = await requireAuthSession();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const action = String(body.action ?? "") as Action;

    const [student, lecturer] = await Promise.all([
      prisma.student.findUnique({ where: { userId: session.user.id }, select: { id: true } }),
      prisma.lecturer.findUnique({ where: { userId: session.user.id }, select: { id: true } }),
    ]);

    const isAdmin = String(session.user.role ?? "").toLowerCase() === "admin";
    const isStaff = Boolean(lecturer) || isAdmin;

    if (action === "decline") {
      if (!student) return NextResponse.json({ error: "Students only" }, { status: 403 });
      const sessionId = String(body.sessionId ?? "");
      if (!sessionId) return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
      await declineInvite(sessionId, student.id);
      return NextResponse.json({ ok: true });
    }

    if (!isStaff) return NextResponse.json({ error: "Staff access required" }, { status: 403 });

    /**
     * Whose session is this?
     *
     * Resolved from the signed-in tutor rather than taken from the body wherever
     * possible. A room name in a request body is a claim, not a credential, and
     * "end the class" is the one action here that a bored student would enjoy
     * being able to perform on somebody else's lesson.
     */
    const owned = await prisma.liveClassSession.findFirst({
      where: {
        ...liveWhere(),
        ...(isAdmin && body.sessionId
          ? { id: String(body.sessionId) }
          : { OR: [{ lecturerId: lecturer?.id ?? "__none__" }, { startedByUserId: session.user.id }] }),
      },
      orderBy: { startedAt: "desc" },
      select: {
        id: true, roomName: true, joinCode: true, kind: true, title: true, branchId: true,
        level: true, sessionSlot: true, privateClassId: true, startedAt: true,
        lecturer: { select: { user: { select: { name: true } } } },
      },
    });

    if (!owned) {
      // Not a failure: a heartbeat from a tab left open after the class ended
      // lands here every time. The client's job is to stop, not to retry.
      return NextResponse.json({ ok: true, live: false });
    }

    if (action === "heartbeat") {
      await touchLiveSession(owned.roomName);
      return NextResponse.json({ ok: true, live: true });
    }

    if (action === "end") {
      await closeLiveSession(owned.roomName);
      // The recording follows the class. Best effort — a stuck egress must not
      // leave the session open, because an open session keeps inviting people.
      void stopRecordingForRoom(owned.roomName).catch(() => {});
      return NextResponse.json({ ok: true, live: false });
    }

    if (action === "ring") {
      const studentIds: string[] = Array.isArray(body.studentIds) ? body.studentIds.map(String) : [];
      if (!studentIds.length) return NextResponse.json({ error: "studentIds is required" }, { status: 400 });

      await addInvites(owned.id, studentIds);

      // The round number is what makes a second ring actually ring: notify()
      // dedupes on the key, so reusing it would silently drop the repeat.
      const rounds = await prisma.liveClassInvite.findMany({
        where: { sessionId: owned.id, studentId: { in: studentIds } },
        select: { ringCount: true },
      });
      const round = Math.max(1, ...rounds.map((r) => r.ringCount));

      ringStudents(
        {
          id: owned.id,
          roomName: owned.roomName,
          joinCode: owned.joinCode,
          kind: owned.kind,
          title: owned.title,
          branchId: owned.branchId,
          level: owned.level,
          sessionSlot: owned.sessionSlot,
          privateClassId: owned.privateClassId,
          startedAt: owned.startedAt,
          lecturerName: owned.lecturer?.user?.name ?? null,
        },
        studentIds,
        round,
      );

      return NextResponse.json({ ok: true, rang: studentIds.length });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    console.error("Live presence action failed", error);
    return NextResponse.json({ error: "Could not update the class" }, { status: 500 });
  }
}
