import { NextResponse } from "next/server";

import { requireCapability, scopedBranchIds } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  try {
    const branchIds = scopedBranchIds(gate.admin);
    const referrerFilter = branchIds ? { referrerStudent: { branchId: { in: branchIds } } } : {};
    const referredFilter = branchIds ? { referredStudent: { branchId: { in: branchIds } } } : {};
    const redemptionFilter = branchIds ? { AND: [referrerFilter, referredFilter] } : {};
    const campaignAudienceFilter = {
      status: "active",
      referralCode: { not: null },
      ...(branchIds ? { branchId: { in: branchIds } } : {}),
    };
    const [students, redemptions, holds, totalRedemptions, openHolds, campaignAudienceCount] = await Promise.all([
      prisma.student.findMany({
        where: {
          referralCode: { not: null },
          ...(branchIds ? { branchId: { in: branchIds } } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 5000,
        select: {
          id: true,
          referralCode: true,
          studentCode: true,
          createdAt: true,
          user: { select: { name: true, email: true } },
          branch: { select: { name: true } },
          _count: { select: { referralsGiven: true } },
        },
      }),
      prisma.referralRedemption.findMany({
        where: redemptionFilter,
        orderBy: { createdAt: "desc" },
        take: 1000,
        select: {
          id: true,
          referralCode: true,
          status: true,
          createdAt: true,
          referrerStudent: {
            select: {
              user: { select: { name: true, email: true } },
              studentCode: true,
              branch: { select: { name: true } },
            },
          },
          referredStudent: {
            select: {
              user: { select: { name: true, email: true } },
              studentCode: true,
              branch: { select: { name: true } },
            },
          },
          _count: { select: { holds: true } },
        },
      }),
      prisma.referralHold.findMany({
        where: {
          releasedAt: null,
          redemption: redemptionFilter,
        },
        orderBy: { heldAt: "desc" },
        take: 500,
        select: {
          id: true,
          reason: true,
          heldAt: true,
          redemption: {
            select: {
              referralCode: true,
              referrerStudent: { select: { user: { select: { name: true } } } },
              referredStudent: { select: { user: { select: { name: true } } } },
            },
          },
        },
      }),
      prisma.referralRedemption.count({ where: redemptionFilter }),
      prisma.referralHold.count({
        where: { releasedAt: null, redemption: redemptionFilter },
      }),
      prisma.student.count({ where: campaignAudienceFilter }),
    ]);

    return NextResponse.json({
      students,
      redemptions,
      holds,
      totalRedemptions,
      openHolds,
      campaignAudienceCount,
      truncated: students.length === 5000 || redemptions.length === 1000 || holds.length === 500,
    });
  } catch (error) {
    console.error("Admin referrals GET failed:", error);
    return NextResponse.json({ error: "Unable to load referral records" }, { status: 500 });
  }
}
