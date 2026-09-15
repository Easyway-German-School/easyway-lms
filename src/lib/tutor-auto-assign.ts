/**
 * Write-time tutor assignment.
 *
 * Before this, a tutor's roster was pure query-time pattern matching
 * (`lecturer-assignment.ts`): an admin describes a class (branch × level ×
 * session × class type), and every student matching it shows up on the
 * roster — with an empty list on any of those meaning "no restriction". That
 * is exactly how one tutor ended up with the entire A1–B2 online/hybrid
 * cohort: a coverage pattern left broader than intended quietly swept in
 * every student who matched it, with nothing to flag that the match was too
 * wide.
 *
 * This module is the other direction: given a new (or newly re-combo'd)
 * student, find the ONE tutor whose coverage matches them and write
 * `Student.tutorId` directly, instead of leaving it to be discovered by a
 * query. A hybrid student needs two matches — one tutor for their physical
 * sitting, one for their online sitting — the physical one becomes the
 * primary `tutorId`, the online one a `StudentCoTutor` tagged `role:
 * "online"`.
 *
 * FAIL SAFE ON PURPOSE. Zero matches or more than one match both mean the
 * office's coverage patterns don't cleanly describe this student yet. Rather
 * than guess (leaving them on nobody, or worse, picking the first match),
 * this leaves `tutorId` untouched and tells an admin by name — the same
 * failure mode that produced the 111-student sweep, just caught instead of
 * silently "resolved" by whichever pattern happened to match everything.
 */

import { prisma } from "@/lib/prisma";
import { KIND, notify } from "@/lib/notify";
import { featuresFor } from "@/lib/tenant/features-server";
import { setStudentCoTutors, setStudentTutor } from "@/lib/tutor-pairing";
import {
  belongsToLecturer,
  CLASS_TYPES,
  isAssigned,
  readAssignment,
  type LecturerAssignment,
} from "@/lib/lecturer-assignment";

type MatchClassType = "physical" | "online";

type AttemptStudent = {
  branchId: string | null;
  level: string;
  sessionSlot: string;
  admission?: unknown;
};

function coversClassType(assignment: LecturerAssignment, classType: MatchClassType): boolean {
  const types = assignment.classTypes.map((type) => type.toLowerCase());
  // Empty, or every class type selected, both mean "no restriction" — the
  // same rule studentWhereForAssignment uses.
  if (!types.length || types.length >= CLASS_TYPES.length) return true;
  return types.includes(classType);
}

/**
 * Does this tutor's coverage cover this student's attempt (one side of a
 * hybrid combo, or the whole of a physical/online-only student)?
 *
 * Branch/level/session are checked here directly — `belongsToLecturer` only
 * covers the in-memory batch/named-tutor half of the question, on the
 * assumption a SQL `where` already did this part.
 */
function lecturerMatchesAttempt(
  assignment: LecturerAssignment,
  classType: MatchClassType,
  student: AttemptStudent,
): boolean {
  if (!isAssigned(assignment)) return false;

  const level = student.level.toUpperCase();
  const sessionSlot = student.sessionSlot.toLowerCase();

  const branchLevelSessionOk = assignment.groups.length
    ? assignment.groups.some(
        (group) =>
          group.branchId === student.branchId &&
          group.level.toUpperCase() === level &&
          group.sessionSlot.toLowerCase() === sessionSlot,
      )
    : Boolean(student.branchId) &&
      assignment.branchIds.includes(student.branchId as string) &&
      assignment.levels.some((candidate) => candidate.toUpperCase() === level) &&
      (!assignment.sessionSlots.length ||
        assignment.sessionSlots.some((candidate) => candidate.toLowerCase() === sessionSlot));

  if (!branchLevelSessionOk) return false;
  if (!coversClassType(assignment, classType)) return false;

  return belongsToLecturer(assignment, null, {
    admission: student.admission,
    branchId: student.branchId,
    level: student.level,
    sessionSlot: student.sessionSlot,
  });
}

type MatchOutcome =
  | { status: "matched"; lecturerId: string; lecturerName: string }
  | { status: "no-match" }
  | { status: "ambiguous"; lecturerIds: string[] };

async function findMatch(
  classType: MatchClassType,
  student: AttemptStudent,
  tenantId: string | null,
): Promise<MatchOutcome> {
  const lecturers = await prisma.lecturer.findMany({
    where: { status: "active", deletedAt: null, tenantId: tenantId ?? undefined },
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
  });

  const matches = lecturers.filter((lecturer) => lecturerMatchesAttempt(readAssignment(lecturer), classType, student));

  if (matches.length === 0) return { status: "no-match" };
  if (matches.length > 1) return { status: "ambiguous", lecturerIds: matches.map((lecturer) => lecturer.id) };
  const matched = matches[0];
  return { status: "matched", lecturerId: matched.id, lecturerName: matched.user.name || matched.user.email };
}

async function alertAdmin(reason: string, detail: string): Promise<void> {
  await notify({
    to: { audience: "admin" },
    kind: KIND.announcement,
    severity: "warning",
    title: `Tutor auto-assignment needs attention: ${reason}`,
    message: detail,
    link: "/admin/lecturer-invite",
    push: true,
  }).catch((error) => console.error("Auto-assign admin alert failed", error));
}

/**
 * The success-path counterpart to `alertAdmin` — one line per match, so the
 * office sees a scannable feed of who signed up for what and who they landed
 * on, before the student themselves is told (that reveal waits for payment,
 * see lib/tutor-reveal.ts). Not pushed: this is a log to skim, not an
 * interrupt — a school doing a normal morning of signups should not get a
 * phone buzz per student.
 */
async function notifyAdminAssigned(detail: string): Promise<void> {
  await notify({
    to: { audience: "admin", capability: "students" },
    kind: KIND.tutorAssigned,
    severity: "info",
    title: "Tutor auto-assigned",
    message: detail,
    link: "/admin/lecturer-invite",
  }).catch((error) => console.error("Auto-assign admin notify failed", error));
}

export type AutoAssignInput = {
  studentId: string;
  studentName: string;
  tenantId: string | null;
  branchId: string | null;
  level: string;
  deliveryMode: "physical" | "hybrid" | "online";
  /** Physical slot for physical/hybrid; the only slot for online-only. */
  sessionSlot: string;
  /** Required to attempt the online half of a hybrid combo. */
  hybridOnlineSlot?: string | null;
  admission?: unknown;
};

async function assignSingleMode(input: AutoAssignInput, classType: MatchClassType): Promise<void> {
  const outcome = await findMatch(classType, {
    branchId: input.branchId,
    level: input.level,
    sessionSlot: input.sessionSlot,
    admission: input.admission,
  }, input.tenantId);

  if (outcome.status === "matched") {
    await setStudentTutor({ studentId: input.studentId, lecturerId: outcome.lecturerId, quiet: true });
    await notifyAdminAssigned(
      `${input.studentName} signed up for ${input.level} — ${classType === "physical" ? "on campus" : "online"}, ${input.sessionSlot} — and was auto-assigned to ${outcome.lecturerName}.`,
    );
    return;
  }
  await alertAdmin(
    outcome.status === "no-match" ? `no ${classType} tutor found` : `more than one ${classType} tutor matched`,
    `${input.studentName} (${input.level}, ${classType}, ${input.sessionSlot}) needs a tutor assigned by hand.`,
  );
}

async function assignHybrid(input: AutoAssignInput): Promise<void> {
  if (!input.hybridOnlineSlot) return; // combo not picked yet

  const onlineBranch = await prisma.branch.findFirst({
    where: { mode: "online", ...(input.tenantId ? { tenantId: input.tenantId } : {}) },
    select: { id: true },
  });

  const [physicalOutcome, onlineOutcome] = await Promise.all([
    findMatch("physical", { branchId: input.branchId, level: input.level, sessionSlot: input.sessionSlot, admission: input.admission }, input.tenantId),
    onlineBranch
      ? findMatch("online", { branchId: onlineBranch.id, level: input.level, sessionSlot: input.hybridOnlineSlot, admission: input.admission }, input.tenantId)
      : Promise.resolve<MatchOutcome>({ status: "no-match" }),
  ]);

  if (physicalOutcome.status === "matched") {
    await setStudentTutor({ studentId: input.studentId, lecturerId: physicalOutcome.lecturerId, quiet: true });
    await notifyAdminAssigned(
      `${input.studentName} signed up for ${input.level} hybrid (campus ${input.sessionSlot}) and was auto-assigned ${physicalOutcome.lecturerName} as their campus tutor.`,
    );
  } else {
    await alertAdmin(
      physicalOutcome.status === "no-match" ? "no physical tutor found for hybrid student" : "more than one physical tutor matched a hybrid student",
      `${input.studentName} (${input.level}, hybrid — physical half, ${input.sessionSlot}) needs a physical tutor assigned by hand.`,
    );
  }

  if (onlineOutcome.status !== "matched") {
    await alertAdmin(
      onlineOutcome.status === "no-match" ? "no online tutor found for hybrid student" : "more than one online tutor matched a hybrid student",
      `${input.studentName} (${input.level}, hybrid — online half, ${input.hybridOnlineSlot}) needs an online tutor assigned by hand.`,
    );
    return;
  }

  const features = input.tenantId ? await featuresFor(input.tenantId) : null;
  if (features && !features.roster.sharedStudents) {
    await alertAdmin(
      "shared-students feature is off",
      `${input.studentName} matched an online tutor for their hybrid combo, but "shared students" is off for this school, so a second tutor couldn't be added automatically. Turn it on in /admin/platform, or add the co-tutor by hand.`,
    );
    return;
  }

  const student = await prisma.student.findUnique({
    where: { id: input.studentId },
    select: { coTutors: { select: { lecturerId: true, role: true } } },
  });
  const keptExisting = (student?.coTutors ?? [])
    .filter((row) => row.role !== "online")
    .map((row) => row.lecturerId);

  await setStudentCoTutors({
    studentId: input.studentId,
    lecturerIds: [...keptExisting, onlineOutcome.lecturerId],
    roles: { [onlineOutcome.lecturerId]: "online" },
    quiet: true,
  });
  await notifyAdminAssigned(
    `${input.studentName} signed up for ${input.level} hybrid (online ${input.hybridOnlineSlot}) and was auto-assigned ${onlineOutcome.lecturerName} as their online tutor.`,
  );
}

/** Entry point — routes to the single-mode or hybrid matcher and writes the result. */
export async function autoAssignTutor(input: AutoAssignInput): Promise<void> {
  if (input.deliveryMode === "hybrid") {
    await assignHybrid(input);
    return;
  }
  await assignSingleMode(input, input.deliveryMode === "online" ? "online" : "physical");
}
