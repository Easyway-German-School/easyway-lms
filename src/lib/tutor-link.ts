import { prisma } from "@/lib/prisma";
import { readAssignment, type LecturerAssignment } from "@/lib/lecturer-assignment";
import { featuresForCurrentTenant } from "@/lib/tenant/features-server";
import { setStudentCoTutors, setStudentTutor } from "@/lib/tutor-pairing";
import { isAutoLinkable, planLink, type LinkAction, type LinkPlan, type LinkStudent } from "@/lib/tutor-class-match";

/**
 * The server half of the tutor-linking rule (`tutor-class-match.ts`).
 *
 * The admin panel SHOWS a plan, but the plan it shows is never what gets
 * executed: every write here re-reads the student and re-runs `planLink`, so a
 * stale screen (somebody else linked the student a minute ago) cannot turn
 * "add as co-tutor" into an accidental second primary or an overwrite.
 */

/** Everything `planLink` needs about a tutor, loaded once per request rather than once per student. */
export type LinkContext = {
  lecturerId: string;
  tutorName: string;
  assignment: LecturerAssignment;
  onlineBranchId: string | null;
  sharedStudentsEnabled: boolean;
};

export async function loadLinkContext(lecturerId: string): Promise<LinkContext | null> {
  const [lecturer, onlineBranch, features] = await Promise.all([
    prisma.lecturer.findUnique({
      where: { id: lecturerId },
      select: {
        id: true,
        branchId: true,
        level: true,
        sessionSlot: true,
        branchIds: true,
        levels: true,
        sessionSlots: true,
        assignmentGroups: true,
        classTypes: true,
        batches: true,
        user: { select: { name: true, email: true } },
      },
    }),
    prisma.branch.findFirst({ where: { mode: "online" }, select: { id: true } }),
    featuresForCurrentTenant(),
  ]);
  if (!lecturer) return null;

  return {
    lecturerId: lecturer.id,
    tutorName: lecturer.user.name || lecturer.user.email,
    assignment: readAssignment(lecturer),
    onlineBranchId: onlineBranch?.id ?? null,
    sharedStudentsEnabled: features.roster.sharedStudents,
  };
}

export const LINK_STUDENT_SELECT = {
  id: true,
  branchId: true,
  level: true,
  sessionSlot: true,
  classType: true,
  deliveryMode: true,
  hybridOnlineSlot: true,
  admission: true,
  tutorId: true,
  coTutors: { select: { lecturerId: true } },
} as const;

type RawLinkStudent = {
  id: string;
  branchId: string | null;
  level: string;
  sessionSlot: string;
  classType: string;
  deliveryMode: string;
  hybridOnlineSlot: string | null;
  admission: unknown;
  tutorId: string | null;
  coTutors: { lecturerId: string }[];
};

export function toLinkStudent(raw: RawLinkStudent): LinkStudent {
  return {
    id: raw.id,
    branchId: raw.branchId,
    level: raw.level,
    sessionSlot: raw.sessionSlot,
    classType: raw.classType,
    deliveryMode: raw.deliveryMode,
    hybridOnlineSlot: raw.hybridOnlineSlot,
    admission: raw.admission,
    tutorId: raw.tutorId,
    coTutorIds: raw.coTutors.map((link) => link.lecturerId),
  };
}

export function planFor(context: LinkContext, raw: RawLinkStudent): LinkPlan {
  return planLink({
    lecturerId: context.lecturerId,
    assignment: context.assignment,
    student: toLinkStudent(raw),
    onlineBranchId: context.onlineBranchId,
    sharedStudentsEnabled: context.sharedStudentsEnabled,
  });
}

export type LinkOutcome =
  | { ok: true; studentId: string; studentName: string; action: "primary" | "co_tutor" }
  | { ok: false; studentId: string; studentName: string | null; action: LinkAction | "error"; reason: string };

/**
 * Link one student the way the rule says, or explain why not.
 *
 * Only `add_primary` and `add_co_tutor` write anything. `shares_class`,
 * `conflict` and `blocked` come back as a skip with the reason — replacing
 * somebody's tutor is a deliberate "Move" click, never a side effect of
 * "link everyone".
 */
export async function linkStudentAuto(input: {
  context: LinkContext;
  studentId: string;
  assignedById?: string | null;
  /** Bulk callers send the tutor one summary instead of one message per student. */
  notifyTutor?: boolean;
}): Promise<LinkOutcome> {
  const { context, studentId, assignedById = null, notifyTutor = true } = input;

  const raw = await prisma.student.findUnique({
    where: { id: studentId },
    select: { ...LINK_STUDENT_SELECT, status: true, user: { select: { name: true, email: true } } },
  });
  if (!raw) return { ok: false, studentId, studentName: null, action: "error", reason: "Student not found." };

  const studentName = raw.user.name || raw.user.email;
  if (raw.status !== "active") {
    return { ok: false, studentId, studentName, action: "error", reason: "This student is not active." };
  }

  const plan = planFor(context, raw);
  if (!isAutoLinkable(plan.action)) {
    return { ok: false, studentId, studentName, action: plan.action, reason: plan.reason };
  }

  if (plan.action === "add_primary") {
    const result = await setStudentTutor({ studentId, lecturerId: context.lecturerId, notifyTutor });
    if (!result.ok) return { ok: false, studentId, studentName, action: "error", reason: result.error };
    return { ok: true, studentId, studentName, action: "primary" };
  }

  const existing = raw.coTutors.map((link) => link.lecturerId);
  const result = await setStudentCoTutors({
    studentId,
    lecturerIds: [...existing, context.lecturerId],
    roles: plan.role ? { [context.lecturerId]: plan.role } : undefined,
    assignedById,
    notifyTutor,
  });
  if (!result.ok) return { ok: false, studentId, studentName, action: "error", reason: result.error };
  return { ok: true, studentId, studentName, action: "co_tutor" };
}

/**
 * Take a student off THIS tutor — and only this tutor.
 *
 * The roster's "Remove" button used to call `setStudentTutor(null)` for every
 * named student, which clears the PRIMARY tutor. For a student who was on this
 * tutor as a co-tutor that removed somebody else's student from somebody else's
 * roster and left this tutor still attached.
 */
export async function unlinkStudentFromTutor(input: {
  studentId: string;
  lecturerId: string;
  assignedById?: string | null;
}): Promise<{ ok: true; changed: boolean; was: "primary" | "co_tutor" | "none" } | { ok: false; error: string; status: number }> {
  const { studentId, lecturerId, assignedById = null } = input;

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, tutorId: true, coTutors: { select: { lecturerId: true } } },
  });
  if (!student) return { ok: false, error: "Student not found", status: 404 };

  if (student.tutorId === lecturerId) {
    const result = await setStudentTutor({ studentId, lecturerId: null });
    if (!result.ok) return result;
    return { ok: true, changed: result.changed, was: "primary" };
  }

  const remaining = student.coTutors.map((link) => link.lecturerId).filter((id) => id !== lecturerId);
  if (remaining.length === student.coTutors.length) return { ok: true, changed: false, was: "none" };

  const result = await setStudentCoTutors({ studentId, lecturerIds: remaining, assignedById });
  if (!result.ok) return result;
  return { ok: true, changed: result.changed, was: "co_tutor" };
}
