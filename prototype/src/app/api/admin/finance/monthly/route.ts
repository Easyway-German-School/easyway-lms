import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function isAdmin(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return user?.role?.toLowerCase() === "admin";
}

function startOfMonth(dt: Date) {
  return new Date(dt.getFullYear(), dt.getMonth(), 1, 0, 0, 0, 0);
}

function endOfMonth(dt: Date) {
  return new Date(dt.getFullYear(), dt.getMonth() + 1, 0, 23, 59, 59, 999);
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions as any) as any;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!await isAdmin(session.user.id)) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const now = new Date();
  const months: { label: string; start: Date; end: Date }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      label: d.toLocaleString(undefined, { month: "short", year: "numeric" }),
      start: startOfMonth(d),
      end: endOfMonth(d),
    });
  }

  const results: { label: string; revenue: number }[] = [];

  for (const m of months) {
    const agg = await prisma.payment.aggregate({
      where: { status: "completed", createdAt: { gte: m.start, lte: m.end } },
      _sum: { amount: true },
    });
    results.push({ label: m.label, revenue: agg._sum.amount || 0 });
  }

  return NextResponse.json({ monthly: results });
}
