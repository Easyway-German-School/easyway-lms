/**
 * "Is my class live right now?" — extracted from /api/live/state/route.ts so
 * the exact same logic can run from two different front doors: the Vercel
 * route (polled by the browser) and the self-hosted push server
 * (push-server/server.ts), which calls this on its own timer and forwards
 * the result over a WebSocket instead of waiting for the next poll. Mirrors
 * the pattern already used for portal-updates.ts — one function neither
 * file can drift from the other.
 */
import { prisma } from "@/lib/prisma";
import { canAttendLive } from "@/lib/access";
import { isOnlineBranch } from "@/lib/online-branch";
import { studentCanEnterLiveClass } from "@/lib/live-eligibility";
import { liveSessionForStudent, liveWhere } from "@/lib/live-presence";
import { cohortRoomName } from "@/lib/live-classroom";
import { canonicalBatch } from "@/lib/class-batch";
import { tutorTeachingGroups } from "@/lib/tutor-classes-server";

export type LiveStateGroup = {
  key: string;
  label: string;
  branchName: string | null;
  batch: string | null;
  batchRange: string | null;
  roomName: string;
  branchId: string | null;
  level: string | null;
  sessionSlot: string | null;
};

export type LiveStateResult =
  | { role: "tutor"; groups: LiveStateGroup[]; live: null }
  | {
      role: "tutor";
      groups: LiveStateGroup[];
      live: {
        id: string;
        title: string | null;
        joinCode: string | null;
        kind: string;
        startedAt: Date;
        roomName: string;
        branchId: string | null;
        level: string | null;
        sessionSlot: string | null;
        batch: string | null;
        privateClassId: string | null;
        groupKey: string | null;
        groupLabel: string | null;
      };
      invites: {
        studentId: string;
        name: string;
        status: string;
        ringCount: number;
        joinedAt: Date | null;
      }[];
    }
  | { role: "student" | null; live: null }
  | {
      role: "student";
      live: {
        id: string;
        title: string | null;
        joinCode: string | null;
        kind: string;
        startedAt: Date;
        tutorName: string | null;
        personal: boolean;
        inviteStatus: string | null;
      };
    };

/** `userId` is the only trusted input — role/eligibility are all re-derived from the DB, exactly as the route did inline. */
export async function loadLiveState(userId: string): Promise<LiveStateResult> {
  const [student, lecturer] = await Promise.all([
    prisma.student.findUnique({
      where: { userId },
      select: {
        id: true,
        branchId: true,
        level: true,
        sessionSlot: true,
        hybridOnlineSlot: true,
        classType: true,
        deliveryMode: true,
        tutorId: true,
        coTutors: { select: { lecturerId: true } },
        admission: true,
        branch: { select: { name: true, mode: true } },
      },
    }),
    prisma.lecturer.findUnique({
      where: { userId },
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
      lecturerId: lecturer.id,
    });

    const activeBranches = await prisma.branch.findMany({
      where: { status: "active" },
      select: { id: true, name: true },
    });
    const groups: LiveStateGroup[] = (
      await tutorTeachingGroups(
        lecturer,
        new Map(activeBranches.map((branch) => [branch.id, branch.name])),
      )
    ).map((group) => ({
      key: group.key,
      label: group.label,
      branchName: group.branchName,
      batch: group.batch,
      batchRange: group.batchRange,
      roomName: group.roomName,
      branchId: group.branchId,
      level: group.level,
      sessionSlot: group.sessionSlot,
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

    if (!open) return { role: "tutor", groups, live: null };

    const openBatch = canonicalBatch(open.batch);
    const liveGroup =
      groups.find((group) => group.roomName === open.roomName) ??
      groups.find(
        (group) =>
          group.branchId === open.branchId &&
          group.level === String(open.level ?? "").toUpperCase() &&
          group.sessionSlot === String(open.sessionSlot ?? "").toLowerCase() &&
          canonicalBatch(group.batch) === openBatch,
      ) ??
      null;

    return {
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
        batch: open.batch,
        privateClassId: open.privateClassId,
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
    } as LiveStateResult;
  }

  if (!student) return { role: null, live: null };

  if (
    !canAttendLive(student.deliveryMode, student.classType) &&
    !isOnlineBranch(student.branch) &&
    !student.tutorId &&
    student.coTutors.length === 0
  ) {
    return { role: "student", live: null };
  }

  const live = await liveSessionForStudent({
    ...student,
    coTutorIds: student.coTutors.map((link) => link.lecturerId),
  });
  if (!live) return { role: "student", live: null };

  if (!(await studentCanEnterLiveClass(student.id))) {
    return { role: "student", live: null };
  }

  return {
    role: "student",
    live: {
      id: live.id,
      title: live.title,
      joinCode: live.joinCode,
      kind: live.kind,
      startedAt: live.startedAt,
      tutorName: live.lecturerName,
      personal: live.invited,
      inviteStatus: live.inviteStatus,
    },
  } as LiveStateResult;
}
