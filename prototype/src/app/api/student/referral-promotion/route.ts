import { NextResponse } from "next/server";

import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { REFERRAL_CAMPAIGN_STATUS } from "@/lib/referral-campaign";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: { referralCode: true },
  });

  return NextResponse.json({
    referralCode: student?.referralCode ?? null,
    campaignStatus: REFERRAL_CAMPAIGN_STATUS,
  });
}
