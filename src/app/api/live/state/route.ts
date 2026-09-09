import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAttendLive } from "@/lib/access";
import { isOnlineBranch } from "@/lib/online-branch";
import { studentCanEnterLiveClass } from "@/lib/live-eligibility";
import { liveSessionForStudent, liveWhere } from "@/lib/live-presence";
import { cohortRoomName } from "@/lib/live-classroom";
import { readAssignment, teachingGroups } from "@/lib/lecturer-assignment";

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
          // So a named student sees their tutor's live class even when their
          // cohort fields never lined up with it — see liveSessionForStudent.
          tutorId: true,
          coTutors: { select: { lecturerId: true } },
          branch: { select: { name: true, mode: true } },
        },
      }),
      prisma.lecturer.findUnique({
        where: { userId: session.user.id },
        select: {
          id: true,
          level: true,
          sessionSlot: true,
          branchId: true,
          branchIds: true,
          levels: true,
          sessionSlots: true,
          assignmentGroups: true,
          batches: true,
          branch: { select: { id: true, name: true } },
        },
      }),
    ]);

    if (lecturer) {
      const room = cohortRoomName({
        branchName: lecturer.branch?.name,
        level: lecturer.level,
        sessionSlot: lecturer.sessionSlot,
      });

      // Every class this tutor runs, so a multi-class tutor's dashboard can
      // both label which one is live and offer to start another.
      const activeBranches = await prisma.branch.findMany({
        where: { status: "active" },
        select: { id: true, name: true },
      });
      const groups = teachingGroups(
        readAssignment(lecturer),
        new Map(activeBranches.map((branch) => [branch.id, branch.name])),
      ).map((group) => ({
        key: group.key,
        label: group.label,
        branchName: group.branchName,
        batchRange: group.batchRange,
        roomName: group.roomName,
      }));

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

      if (!open) return NextResponse.json({ live: null, role: "tutor", groups });

      // Which teaching group this open room belongs to, so "Open room" can
      // reopen the SAME room rather than the primary one.
      const liveGroup = groups.find((group) => group.roomName === open.roomName) ?? null;

      return NextResponse.json({
        role: "tutor",
        groups,
        live: {
          id: open.id,
          title: open.title,
          joinCode: open.joinCode,
          kind: open.kind,
          startedAt: open.startedAt,
          roomName: open.roomName,
          branchId: open.branchId,
          level: open.level,
          sessionSlot: open.sessionSlot,
          groupKey: liveGroup?.key ?? null,
          groupLabel: liveGroup?.label ?? null,
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
    if (
      !canAttendLive(student.deliveryMode, student.classType) &&
      !isOnlineBranch(student.branch) &&
      // A student the office named onto a tutor is not a walk-past campus
      // student — if that tutor runs a live video class, they should see it.
      // `liveSessionForStudent` below still decides whether there is one.
      !student.tutorId &&
      student.coTutors.length === 0
    ) {
      return NextResponse.json({ live: null, role: "student" });
    }

    const live = await liveSessionForStudent({
      ...student,
      coTutorIds: student.coTutors.map((link) => link.lecturerId),
    });
    if (!live) return NextResponse.json({ live: null, role: "student" });

    /**
     * A LOCKED PORTAL DOES NOT GET THE "YOUR CLASS IS LIVE" POPUP.
     *
     * Either lock counts: a student who has not cleared their deposit (or is
     * overdue on the balance past grace), OR one who is paid up but has no
     * profile photo yet. Both hit a lock screen the moment they tap through, so
     * a "your class is live" popup is a tease, not a nudge. Once the office
     * confirms the payment — or the student adds a photo — the class shows up.
     * Only run once we know there is actually a class to hide, so an ordinary
     * "nothing live" poll is as cheap as before.
     */
    if (!(await studentCanEnterLiveClass(student.id))) {
      return NextResponse.json({ live: null, role: "student" });
    }

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
