import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";
import { computeStudentFinance, FINANCE_STUDENT_SELECT, type FinanceStudentInput } from "@/lib/finance/receivables";
import { TRAVEL_PACKAGE_MIN_FIRST_PAYMENT, TRAVEL_PACKAGE_PATHWAY, TRAVEL_PACKAGE_PRICE } from "@/lib/payment";

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
    };
  });

  return NextResponse.json({
    packagePrice: TRAVEL_PACKAGE_PRICE,
    minFirstPayment: TRAVEL_PACKAGE_MIN_FIRST_PAYMENT,
    students: rows,
  });
}
