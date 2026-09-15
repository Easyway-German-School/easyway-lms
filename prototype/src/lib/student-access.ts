import { prisma } from "@/lib/prisma";
import { deriveStudentAccess, type StudentAccess } from "@/lib/access";
import { requiredDepositFor, tuitionFeeFor, receivedPaymentFilter, isTravelPackagePathway } from "@/lib/payment";
import { planStatusForStudent, planSuppressesLock } from "@/lib/payment-plans";

/**
 * The full access verdict for a student — deposit, ledger, grace, payment
 * plan, all of it. The exact computation `/api/student/access` runs to
 * decide whether to show the payment lock screen. Pulled into one function so
 * other routes that need the same answer (the live-class poll, the
 * assignment-availability nudge, say) do not each re-derive it slightly
 * differently and drift — which is exactly what happened when
 * `/api/live/session` hand-rolled a `deriveStudentAccess` call without
 * `charges`, `flatDeposit`, or `paymentPlanOnTrack`: a student the ledger
 * (promotions, waivers, an on-track payment plan) says is fine got walled
 * out of the room the portal itself showed as open.
 */
export async function getStudentAccess(studentId: string): Promise<StudentAccess | null> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      level: true,
      classType: true,
      pathway: true,
      deliveryMode: true,
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
  if (!student) return null;

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
    deliveryMode: student.deliveryMode,
    classType: student.classType,
    level: student.level,
    charges: student.tuitionCharges,
    flatDeposit: isTravelPackagePathway(student.pathway),
    classesStartedAt: student.classesStartedAt,
    enrolledAt: student.createdAt,
    paymentGraceUntil: student.paymentGraceUntil,
    paymentPlanOnTrack: planSuppressesLock(planStatus?.adherence ?? null),
  });
}

/**
 * Does this student's portal still open? Same computation as
 * `getStudentAccess`, collapsed to the one boolean most callers need.
 *
 * Deliberately NOT the photo lock: that is a separate gate with its own
 * screen, and "you have no profile photo" is not a reason to hide from a
 * student that their class has started.
 */
export async function studentHasPortalAccess(studentId: string): Promise<boolean> {
  const access = await getStudentAccess(studentId);
  return access?.hasAccess ?? false;
}
