import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";
import { notify, KIND } from "@/lib/notify";

/** The paid-amounts ledger — every PayrollPayment recorded, optionally scoped to one tutor. */
export async function GET(request: Request) {
  const gate = await requireCapability("payroll");
  if (!gate.ok) return gate.response;

  const lecturerId = new URL(request.url).searchParams.get("lecturerId");

  const payments = await prisma.payrollPayment.findMany({
    where: lecturerId ? { lecturerId } : {},
    orderBy: { paidAt: "desc" },
    include: { lecturer: { select: { user: { select: { name: true } } } } },
    take: 200,
  });

  return NextResponse.json({
    payments: payments.map((p) => ({
      id: p.id,
      lecturerId: p.lecturerId,
      lecturerName: p.lecturer.user?.name ?? "Unnamed tutor",
      amount: p.amount,
      periodLabel: p.periodLabel,
      classesCounted: p.classesCounted,
      note: p.note,
      paidAt: p.paidAt.toISOString(),
    })),
  });
}

/** Record one payment actually made to a tutor — an audit entry, not a trigger for anything automatic. */
export async function POST(request: Request) {
  const gate = await requireCapability("payroll");
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => ({}));
  const lecturerId = typeof body.lecturerId === "string" ? body.lecturerId : "";
  const amount = Number(body.amount);
  const periodLabel = typeof body.periodLabel === "string" ? body.periodLabel.trim() : "";
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;
  const classesCounted = Number.isFinite(Number(body.classesCounted)) ? Math.round(Number(body.classesCounted)) : null;

  if (!lecturerId) return NextResponse.json({ error: "lecturerId is required" }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
  }
  if (!periodLabel) return NextResponse.json({ error: "periodLabel is required, e.g. \"September 2026\"" }, { status: 400 });

  const lecturer = await prisma.lecturer.findUnique({
    where: { id: lecturerId },
    select: { id: true, tenantId: true, userId: true, user: { select: { name: true } } },
  });
  if (!lecturer) return NextResponse.json({ error: "Tutor not found" }, { status: 404 });

  const payment = await prisma.payrollPayment.create({
    data: {
      lecturerId,
      amount: Math.round(amount),
      periodLabel,
      classesCounted,
      note,
      createdById: gate.admin?.userId ?? null,
      ...(lecturer.tenantId ? { tenantId: lecturer.tenantId } : {}),
    },
  });

  // Best-effort: the tutor should know their pay went out, but a notify
  // hiccup must never fail the payment record that already exists.
  await notify({
    to: { userIds: [lecturer.userId] },
    kind: KIND.general,
    severity: "success",
    title: "Payroll payment recorded",
    message: `₦${payment.amount.toLocaleString("en-NG")} for ${periodLabel} has been recorded as paid.`,
    email: true,
  }).catch((error) => console.error("payroll payment notify failed", error));

  return NextResponse.json({ payment: { id: payment.id, amount: payment.amount, periodLabel: payment.periodLabel } }, { status: 201 });
}
