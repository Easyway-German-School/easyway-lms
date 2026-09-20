import { prisma } from "@/lib/prisma";
import { notify, KIND } from "@/lib/notify";
import { studentHasPortalAccess } from "@/lib/student-access";
import { assignmentVisibleToWhere } from "@/lib/student-assignments";
import { resolveOnlineBranchId } from "@/lib/online-branch-server";

/**
 * "You can submit assignments now" — Becca's one-time heads-up for a student
 * whose portal has just unlocked (the 60% deposit, or full payment) and who
 * has at least one assignment sitting there unsubmitted.
 *
 * The bug this closes: a student who has paid finds out assignments exist
 * only by opening the tab themselves, and a student who is still locked out
 * gets told about a feature they cannot use yet — which reads as the portal
 * being broken. Gating on `studentHasPortalAccess` (the exact same check the
 * lock screen itself runs) means this only ever reaches someone who can act
 * on it immediately.
 *
 * ONCE EVER, not weekly like the photo/branch nudges: unlocking is a single
 * event in a student's life, not a gap that reopens, so the dedupeKey carries
 * no date component. `notify()` fans a shared dedupeKey out per recipient
 * (see notify.ts), so a student who has already had this once is silently
 * skipped on every later tick — they simply stop appearing in `eligible`.
 */

/** Ceiling on how many active students we look at per tick. */
const SCAN_LIMIT = 800;
const DEDUPE_KEY = "assignments-available";

export async function nudgeStudentsWithAssignmentsAvailable() {
  // Anyone already sent this is dropped before the expensive per-student
  // checks run, so the cost of this job shrinks to "how many students
  // unlocked or got a new assignment since yesterday" rather than staying
  // flat at the size of the whole roster forever.
  const alreadyNotified = await prisma.notification.findMany({
    where: { dedupeKey: DEDUPE_KEY, userId: { not: null } },
    select: { userId: true },
  });
  const notifiedIds = new Set(alreadyNotified.map((n) => n.userId as string));

  const students = await prisma.student.findMany({
    where: {
      status: "active",
    },
    orderBy: { createdAt: "asc" },
    take: SCAN_LIMIT,
    select: {
      id: true,
      userId: true,
      level: true,
      branchId: true,
      sessionSlot: true,
      deliveryMode: true,
      hybridOnlineSlot: true,
    },
  });

  const candidates = students.filter((s) => s.userId && !notifiedIds.has(s.userId));
  if (candidates.length === 0) {
    return { scanned: students.length, eligible: 0, created: 0 };
  }

  // Once, not per student — a hybrid student's online tutor's homework counts
  // as "waiting for them" too (see student-assignments.ts).
  const onlineBranchId = await resolveOnlineBranchId(null);

  const eligible: string[] = [];
  for (const student of candidates) {
    const unlocked = await studentHasPortalAccess(student.id);
    if (!unlocked) continue;

    const pending = await prisma.assignment.count({
      where: {
        ...assignmentVisibleToWhere(student, onlineBranchId),
        submissions: { none: { studentId: student.id, submittedAt: { not: null } } },
      },
    });
    if (pending > 0) eligible.push(student.id);
  }

  if (eligible.length === 0) {
    return { scanned: students.length, eligible: 0, created: 0 };
  }

  const res = await notify({
    to: { studentIds: eligible },
    kind: KIND.assignmentsAvailable,
    severity: "info",
    title: "You can submit assignments now",
    message:
      "Becca here — your portal is unlocked, and there's work waiting for you in Assignments. Open it and hand in what you've got before a deadline creeps up.",
    link: "/assignment",
    push: true,
    dedupeKey: DEDUPE_KEY,
  });

  return { scanned: students.length, eligible: eligible.length, created: res.created };
}
