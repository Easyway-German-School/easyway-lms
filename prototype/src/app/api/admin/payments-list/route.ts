import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { isValidPaymentStatus, PAYMENT_STATUSES } from "@/lib/payment";

export async function GET(request: Request) {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const method = url.searchParams.get("method");
  const classType = url.searchParams.get("classType");
  const search = url.searchParams.get("search") || undefined;
  const page = parseInt(url.searchParams.get("page") || "1", 10) || 1;
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10)));

  const where: any = {};
  if (status && status !== "not_paid") where.status = status;
  if (method) where.method = method;
  if (classType === "private" || classType === "group") where.student = { classType };
  if (search) {
    // No `mode: "insensitive"`: SQLite does not support it and Prisma rejects
    // the whole query, so every payment search returned a 500. SQLite's LIKE is
    // already case-insensitive for ASCII.
    where.OR = [
      { student: { user: { name: { contains: search, mode: "insensitive" as const } } } },
      { student: { user: { email: { contains: search, mode: "insensitive" as const } } } },
    ];
  }

  const payments = status === "not_paid"
    ? []
    : await prisma.payment.findMany({
    where,
    include: { student: { include: { user: true } }, invoice: true },
    orderBy: { createdAt: "desc" },
    ...(search ? {} : { skip: (page - 1) * pageSize, take: pageSize }),
  });

  let unpaidStudents: Array<{
    id: string;
    user: { name: string | null; email: string };
    createdAt: Date;
  }> = [];

  if (search) {
    const studentWhere: any = {
      AND: [
        gate.session.user.tenantId
          ? {
              OR: [
                { branch: { tenantId: gate.session.user.tenantId } },
                { user: { tenantId: gate.session.user.tenantId } },
              ],
            }
          : {},
        {
          OR: [
            { user: { name: { contains: search, mode: "insensitive" as const } } },
            { user: { email: { contains: search, mode: "insensitive" as const } } },
          ],
        },
        ...(classType === "private" || classType === "group" ? [{ classType }] : []),
        { payments: { none: {} } },
      ],
    };
    unpaidStudents = await prisma.student.findMany({
      where: studentWhere,
      select: { id: true, createdAt: true, user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  const unpaidRows = unpaidStudents.map((student) => ({
    id: `not-paid:${student.id}`,
    studentId: student.id,
    amount: 0,
    currency: "NGN",
    status: "not_paid",
    method: "—",
    description: "No payment recorded",
    student: { id: student.id, user: student.user },
    invoice: null,
    createdAt: student.createdAt,
  }));
  const combined = [...payments, ...unpaidRows].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
  const filtered = status === "not_paid" ? unpaidRows : combined;
  const allRows = status === "not_paid" ? unpaidRows : combined;
  const totalCount = status === "not_paid"
    ? unpaidRows.length
    : search ? allRows.length : (await prisma.payment.count({ where })) + unpaidRows.length;
  const pageRows = search ? allRows.slice((page - 1) * pageSize, page * pageSize) : filtered;

  return NextResponse.json({ payments: pageRows, totalCount });
}

export async function PATCH(request: Request) {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => ({}));
  const paymentId = typeof body.paymentId === "string" ? body.paymentId : "";
  const status = typeof body.status === "string" ? body.status : undefined;

  if (!paymentId) return NextResponse.json({ error: "Payment ID is required" }, { status: 400 });

  if (status !== undefined && !isValidPaymentStatus(status)) {
    return NextResponse.json(
      { error: `status must be one of: ${PAYMENT_STATUSES.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) return NextResponse.json({ error: "Payment not found" }, { status: 404 });

    const update: any = {};
    if (status) update.status = status;

    await prisma.payment.update({ where: { id: paymentId }, data: update });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Unable to update payment", detail: error instanceof Error ? error.message : "Unknown" }, { status: 500 });
  }
}
