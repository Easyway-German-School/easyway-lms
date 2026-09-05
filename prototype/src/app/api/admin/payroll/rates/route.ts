import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";
import { isPayrollRateType } from "@/lib/payroll";

/** Every tutor, with their pay rate if one is set — the roster a payroll admin picks a tutor from. */
export async function GET() {
  const gate = await requireCapability("payroll");
  if (!gate.ok) return gate.response;

  const lecturers = await prisma.lecturer.findMany({
    where: { status: { not: "inactive" } },
    select: {
      id: true,
      status: true,
      user: { select: { name: true, email: true } },
      branch: { select: { name: true } },
      payRate: { select: { rateType: true, amount: true, updatedAt: true } },
    },
    orderBy: { user: { name: "asc" } },
  });

  return NextResponse.json({
    lecturers: lecturers.map((l) => ({
      lecturerId: l.id,
      name: l.user?.name ?? l.user?.email ?? "Unnamed tutor",
      status: l.status,
      branchName: l.branch?.name ?? null,
      rateType: l.payRate?.rateType ?? null,
      amount: l.payRate?.amount ?? null,
      updatedAt: l.payRate?.updatedAt?.toISOString() ?? null,
    })),
  });
}

/** Set or update one tutor's rate. Upsert — the first time anybody sets it is the first time a row exists. */
export async function PATCH(request: Request) {
  const gate = await requireCapability("payroll");
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => ({}));
  const lecturerId = typeof body.lecturerId === "string" ? body.lecturerId : "";
  const rateType = body.rateType;
  const amount = Number(body.amount);

  if (!lecturerId) return NextResponse.json({ error: "lecturerId is required" }, { status: 400 });
  if (!isPayrollRateType(rateType)) {
    return NextResponse.json({ error: "rateType must be per_class or monthly" }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
  }

  const lecturer = await prisma.lecturer.findUnique({ where: { id: lecturerId }, select: { id: true, tenantId: true } });
  if (!lecturer) return NextResponse.json({ error: "Tutor not found" }, { status: 404 });

  const rate = await prisma.tutorPayRate.upsert({
    where: { lecturerId },
    update: { rateType, amount: Math.round(amount), updatedById: gate.admin?.userId ?? null },
    create: {
      lecturerId,
      rateType,
      amount: Math.round(amount),
      updatedById: gate.admin?.userId ?? null,
      ...(lecturer.tenantId ? { tenantId: lecturer.tenantId } : {}),
    },
  });

  return NextResponse.json({ rate: { rateType: rate.rateType, amount: rate.amount } });
}
