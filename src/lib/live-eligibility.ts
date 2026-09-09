import { prisma } from "@/lib/prisma";
import { hasProfilePhoto } from "@/lib/access";
import { studentHasPortalAccess } from "@/lib/student-access";

/**
 * Can this student actually walk into a live class right now?
 *
 * TWO locks wall the student portal, and either one shuts a student out of a
 * live class:
 *   - payment — the deposit is not cleared, or the balance is overdue past the
 *     grace window (`studentHasPortalAccess`, the same check the payment lock
 *     screen runs).
 *   - photo — paid up, but no profile photo on file yet (`hasProfilePhoto`).
 *     `/live` and every class page render the photo lock screen for them.
 *
 * The "your class is live now" popup and its phone push must not fire for a
 * student behind EITHER lock: a notification whose only answer is a lock
 * screen is a tease, not a nudge. This is the single place that asks the whole
 * question, so the live-state poll and the notification fan-out cannot drift.
 */
export async function studentCanEnterLiveClass(studentId: string): Promise<boolean> {
  const [paymentOpen, row] = await Promise.all([
    studentHasPortalAccess(studentId),
    prisma.student.findUnique({ where: { id: studentId }, select: { admission: true } }),
  ]);
  return paymentOpen && hasProfilePhoto(row?.admission);
}

/**
 * The subset of these students who can enter a live class. Order is not
 * preserved; duplicates and empty ids are dropped. Used to trim a "class is
 * live" push down to the students who could actually act on it.
 */
export async function studentsWhoCanEnterLiveClass(studentIds: string[]): Promise<string[]> {
  const ids = [...new Set(studentIds.filter(Boolean))];
  const verdicts = await Promise.all(
    ids.map(async (id) => ((await studentCanEnterLiveClass(id)) ? id : null)),
  );
  return verdicts.filter((id): id is string => id !== null);
}
