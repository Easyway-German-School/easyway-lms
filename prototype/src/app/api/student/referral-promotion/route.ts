import { NextResponse } from "next/server";

import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DEFAULT_STUDENT_REFERRAL_COMMISSION_FLAT } from "@/lib/promo-pricing";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: { id: true, referralCode: true, tenantId: true },
  });

  if (!student?.referralCode) {
    return NextResponse.json({ referralCode: null });
  }

  const code = await prisma.promoCode.upsert({
    where: { code: student.referralCode },
    create: {
      code: student.referralCode,
      type: "student_referral",
      status: "active",
      ownerStudentId: student.id,
      commissionFlat: DEFAULT_STUDENT_REFERRAL_COMMISSION_FLAT,
      tenantId: student.tenantId,
    },
    update: {},
    select: {
      type: true,
      status: true,
      commissionPercent: true,
      commissionFlat: true,
      _count: { select: { redemptions: true } },
    },
  });
  if (code.status !== "active") return NextResponse.json({ referralCode: null });

  const payouts = await prisma.promoPayout.findMany({
    where: { promoCode: { ownerStudentId: student.id } },
    select: { amount: true, status: true },
  });

  return NextResponse.json({
    referralCode: student.referralCode,
    commissionPercent: code?.commissionPercent ?? null,
    commissionFlat:
      code.type === "student_referral" && code.commissionPercent == null
        ? code.commissionFlat ?? DEFAULT_STUDENT_REFERRAL_COMMISSION_FLAT
        : code.commissionFlat ?? null,
    signups: code?._count.redemptions ?? 0,
    pendingCredit: payouts.filter((p) => p.status !== "credited").reduce((sum, p) => sum + p.amount, 0),
    creditedTotal: payouts.filter((p) => p.status === "credited").reduce((sum, p) => sum + p.amount, 0),
  });
}
