import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import {
  isValidPaymentStatus,
  isReceivedPayment,
  isTravelPackagePathway,
  PAYMENT_STATUSES,
  requiredDepositFor,
} from "@/lib/payment";

export async function GET() {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  const payments = await prisma.payment.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      student: {
        include: { user: true },
      },
      invoice: true,
    },
  });

  return NextResponse.json({ payments });
}

export async function POST(request: Request) {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => ({}));
  const studentId = typeof body.studentId === "string" && body.studentId.trim() ? body.studentId : "";
  const amount = typeof body.amount === "number" ? body.amount : Number(body.amount);
  const currency = typeof body.currency === "string" ? body.currency : "usd";
  const method = typeof body.method === "string" ? body.method.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : null;
  const invoiceId = typeof body.invoiceId === "string" && body.invoiceId.trim() ? body.invoiceId : null;
  const status = typeof body.status === "string" ? body.status : "pending";

  if (!studentId || !amount || !method) {
    return NextResponse.json({ error: "studentId, amount, and method are required" }, { status: 400 });
  }

  if (!isValidPaymentStatus(status)) {
    return NextResponse.json(
      { error: `status must be one of: ${PAYMENT_STATUSES.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const payment = await prisma.payment.create({
      data: {
        studentId,
        amount: Math.round(amount),
        currency,
        method,
        description,
        invoiceId,
        status,
      },
    });

    /**
     * The office can record any amount at any status (cash and bank-transfer
     * desks need that freedom). But a `partial` payment that does not actually
     * reach the 60% deposit will NOT unlock the student's classes — the paywall
     * gates on the cumulative received total, not on the status label — so a
     * non-blocking warning is returned when that is the case, to catch an
     * under-deposit being mistaken for an unlock.
     */
    let warning: string | null = null;
    if (status === "partial") {
      const student = await prisma.student.findUnique({
        where: { id: studentId },
        select: {
          level: true,
          classType: true,
          pathway: true,
          branch: { select: { name: true } },
          payments: { select: { amount: true, status: true } },
        },
      });
      if (student) {
        const received = student.payments
          .filter((p) => isReceivedPayment(p.status))
          .reduce((sum, p) => sum + p.amount, 0);
        const deposit = requiredDepositFor({
          level: student.level,
          branch: student.branch?.name ?? null,
          classType: student.classType,
          pathway: student.pathway,
        });
        if (received < deposit) {
          // Travel Package's floor is a flat minimum first payment, not a 60%
          // deposit — the wording has to match what's actually being asked for.
          const requirement = isTravelPackagePathway(student.pathway)
            ? `below the ₦${deposit.toLocaleString("en-NG")} minimum first payment for the Travel Package`
            : `below the 60% deposit (₦${deposit.toLocaleString("en-NG")})`;
          warning = `Recorded, but this is ${requirement}. The student's classes will NOT unlock until the received total reaches it — currently ₦${received.toLocaleString(
            "en-NG",
          )}.`;
        }
      }
    }

    return NextResponse.json({ payment, warning }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Unable to create payment", detail: error instanceof Error ? error.message : "Unknown" }, { status: 500 });
  }
}
