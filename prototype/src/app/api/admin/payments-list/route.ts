import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function isAdmin(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return user?.role === "ADMIN";
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions as any) as any;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!await isAdmin(session.user.id)) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

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
    where.OR = [
      { student: { user: { name: { contains: search, mode: "insensitive" } } } },
      { student: { user: { email: { contains: search, mode: "insensitive" } } } },
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
  const session = await getServerSession(authOptions as any) as any;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!await isAdmin(session.user.id)) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

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
