import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminHasCapability } from "@/lib/admin-roles";
import { requireTenantSession, tenantScopeForPayment } from "@/lib/tenant-access";

async function isAdmin(userId: string) {
  // Admin AND cleared for this area — see src/lib/admin-roles.ts.
  return adminHasCapability(userId, "payments");
}

export async function GET() {
  const auth = await requireTenantSession();
  if (!auth.ok) return auth.response!;

  if (!await isAdmin(auth.session.user.id)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const where = tenantScopeForPayment(auth.tenantId);

  const payments = await prisma.payment.findMany({
    where,
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
  const auth = await requireTenantSession();
  if (!auth.ok) return auth.response!;

  if (!await isAdmin(auth.session.user.id)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

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
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { user: { select: { tenantId: true } } },
    });

    if (auth.tenantId && (!student || student.user.tenantId !== auth.tenantId)) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

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
