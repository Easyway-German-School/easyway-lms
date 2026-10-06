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
import { isOnlineBranch } from "@/lib/online-branch";
import { setStudentCoTutors, setStudentTutor } from "@/lib/tutor-pairing";
import {
  assignmentMatchesStudent,
  readAssignment,
  type AssignmentAttemptStudent,
  type MatchClassType as AssignmentMatchClassType,
} from "@/lib/lecturer-assignment";

type MatchClassType = AssignmentMatchClassType;
type AttemptStudent = AssignmentAttemptStudent;

type MatchOutcome =
  | { status: "matched"; lecturerId: string; lecturerName: string }
  | { status: "no-match" }
  | { status: "ambiguous"; lecturerIds: string[] };

async function findMatch(
  classType: MatchClassType,
  student: AttemptStudent,
  tenantId: string | null,
  /**
   * Tutors the student already has. Only the re-placement path passes this: a
   * student moving batch whose current tutor still covers the destination
   * should stay with them rather than be flagged "ambiguous" against a second
   * tutor with the same coverage. New signups pass nothing, so their behaviour
   * is exactly what it was.
   */
  prefer: Array<string | null | undefined> = [],
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

  const matches = lecturers.filter((lecturer) => assignmentMatchesStudent(readAssignment(lecturer), classType, student));

  if (matches.length === 0) return { status: "no-match" };
  if (matches.length > 1) {
    const kept = matches.find((lecturer) => prefer.includes(lecturer.id));
    if (!kept) return { status: "ambiguous", lecturerIds: matches.map((lecturer) => lecturer.id) };
    return { status: "matched", lecturerId: kept.id, lecturerName: kept.user.name || kept.user.email };
  }
  const matched = matches[0];
  return { status: "matched", lecturerId: matched.id, lecturerName: matched.user.name || matched.user.email };
}

/**
 * Points at the student who actually needs the hand-assignment, not at the
 * tutor list in general. A message that names the student but a link that
 * lands on a generic screen makes the admin re-find them by hand — exactly
 * the "the notification doesn't lead anywhere" complaint this replaces.
 */
async function alertAdmin(reason: string, detail: string, studentId: string): Promise<void> {
  await notify({
    to: { audience: "admin" },
    kind: KIND.announcement,
    severity: "warning",
    title: `Tutor auto-assignment needs attention: ${reason}`,
    message: detail,
    link: `/admin/students/${studentId}`,
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
    input.studentId,
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
      input.studentId,
    );
  }

  if (onlineOutcome.status !== "matched") {
    await alertAdmin(
      onlineOutcome.status === "no-match" ? "no online tutor found for hybrid student" : "more than one online tutor matched a hybrid student",
      `${input.studentName} (${input.level}, hybrid — online half, ${input.hybridOnlineSlot}) needs an online tutor assigned by hand.`,
      input.studentId,
    );
    return;
  }

  const features = input.tenantId ? await featuresFor(input.tenantId) : null;
  if (features && !features.roster.sharedStudents) {
    await alertAdmin(
      "shared-students feature is off",
      `${input.studentName} matched an online tutor for their hybrid combo, but "shared students" is off for this school, so a second tutor couldn't be added automatically. Turn it on in /admin/platform, or add the co-tutor by hand.`,
      input.studentId,
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

export type ReplacementOutcome = "unchanged" | "reassigned" | "needs-attention" | "skipped";

/**
 * Re-point a student's tutor(s) after the OFFICE has moved them to a different
 * batch or level (a cohort transfer, a promotion into a chosen intake).
 *
 * Signup auto-assign never runs again for an existing student, so before this a
 * student moved from August to October kept their August tutor: the August
 * tutor's roster still showed them (a named tutor always beats the batch check
 * in `belongsToLecturer`) and the October tutor never saw them.
 *
 * Same fail-safe as the signup path - exactly one tutor whose coverage matches
 * the student's NEW placement, or nothing is changed and the office is told by
 * name. Two things differ, both because this student already has a tutor:
 *   - a current tutor who still covers the new placement is kept, so a tutor
 *     who runs both batches does not lose their own student to a tie;
 *   - when nothing matches, the student stays with the tutor they have and the
 *     office is alerted, rather than ending up with nobody.
 *
 * Private-class students are skipped: their tutor is a one-to-one arrangement
 * the office makes by hand, not a coverage pattern.
 */
export async function reassignTutorForPlacement(
  studentId: string,
  placementLabel: string,
): Promise<ReplacementOutcome> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      tenantId: true,
      branchId: true,
      level: true,
      sessionSlot: true,
      deliveryMode: true,
      hybridOnlineSlot: true,
      classType: true,
      admission: true,
      tutorId: true,
      coTutors: { select: { lecturerId: true, role: true } },
      branch: { select: { name: true, mode: true } },
      tutor: { select: { user: { select: { name: true, email: true } } } },
      user: { select: { name: true, email: true } },
    },
  });
  if (!student) return "skipped";
  if (student.classType === "private") return "skipped";

  const studentName = student.user?.name || student.user?.email || "A student";
  const currentTutorName = student.tutor?.user?.name || student.tutor?.user?.email || null;
  const keep = [student.tutorId, ...student.coTutors.map((row) => row.lecturerId)];

  const mode: AutoAssignInput["deliveryMode"] =
    student.deliveryMode === "hybrid"
      ? "hybrid"
      : student.deliveryMode === "online" || isOnlineBranch(student.branch)
        ? "online"
        : "physical";

  const stillWith = currentTutorName ? ` They are still with ${currentTutorName}.` : "";
  const needsHand = async (why: string) => {
    await alertAdmin(
      why,
      `${studentName} (${student.level}, ${placementLabel}) has been moved, but no single tutor's coverage matches the new placement.${stillWith} Assign their tutor by hand.`,
      student.id,
    );
  };

  if (mode !== "hybrid") {
    const classType: MatchClassType = mode === "online" ? "online" : "physical";
    const outcome = await findMatch(
      classType,
      { branchId: student.branchId, level: student.level, sessionSlot: student.sessionSlot, admission: student.admission },
      student.tenantId,
      keep,
    );
    if (outcome.status !== "matched") {
      await needsHand(outcome.status === "no-match" ? `no ${classType} tutor covers ${placementLabel}` : `more than one ${classType} tutor covers ${placementLabel}`);
      return "needs-attention";
    }
    if (outcome.lecturerId === student.tutorId) return "unchanged";
    // Not quiet: the student is told who their tutor is now, and the new tutor
    // is told a student has joined their class.
    await setStudentTutor({ studentId: student.id, lecturerId: outcome.lecturerId });
    await notifyAdminAssigned(`${studentName} moved to ${placementLabel} and was assigned to ${outcome.lecturerName}.`);
    return "reassigned";
  }

  // Hybrid: a campus tutor (the primary) and an online tutor (a tagged co-tutor).
  const onlineBranch = await prisma.branch.findFirst({
    where: { mode: "online", ...(student.tenantId ? { tenantId: student.tenantId } : {}) },
    select: { id: true },
  });
  const [physical, online] = await Promise.all([
    findMatch("physical", { branchId: student.branchId, level: student.level, sessionSlot: student.sessionSlot, admission: student.admission }, student.tenantId, keep),
    onlineBranch && student.hybridOnlineSlot
      ? findMatch("online", { branchId: onlineBranch.id, level: student.level, sessionSlot: student.hybridOnlineSlot, admission: student.admission }, student.tenantId, keep)
      : Promise.resolve<MatchOutcome>({ status: "no-match" }),
  ]);

  let result: ReplacementOutcome = "unchanged";

  if (physical.status === "matched") {
    if (physical.lecturerId !== student.tutorId) {
      await setStudentTutor({ studentId: student.id, lecturerId: physical.lecturerId });
      await notifyAdminAssigned(`${studentName} moved to ${placementLabel} and was assigned ${physical.lecturerName} as their campus tutor.`);
      result = "reassigned";
    }
  } else {
    await needsHand(`no single campus tutor covers ${placementLabel}`);
    result = "needs-attention";
  }

  if (online.status === "matched") {
    const features = student.tenantId ? await featuresFor(student.tenantId) : null;
    const alreadyOnline = student.coTutors.some((row) => row.role === "online" && row.lecturerId === online.lecturerId);
    if (!alreadyOnline && (!features || features.roster.sharedStudents)) {
      const keptExisting = student.coTutors.filter((row) => row.role !== "online").map((row) => row.lecturerId);
      await setStudentCoTutors({
        studentId: student.id,
        lecturerIds: [...keptExisting, online.lecturerId],
        roles: { [online.lecturerId]: "online" },
      });
      await notifyAdminAssigned(`${studentName} moved to ${placementLabel} and was assigned ${online.lecturerName} as their online tutor.`);
      if (result === "unchanged") result = "reassigned";
    }
  } else if (student.hybridOnlineSlot) {
    await needsHand(`no single online tutor covers ${placementLabel}`);
    result = "needs-attention";
  }

  return result;
}
