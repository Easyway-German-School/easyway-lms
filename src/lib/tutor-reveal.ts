/**
 * Tells a student who their tutor is — once, and not before they have paid.
 *
 * `tutor-auto-assign.ts` writes `Student.tutorId` (and an online co-tutor for
 * a hybrid student) the moment they sign up, so admin tooling, materials
 * targeting and the roster all work pre-payment. But a student who has not
 * paid anything yet should not be told who is teaching them — that reveal
 * belongs to the moment they have actually committed, a deposit or the full
 * fee. This is the other half of that write: called from
 * `persistPaystackTransaction` right after a payment lands, it tells the
 * student for the first time (and only the first time — `admission.
 * tutorRevealedAt` is the guard, so a retried webhook or a second
 * part-payment does not repeat it).
 */

import { prisma } from "@/lib/prisma";
import { KIND, notify } from "@/lib/notify";

export async function revealTutorAfterPayment(studentId: string): Promise<void> {
  try {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        tutorId: true,
        classType: true,
        deliveryMode: true,
        admission: true,
        tutor: { select: { user: { select: { name: true, email: true } } } },
        coTutors: {
          select: { role: true, lecturer: { select: { user: { select: { name: true, email: true } } } } },
        },
      },
    });
    if (!student?.tutorId || !student.tutor) return;

    const admission =
      student.admission && typeof student.admission === "object"
        ? (student.admission as Record<string, unknown>)
        : {};
    if (admission.tutorRevealedAt) return;

    const physicalName = student.tutor.user.name || student.tutor.user.email;
    const onlineCoTutor = student.coTutors.find((row) => row.role === "online");
    const onlineName = onlineCoTutor ? onlineCoTutor.lecturer.user.name || onlineCoTutor.lecturer.user.email : null;

    const message =
      student.classType === "private"
        ? `${physicalName} will be taking your private classes. They will be in touch to agree your times, and your sessions will appear on your calendar once booked.`
        : onlineName
          ? `${physicalName} is your campus tutor and ${onlineName} is your online tutor — they can both see your progress and will be marking your work.`
          : `${physicalName} is now your tutor. They can see your progress and will be marking your work.`;

    await notify({
      to: { studentIds: [studentId] },
      kind: KIND.tutorAssigned,
      severity: "success",
      title: "Your tutor has been assigned",
      message,
      link: student.classType === "private" ? "/calendar" : "/classes",
      push: true,
    }).catch((error) => console.error("Tutor reveal notification failed", error));

    await prisma.student.update({
      where: { id: studentId },
      data: { admission: { ...admission, tutorRevealedAt: new Date().toISOString() } },
    });
  } catch (error) {
    // Best-effort, like the rest of the payment pipeline this is called
    // from: a missed reveal is not a reason to fail a payment that has
    // already been recorded. The student sees their tutor next time this
    // runs (another payment) or on a later manual nudge.
    console.error("revealTutorAfterPayment failed", { studentId, error });
  }
}
