import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";

export async function GET(request: Request) {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const method = url.searchParams.get("method");
  const search = url.searchParams.get("search") || undefined;
  const page = parseInt(url.searchParams.get("page") || "1", 10) || 1;
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10)));

  const where: any = {};
  if (status) where.status = status;
  if (method) where.method = method;
  if (search) {
    // No `mode: "insensitive"`: SQLite does not support it and Prisma rejects
    // the whole query, so every payment search returned a 500. SQLite's LIKE is
    // already case-insensitive for ASCII.
    where.OR = [
      { student: { user: { name: { contains: search, mode: "insensitive" as const } } } },
      { student: { user: { email: { contains: search, mode: "insensitive" as const } } } },
    ];
  }

  const totalCount = await prisma.payment.count({ where });
  const payments = await prisma.payment.findMany({
    where,
    include: { student: { include: { user: true } }, invoice: true },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  return NextResponse.json({ payments, totalCount });
}

export async function PATCH(request: Request) {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => ({}));
  const paymentId = typeof body.paymentId === "string" ? body.paymentId : "";
  const status = typeof body.status === "string" ? body.status : undefined;

  if (!paymentId) return NextResponse.json({ error: "Payment ID is required" }, { status: 400 });

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
