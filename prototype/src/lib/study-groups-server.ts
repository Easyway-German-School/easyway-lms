import { ageFromDob, dobOfStudent } from "@/lib/age-bands";
import { bandOf, displayName } from "@/lib/campus";
import { campusEnabled } from "@/lib/campus-server";
import { batchOfAdmission } from "@/lib/class-batch";
import { getStudentAccess } from "@/lib/student-access";
import { prisma } from "@/lib/prisma";

export type StudyGroupViewer = {
  userId: string;
  studentId: string;
  tenantId: string | null;
  branchId: string;
  level: string;
  sessionSlot: string;
  batch: string;
  band: ReturnType<typeof bandOf>;
};

export type StudyGroupViewerResult =
  | { ok: true; viewer: StudyGroupViewer }
  | { ok: false; status: number; error: string };

export async function loadStudyGroupViewer(userId: string): Promise<StudyGroupViewerResult> {
  const student = await prisma.student.findUnique({
    where: { userId },
    select: {
      id: true,
      tenantId: true,
      branchId: true,
      level: true,
      sessionSlot: true,
      classType: true,
      status: true,
      admission: true,
      profile: { select: { dateOfBirth: true } },
    },
  });

  if (!student || student.status !== "active") {
    return { ok: false, status: 403, error: "Study groups are available to active students." };
  }
  if (student.classType !== "group") {
    return { ok: false, status: 403, error: "Study groups are for students on a group class track." };
  }
  if (!student.branchId) {
    return { ok: false, status: 409, error: "Your class placement is not complete yet. Contact the school office." };
  }

  const access = await getStudentAccess(student.id);
  if (!access?.hasAccess) {
    return { ok: false, status: 402, error: "Study groups open when your tuition access is active." };
  }
  if (!(await campusEnabled(student.tenantId))) {
    return { ok: false, status: 503, error: "Campus is paused by the school right now." };
  }

  const age = ageFromDob(dobOfStudent(student.profile, student.admission));
  return {
    ok: true,
    viewer: {
      userId,
      studentId: student.id,
      tenantId: student.tenantId,
      branchId: student.branchId,
      level: student.level,
      sessionSlot: student.sessionSlot,
      batch: batchOfAdmission(student.admission),
      band: bandOf(age),
    },
  };
}

export function studyGroupScope(viewer: StudyGroupViewer) {
  return {
    tenantId: viewer.tenantId,
    branchId: viewer.branchId,
    level: viewer.level,
    sessionSlot: viewer.sessionSlot,
    batch: viewer.batch,
    band: viewer.band,
  };
}

export function publicStudyGroup(group: {
  id: string;
  name: string;
  focus: string;
  startsAt: Date;
  expiresAt: Date;
  ownerUserId: string;
  ownerUser: { name: string | null };
  members: Array<{ userId: string; role: string; user: { name: string | null } }>;
  _count: { members: number };
}, viewerUserId: string) {
  return {
    id: group.id,
    name: group.name,
    focus: group.focus,
    startsAt: group.startsAt.toISOString(),
    expiresAt: group.expiresAt.toISOString(),
    ownerName: displayName(group.ownerUser.name),
    isOwner: group.ownerUserId === viewerUserId,
    isMember: group.members.some((member) => member.userId === viewerUserId),
    memberCount: group._count.members,
    members: group.members.map((member) => ({
      name: displayName(member.user.name),
      role: member.role,
    })),
  };
}
