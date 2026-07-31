import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  certificateEligibility,
  issueCertificateForStudent,
  toCertificateView,
} from "@/lib/certificates";
import { requiredDepositFor, tuitionFeeFor } from "@/lib/payment";

/**
 * A student's certificates, issuing the current level's on the way through.
 *
 * Issuing here rather than on a nightly job means a student who finishes on a
 * Friday has their certificate when they look for it, without the office having
 * to remember to run anything. `issueCertificateForStudent` is idempotent, so
 * the repeated visits this causes cannot mint duplicate serials.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const session = (await getServerSession(authOptions as any)) as any;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id as string },
    select: {
      id: true,
      level: true,
      admission: true,
      branch: { select: { name: true } },
      payments: { where: { status: "completed" }, select: { amount: true } },
    },
  });

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  const feeLookup = { level: student.level, branch: student.branch?.name ?? null };
  const totalPaid = student.payments.reduce((sum, payment) => sum + payment.amount, 0);
  // The live balance, which decides the provisional stamp on every certificate
  // the student holds — not just the one for their current level.
  const outstanding = Math.max(0, tuitionFeeFor(feeLookup) - totalPaid);

  const admission =
    typeof student.admission === "object" && student.admission !== null
      ? (student.admission as Record<string, unknown>)
      : {};
  const batch = typeof admission.batch === "string" && admission.batch.trim() ? admission.batch : null;

  const eligibility = certificateEligibility({
    batch,
    totalPaid,
    requiredDeposit: requiredDepositFor(feeLookup),
  });

  if (eligibility.eligible) {
    await issueCertificateForStudent(student.id);
  }

  const rows = await prisma.certificate.findMany({
    where: { studentId: student.id },
    orderBy: { issuedAt: "desc" },
  });

  return NextResponse.json({
    level: student.level,
    outstanding,
    pending: eligibility.eligible ? null : eligibility.reason,
    certificates: rows.map((row) => toCertificateView(row, outstanding)),
  });
}
