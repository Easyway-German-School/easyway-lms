import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";

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

    return NextResponse.json({ payment }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Unable to create payment", detail: error instanceof Error ? error.message : "Unknown" }, { status: 500 });
  }
}
