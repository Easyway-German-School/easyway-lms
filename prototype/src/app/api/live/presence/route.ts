import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  addInvites,
  closeLiveSession,
  declineInvite,
  ringStudents,
  touchLiveSession,
} from "@/lib/live-presence";
import { ensureRecordingStarted, stopRecordingForRoom } from "@/lib/class-recorder";

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
     *
     * Deliberately NOT `liveWhere()` here — that also requires `lastSeenAt` to
     * be within the last three minutes, and this route is the ONLY thing that
     * ever advances `lastSeenAt`. Gating the lookup on staleness makes staleness
     * permanent: the one heartbeat that arrives a few seconds late (a
     * backgrounded phone tab, one slow network blip) stops matching here, which
     * means `touchLiveSession` never runs again, which means it can never match
     * again either — a session that misses a single heartbeat was stuck stale
     * forever, silently, with the tutor still teaching. `endedAt: null` is the
     * only thing that should ever take a class away from its own tutor; three
     * minutes of quiet is the right reason to stop advertising it to students
     * (see `liveWhere()`, still used for exactly that in live-presence.ts), not
     * a reason to lock its own tutor out of ending or reviving it.
     */
    const owned = await prisma.liveClassSession.findFirst({
      where: {
        endedAt: null,
        ...(isAdmin && body.sessionId
          ? { id: String(body.sessionId) }
          : { OR: [{ lecturerId: lecturer?.id ?? "__none__" }, { startedByUserId: session.user.id }] }),
      },
      orderBy: { startedAt: "desc" },
      select: {
        id: true, roomName: true, joinCode: true, kind: true, title: true, branchId: true,
        level: true, sessionSlot: true, privateClassId: true, startedAt: true, startedByUserId: true,
        branch: { select: { name: true } },
        lecturer: { select: { id: true, user: { select: { name: true } } } },
      },
    });

    if (!owned) {
      // Not a failure: a heartbeat from a tab left open after the class ended
      // lands here every time. The client's job is to stop, not to retry.
      return NextResponse.json({ ok: true, live: false });
    }

    if (action === "heartbeat") {
      await touchLiveSession(owned.roomName);

      /**
       * THE HEARTBEAT IS ALSO THE RECORDING'S SECOND CHANCE.
       *
       * `/api/live/session` already tries to start the capture, fired the
       * instant the tutor's token is minted — but that is server-to-LiveKit,
       * racing a client that still has to finish a WebRTC handshake with
       * LiveKit over whatever connection they actually have. On the networks
       * this school is built around, the token often wins that race, and
       * `startRoomCompositeEgress` fails outright against a room LiveKit does
       * not think exists yet. That failure was silent — logged to a server
       * console nobody was reading — and it is why a real 19-minute class
       * produced zero rows in the recording library.
       *
       * By the time ANY heartbeat lands, the tutor is unquestionably
       * connected — the heartbeat only starts once `startCall` has fired, and
       * only a live Room keeps it going. `ensureRecordingStarted` is already
       * idempotent (see class-recorder.ts), so calling it again here costs
       * nothing when the first attempt already won, and quietly fixes it
       * within one heartbeat interval when it did not. Private classes are
       * still excluded — recording a one-to-one is a consent question, not a
       * timing one.
       */
      if (owned.kind !== "private") {
        const { currentTenantId } = await import("@/lib/tenant/context");
        void ensureRecordingStarted({
          roomName: owned.roomName,
          tenantId: currentTenantId(),
          branchId: owned.branchId,
          branchName: owned.branch?.name ?? null,
          level: owned.level,
          sessionSlot: owned.sessionSlot,
          startedByUserId: owned.startedByUserId,
        });
      }

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
      const requested: string[] = Array.isArray(body.studentIds) ? body.studentIds.map(String) : [];
      if (!requested.length) return NextResponse.json({ error: "studentIds is required" }, { status: 400 });

      /**
       * `studentIds` in the request body is a claim, same as `sessionId` above —
       * without this check a tutor's own client could ring (and thus invite,
       * notify and buzz the phone of) any student in the school, not just the
       * ones in this class. The eligible set is the room's own definition of
       * who belongs here: the private booking's one student, or everyone in
       * this session's branch+level+sessionSlot for a cohort class.
       */
      const eligible =
        owned.kind === "private"
          ? new Set(
              owned.privateClassId
                ? [
                    (
                      await prisma.privateClass.findUnique({
                        where: { id: owned.privateClassId },
                        select: { studentId: true },
                      })
                    )?.studentId ?? "",
                  ].filter(Boolean)
                : [],
            )
          : new Set(
              (
                await prisma.student.findMany({
                  // `as any` on the nullable-vs-null mismatch, same as
                  // studentWhereForLecturer's callers elsewhere in this app —
                  // Prisma's generated filter type does not accept a bare
                  // `null` for an exact match on a nullable column here even
                  // though it is valid at runtime.
                  where: {
                    id: { in: requested },
                    branchId: owned.branchId,
                    level: owned.level,
                    sessionSlot: owned.sessionSlot,
                  } as any,
                  select: { id: true },
                })
              ).map((s) => s.id),
            );

      const studentIds = requested.filter((id) => eligible.has(id));
      if (!studentIds.length) {
        return NextResponse.json({ error: "None of those students are in this class." }, { status: 403 });
      }

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
