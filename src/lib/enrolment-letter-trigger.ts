import { prisma } from "@/lib/prisma";
import { isReceivedPayment, isRegistrationFeePayment, tuitionFeeFor } from "@/lib/payment";
import { sendEnrolmentLetterEmail } from "@/lib/enrolment-letter-email";

/**
 * Fires the automatic proof-of-enrolment letter the moment — and only the
 * moment — a student's tuition for their level is fully settled.
 *
 * WHY THIS EXISTS. The letter used to go out as part of the registration
 * confirmation, right after the ₦5,000 registration fee — before a student
 * had paid a naira of actual tuition. A document that says "enrolled" landing
 * on the day someone pays an application fee is a promise the school has not
 * made yet, so it now waits for the one signal that means the promise is
 * true: `isTuitionPayment` total >= `tuitionFeeFor` this level/branch/pathway
 * — the exact same test the on-demand PDF route already uses to decide what
 * to write about the student's balance.
 *
 * Called from every place money can cross that line — the Paystack webhook,
 * the Paystack client-side verify, the Stripe webhook, and a hand-entered
 * admin payment — because any one of them can be the payment that tips the
 * balance, and a cash payment at the front desk never touches a gateway at
 * all. `Student.enrolmentLetterSentAt` is claimed with an atomic
 * `updateMany` so whichever of those call sites gets here first wins and a
 * duplicate webhook, or a later top-up on an already-settled account, cannot
 * resend it.
 *
 * Deliberately unable to throw: this runs inside payment webhooks that a
 * gateway retries on a non-2xx response, and a mail hiccup here must never
 * look like the payment itself failed to record.
 */
export async function notifyEnrolmentLetterIfSettled(studentId: string): Promise<void> {
  try {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        studentCode: true,
        level: true,
        classType: true,
        pathway: true,
        deliveryMode: true,
        createdAt: true,
        classesStartedAt: true,
        enrolmentLetterSentAt: true,
        branch: { select: { name: true } },
        user: { select: { name: true, email: true, tenant: { select: { brandName: true } } } },
        payments: { where: { status: { in: ["completed", "partial"] } }, select: { amount: true, status: true, description: true } },
      },
    });

    if (!student || !student.user?.email || student.enrolmentLetterSentAt) return;

    const totalPaid = student.payments
      .filter((p) => isReceivedPayment(p.status) && !isRegistrationFeePayment(p.description))
      .reduce((sum, p) => sum + p.amount, 0);
    const tuitionSettled =
      totalPaid >=
      tuitionFeeFor({
        level: student.level,
        branch: student.branch?.name ?? null,
        classType: student.classType,
        pathway: student.pathway,
      });

    if (!tuitionSettled) return;

    // Atomic claim: only the caller that actually flips `null` -> a timestamp
    // sends the email. Everyone else (a duplicate webhook, a second call site
    // observing the same crossing) finds `count === 0` and does nothing.
    const claimed = await prisma.student.updateMany({
      where: { id: student.id, enrolmentLetterSentAt: null },
      data: { enrolmentLetterSentAt: new Date() },
    });
    if (claimed.count === 0) return;

    await sendEnrolmentLetterEmail({
      studentName: student.user.name ?? "Student",
      studentEmail: student.user.email,
      studentCode: student.studentCode,
      level: student.level,
      pathway: student.pathway,
      branchName: student.branch?.name ?? null,
      deliveryMode: student.deliveryMode,
      enrolledAt: student.classesStartedAt ?? student.createdAt,
      schoolName: student.user.tenant?.brandName ?? undefined,
    });
  } catch (error) {
    console.error("notifyEnrolmentLetterIfSettled failed:", { studentId, error });
  }
}
