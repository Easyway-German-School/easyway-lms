import { NextResponse } from "next/server";

import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: { id: true, referralCode: true },
  });

  if (!student?.referralCode) {
    return NextResponse.json({ referralCode: null });
  }

  const [code, payouts] = await Promise.all([
    prisma.promoCode.findUnique({
      where: { code: student.referralCode },
      select: {
        commissionPercent: true,
        commissionFlat: true,
        _count: { select: { redemptions: true } },
      },
    }),
    prisma.promoPayout.findMany({
      where: { promoCode: { ownerStudentId: student.id } },
      select: { amount: true, status: true },
    }),
  ]);

  return NextResponse.json({
    referralCode: student.referralCode,
    commissionPercent: code?.commissionPercent ?? null,
    commissionFlat: code?.commissionFlat ?? null,
    signups: code?._count.redemptions ?? 0,
    pendingCredit: payouts.filter((p) => p.status !== "credited").reduce((sum, p) => sum + p.amount, 0),
    creditedTotal: payouts.filter((p) => p.status === "credited").reduce((sum, p) => sum + p.amount, 0),
  });
}
