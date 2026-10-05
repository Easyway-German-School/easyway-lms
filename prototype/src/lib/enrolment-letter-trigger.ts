import { prisma } from "@/lib/prisma";
import { hasPaidAnyTuition } from "@/lib/payment";
import { getStudentAccess } from "@/lib/student-access";
import { sendEnrolmentLetterEmail } from "@/lib/enrolment-letter-email";

/**
 * Fires the automatic proof-of-enrolment letter the moment — and only the
 * moment — a student makes their FIRST tuition payment, in full or in part.
 *
 * WHY THIS EXISTS. The letter used to go out as part of the registration
 * confirmation, right after the ₦5,000 registration fee — before a student
 * had paid a naira of actual tuition. A document that says "enrolled" landing
 * on the day someone pays an application fee is a promise the school has not
 * made yet, so it waits for the signal that means the promise is true: money
 * toward TUITION has been received (`hasPaidAnyTuition`). It used to wait for
 * tuition to be paid IN FULL, which left part-payers — most of the Travel
 * Package students — without the letter their visa appointment needs; the
 * school's rule is "after they have paid tuition, whether full or part, never
 * before". Whether the balance is cleared only changes the wording of the
 * email and PDF, not whether they get one.
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

    if (!hasPaidAnyTuition(student.payments)) return;

    // Wording only. Same ledger-aware verdict the portal and the PDF routes
    // use — a flat lifetime-total-vs-fee compare misreads promoted students.
    const access = await getStudentAccess(student.id);
    const tuitionSettled = (access?.outstandingBalance ?? Infinity) <= 0;

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
      tuitionSettled,
    });
  } catch (error) {
    console.error("notifyEnrolmentLetterIfSettled failed:", { studentId, error });
  }
}
