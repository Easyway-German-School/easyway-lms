import { prisma } from "@/lib/prisma";
import { deriveStudentAccess, type StudentAccess } from "@/lib/access";
import { requiredDepositFor, tuitionFeeFor, receivedPaymentFilter, isTravelPackagePathway } from "@/lib/payment";
import { planStatusForStudent, planSuppressesLock } from "@/lib/payment-plans";
import { isOnlineBranch } from "@/lib/online-branch";
import type { LedgerChargeInput } from "@/lib/finance/ledger";

/**
 * The exact Prisma field set the payment gate needs off a Student, as a
 * `select`-compatible object. Spread this into a bigger query (a dossier page
 * that also needs notifications and attendance, say) instead of retyping the
 * field list — retyping it is how a route ends up one field short of what
 * `accessFromStudent` actually reads.
 */
export const STUDENT_ACCESS_SELECT = {
  level: true,
  classType: true,
  pathway: true,
  deliveryMode: true,
  classesStartedAt: true,
  createdAt: true,
  paymentGraceUntil: true,
  // `mode` as well as `name`: an online-branch student whose own `deliveryMode`
  // column was never set (an import, a half-filled add-student form) must
  // still be treated as online below — the branch having no campus is the tell.
  branch: { select: { name: true, mode: true } },
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
} as const;

/** The shape `accessFromStudent` needs — exactly what `STUDENT_ACCESS_SELECT` fetches. */
export type StudentAccessFields = {
  level: string;
  classType: string;
  pathway: string;
  deliveryMode?: unknown;
  classesStartedAt: unknown;
  createdAt: unknown;
  paymentGraceUntil: unknown;
  branch: { name: string | null; mode?: string | null } | null;
  payments: Array<{ amount: number }>;
  tuitionCharges: LedgerChargeInput[];
};

/**
 * THE ONE PLACE THAT TURNS A FETCHED STUDENT INTO AN ACCESS VERDICT.
 *
 * Pure — no Prisma call of its own — so a route that has already fetched the
 * student for its own page (the admin dossier, the remote view, a roster
 * list) can call this directly on the row it already has instead of either
 * re-fetching (an extra round trip per student) or re-deriving the fields by
 * hand (the mistake that shipped twice: the admin dossier on 2026-09-14, then
 * `/api/live/session` + 2 more routes on 2026-09-15 — see
 * `scripts/check-payment-gate-drift.mjs`, which fails the build on a third).
 *
 * `paymentPlanOnTrack` is passed in rather than looked up here because it is
 * its own async Prisma call (`planStatusForStudent`) — cheap for one student
 * (`getStudentAccess` below does it), expensive repeated per row in a roster
 * of fifty. A caller that skips it gets a same-or-stricter answer, never a
 * false "open": the only thing `paymentPlanOnTrack` does is hold back a
 * balance lock that would otherwise apply.
 */
export function accessFromStudent(student: StudentAccessFields, paymentPlanOnTrack = false): StudentAccess {
  const totalPaid = student.payments.reduce((sum, payment) => sum + payment.amount, 0);
  const feeLookup = {
    level: student.level,
    branch: student.branch?.name ?? null,
    classType: student.classType,
    pathway: student.pathway,
  };

  return deriveStudentAccess({
    totalPaid,
    tuitionFee: tuitionFeeFor(feeLookup),
    requiredDeposit: requiredDepositFor(feeLookup),
    // An online-branch student whose own `deliveryMode` column was never set
    // must still resolve to "online" here, or every consumer of the returned
    // `.deliveryMode` (the sidebar, the live-tab check) wrongly treats them as
    // campus-only. `/api/student/access` used to apply this correction itself
    // and nowhere else did — now every caller of `accessFromStudent` gets it.
    deliveryMode: isOnlineBranch(student.branch) ? "online" : student.deliveryMode,
    classType: student.classType,
    level: student.level,
    charges: student.tuitionCharges,
    flatDeposit: isTravelPackagePathway(student.pathway),
    classesStartedAt: student.classesStartedAt,
    enrolledAt: student.createdAt,
    paymentGraceUntil: student.paymentGraceUntil,
    paymentPlanOnTrack,
  });
}

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
 *
 * Fetches its own row. A caller that already has one (see `accessFromStudent`
 * above) should call that instead rather than pay for a second query.
 */
export async function getStudentAccess(studentId: string): Promise<StudentAccess | null> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: STUDENT_ACCESS_SELECT,
  });
  if (!student) return null;

  const planStatus = await planStatusForStudent(studentId);
  return accessFromStudent(student, planSuppressesLock(planStatus?.adherence ?? null));
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
