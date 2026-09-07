import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";
import { computeStudentFinance, FINANCE_STUDENT_SELECT, type FinanceStudentInput } from "@/lib/finance/receivables";
import { isTravelPackagePathway, TRAVEL_PACKAGE_MIN_FIRST_PAYMENT, TRAVEL_PACKAGE_PATHWAY, TRAVEL_PACKAGE_PRICE } from "@/lib/payment";
import { reconcileTravelPackageStudent } from "@/lib/travel-package";
import { travelPackagePartPaymentNotice } from "@/lib/travel-package-notice";

/**
 * The Travel Package roster — every student on the pathway, with the exact
 * same finance figures (owed, progress, cohort) every other screen computes,
 * because this reads through `computeStudentFinance` rather than
 * re-deriving anything. `tuitionFeeFor`/`requiredDepositFor` already know
 * this pathway prices at a flat ₦980,000 with a ₦200,000 floor — see
 * src/lib/payment.ts — so this route is almost entirely plumbing.
 */
export async function GET() {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const students = await prisma.student.findMany({
    where: { pathway: TRAVEL_PACKAGE_PATHWAY },
    select: { ...FINANCE_STUDENT_SELECT, studentCode: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const rows = students.map((student) => {
    const finance = computeStudentFinance(student as unknown as FinanceStudentInput);
    // What the balance SHOULD be for a flat ₦980,000 programme. When the live
    // `owed` disagrees, the student's tuition ledger still carries a per-level
    // charge (onboarded before flat pricing, a failed charge-create, or the
    // pathway switched after the charge was raised) and needs reconciling.
    const expectedOwed = Math.max(0, TRAVEL_PACKAGE_PRICE - finance.paid);
    return {
      id: student.id,
      studentCode: student.studentCode,
      name: finance.name,
      email: finance.email,
      level: finance.level,
      branch: finance.branch,
      firstPaymentMet: finance.paid >= TRAVEL_PACKAGE_MIN_FIRST_PAYMENT,
      paid: finance.paid,
      owed: finance.owed,
      progressPercent: finance.progressPercent,
      fullPaid: finance.fullPaid,
      lockedOut: finance.lockedOut,
      ledgerOutOfStep: finance.owed !== expectedOwed,
    };
  });

  return NextResponse.json({
    packagePrice: TRAVEL_PACKAGE_PRICE,
    minFirstPayment: TRAVEL_PACKAGE_MIN_FIRST_PAYMENT,
    students: rows,
  });
}

/**
 * Put one student's Travel Package standing straight — the office button.
 *
 *   { studentId }                    move the student onto the pathway (if they
 *                                    are not already) AND collapse their tuition
 *                                    ledger to the one flat ₦980,000 charge.
 *
 * Idempotent: running it on an already-correct student is a no-op. It never
 * touches money that came in — only the debit side. When the fix moves the
 * student from "paid in full" to "balance owing", they get a warm heads-up on
 * their portal (see travel-package-notice.ts); nothing else is shown to them.
 *
 * Gated on `payments`, not `students`: turning a student into a ₦980,000
 * liability is a money decision, and it mirrors the "Record payment" button on
 * this same page, which already posts to a `payments`-gated route.
 */
export async function PATCH(request: Request) {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const studentId = typeof body.studentId === "string" ? body.studentId.trim() : "";
  if (!studentId) {
    return NextResponse.json({ error: "studentId is required" }, { status: 400 });
  }

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      pathway: true,
      branch: { select: { tenantId: true } },
      user: { select: { tenantId: true, name: true } },
    },
  });
  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }
  // Same tenant fence the rest of the admin API uses — match on the branch or
  // the user account, so a no-branch (online / imported) student is still ours.
  const tenantId = gate.session.user.tenantId ?? null;
  if (
    tenantId &&
    student.branch?.tenantId !== tenantId &&
    student.user?.tenantId !== tenantId
  ) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  const wasOnPathway = isTravelPackagePathway(student.pathway);

  let result;
  try {
    result = await reconcileTravelPackageStudent({ studentId, setPathway: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Could not reconcile this student", detail: error instanceof Error ? error.message : "Unknown" },
      { status: 500 },
    );
  }
  if (!result) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  try {
    await travelPackagePartPaymentNotice(result);
  } catch (noticeError) {
    console.error("Travel Package part-payment notice failed", { studentId, noticeError });
  }

  return NextResponse.json({
    ok: true,
    wasOnPathway,
    name: student.user?.name ?? null,
    reconcile: result,
  });
}
