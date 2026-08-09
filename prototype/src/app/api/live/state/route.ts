import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAttendLive } from "@/lib/access";
import { liveSessionForStudent, liveWhere } from "@/lib/live-presence";
import { cohortRoomName } from "@/lib/live-classroom";

export const dynamic = "force-dynamic";

/**
 * "Is my class live right now?" — the one question the portal could not answer.
 *
 * Polled by the shell on every student page, so it is deliberately small and
 * cheap: two indexed lookups and a handful of scalars. It returns no token and
 * no room credentials. Knowing a class has started is not the same as being let
 * into it, and only /api/live/session mints keys.
 *
 * A tutor gets the mirror image: their own open session, and who has answered.
 */
export async function GET() {
  try {
    const session = await requireAuthSession();
    if (!session?.user?.id) {
      // Not an error worth logging or surfacing — the shell polls this from
      // pages a signed-out visitor can reach. Silence is the right answer.
      return NextResponse.json({ live: null });
    }

    const [student, lecturer] = await Promise.all([
      prisma.student.findUnique({
        where: { userId: session.user.id },
        select: {
          id: true,
          branchId: true,
          level: true,
          sessionSlot: true,
          classType: true,
          deliveryMode: true,
          branch: { select: { name: true } },
        },
      }),
      prisma.lecturer.findUnique({
        where: { userId: session.user.id },
        select: { id: true, level: true, sessionSlot: true, branch: { select: { name: true } } },
      }),
    ]);

    if (lecturer) {
      const room = cohortRoomName({
        branchName: lecturer.branch?.name,
        level: lecturer.level,
        sessionSlot: lecturer.sessionSlot,
      });

      const open = await prisma.liveClassSession.findFirst({
        where: { OR: [{ roomName: room }, { lecturerId: lecturer.id }], ...liveWhere() },
        orderBy: { startedAt: "desc" },
        include: {
          invites: {
            include: { student: { select: { id: true, user: { select: { name: true } } } } },
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (!open) return NextResponse.json({ live: null, role: "tutor" });

      return NextResponse.json({
        role: "tutor",
        live: {
          id: open.id,
          title: open.title,
          joinCode: open.joinCode,
          kind: open.kind,
          startedAt: open.startedAt,
          roomName: open.roomName,
        },
        invites: open.invites.map((invite) => ({
          studentId: invite.studentId,
          name: invite.student.user.name ?? "Student",
          status: invite.status,
          ringCount: invite.ringCount,
          joinedAt: invite.joinedAt,
        })),
      });
    }

    if (!student) return NextResponse.json({ live: null });

    /**
     * A campus student is never told a video class has started.
     *
     * Their lessons happen in a building. A "join now" popup they cannot use is
     * not a missed feature, it is the portal appearing to be broken — and this
     * is the one notification designed to interrupt whatever they are doing.
     * The exception is a private student, whose tutor may take the one-to-one
     * over video whatever their branch says.
     */
    if (!canAttendLive(student.deliveryMode, student.classType)) {
      return NextResponse.json({ live: null, role: "student" });
    }

    const live = await liveSessionForStudent(student);
    if (!live) return NextResponse.json({ live: null, role: "student" });

    return NextResponse.json({
      role: "student",
      live: {
        id: live.id,
        title: live.title,
        joinCode: live.joinCode,
        kind: live.kind,
        startedAt: live.startedAt,
        tutorName: live.lecturerName,
        /** True when the tutor rang this student by name rather than the room. */
        personal: live.invited,
        inviteStatus: live.inviteStatus,
      },
    });
  } catch (error) {
    console.error("Live state lookup failed", error);
    // A failing poll must never put an error banner on a page the student is
    // reading. "Nothing is live" is the safe, quiet answer.
    return NextResponse.json({ live: null });
  }
}
