import { prisma } from "@/lib/prisma";
import { deriveStudentAccess } from "@/lib/access";
import { requiredDepositFor, tuitionFeeFor, receivedPaymentFilter, isTravelPackagePathway } from "@/lib/payment";
import { planStatusForStudent, planSuppressesLock } from "@/lib/payment-plans";

/**
 * Does this student's portal still open?
 *
 * i.e. have they cleared the 60% deposit and not fallen behind on the balance
 * past the 30-day grace — the exact computation `/api/student/access` runs to
 * decide whether to show the payment lock screen. Pulled into one function so
 * other routes that need the same answer (the live-class poll, say) do not
 * each re-derive it slightly differently and drift.
 *
 * Deliberately NOT the photo lock: that is a separate gate with its own
 * screen, and "you have no profile photo" is not a reason to hide from a
 * student that their class has started.
 */
export async function studentHasPortalAccess(studentId: string): Promise<boolean> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      level: true,
      classType: true,
      pathway: true,
      classesStartedAt: true,
      createdAt: true,
      paymentGraceUntil: true,
      branch: { select: { name: true } },
      payments: { where: receivedPaymentFilter(), select: { amount: true } },
      tuitionCharges: {
        where: { deletedAt: null },
        select: {
          id: true,
          level: true,
          amount: true,
          waivedAmount: true,
          legacyArrears: true,
          createdAt: true,
          settledAt: true,
        },
      },
    },
  });
  if (!student) return false;

  const totalPaid = student.payments.reduce((sum, payment) => sum + payment.amount, 0);
  const feeLookup = {
    level: student.level,
    branch: student.branch?.name ?? null,
    classType: student.classType,
    pathway: student.pathway,
  };
  const planStatus = await planStatusForStudent(studentId);

  return deriveStudentAccess({
    totalPaid,
    tuitionFee: tuitionFeeFor(feeLookup),
    requiredDeposit: requiredDepositFor(feeLookup),
    level: student.level,
    charges: student.tuitionCharges,
    flatDeposit: isTravelPackagePathway(student.pathway),
    classesStartedAt: student.classesStartedAt,
    enrolledAt: student.createdAt,
    paymentGraceUntil: student.paymentGraceUntil,
    paymentPlanOnTrack: planSuppressesLock(planStatus?.adherence ?? null),
  }).hasAccess;
}
