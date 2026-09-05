import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildReceiptPdf } from "@/lib/receipt-pdf";
import { isReceivedPayment, isRegistrationFeePayment, tuitionFeeFor } from "@/lib/payment";

/**
 * A student's own downloadable receipt for one payment.
 *
 * Scoped by `studentId` in the same query as the lookup, not checked
 * afterwards — a student typing another student's payment id into the URL
 * gets a 404, not a receipt with a stranger's name on it.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: {
      id: true,
      studentCode: true,
      level: true,
      classType: true,
      pathway: true,
      branch: { select: { name: true } },
      user: { select: { name: true, tenant: { select: { brandName: true } } } },
      payments: { orderBy: { createdAt: "asc" }, select: { id: true, amount: true, currency: true, status: true, method: true, description: true, createdAt: true } },
    },
  });
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });

  const payment = student.payments.find((p) => p.id === id);
  if (!payment) return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  if (!isReceivedPayment(payment.status)) {
    return NextResponse.json({ error: "Only received payments have a receipt" }, { status: 400 });
  }

  // A running balance is meaningless for the registration fee (it never
  // counts toward tuition) — omit it there rather than show a confusing
  // figure that does not move.
  let balanceAfter: number | null = null;
  if (!isRegistrationFeePayment(payment.description)) {
    const feeLookup = { level: student.level, branch: student.branch?.name ?? null, classType: student.classType, pathway: student.pathway };
    const tuitionFee = tuitionFeeFor(feeLookup);
    const paidByThen = student.payments
      .filter((p) => isReceivedPayment(p.status) && !isRegistrationFeePayment(p.description))
      .filter((p) => p.createdAt <= payment.createdAt)
      .reduce((sum, p) => sum + p.amount, 0);
    balanceAfter = Math.max(0, tuitionFee - paidByThen);
  }

  const pdf = await buildReceiptPdf({
    receiptNo: payment.id.slice(-10).toUpperCase(),
    schoolName: student.user?.tenant?.brandName ?? undefined,
    studentName: student.user?.name ?? "Student",
    studentCode: student.studentCode,
    amount: payment.amount,
    currency: payment.currency,
    method: payment.method,
    description: payment.description || "Tuition payment",
    paidAt: payment.createdAt,
    balanceAfter,
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="receipt-${payment.id.slice(-8)}.pdf"`,
    },
  });
}
