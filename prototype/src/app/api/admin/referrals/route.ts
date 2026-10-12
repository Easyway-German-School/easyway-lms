import { NextResponse } from "next/server";

import { requireCapability, scopedBranchIds } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Super-admin oversight for the STUDENT REFERRAL program only. Every
 * student's code is minted automatically at signup, so there is nothing to
 * create here — just the sign-ups it's attributed and the referral-credit
 * payout queue. See /admin/influencer-program for travel agents,
 * influencers and other partners — a separate program with its own
 * oversight page and its own per-partner dashboard, not mixed in here.
 */
export async function GET() {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  try {
    const branchIds = scopedBranchIds(gate.admin);
    const studentBranchFilter = branchIds ? { branchId: { in: branchIds } } : {};

    const [codes, pendingPayouts, recentRedemptions, totalRedemptions, openHolds] = await Promise.all([
      prisma.promoCode.findMany({
        where: { type: "student_referral", ownerStudent: studentBranchFilter },
        orderBy: { createdAt: "desc" },
        take: 2000,
        select: {
          id: true,
          code: true,
          type: true,
          status: true,
          label: true,
          discountPercent: true,
          discountFlat: true,
          discountCapAmount: true,
          commissionPercent: true,
          commissionFlat: true,
          createdAt: true,
          ownerStudent: {
            select: {
              studentCode: true,
              user: { select: { name: true, email: true } },
              branch: { select: { name: true } },
            },
          },
          _count: { select: { redemptions: true } },
        },
      }),
      prisma.promoPayout.findMany({
        where: { status: { in: ["pending", "approved"] }, kind: "referral_credit" },
        orderBy: { createdAt: "desc" },
        take: 500,
        select: {
          id: true,
          amount: true,
          kind: true,
          status: true,
          createdAt: true,
          promoCode: {
            select: {
              code: true,
              type: true,
              ownerStudent: { select: { user: { select: { name: true, email: true } } } },
            },
          },
          promoRedemption: {
            select: { redeemedByStudent: { select: { user: { select: { name: true, email: true } } } } },
          },
        },
      }),
      prisma.promoRedemption.findMany({
        where: { type: "student_referral" },
        orderBy: { createdAt: "desc" },
        take: 300,
        select: {
          id: true,
          codeSnapshot: true,
          type: true,
          status: true,
          discountAmount: true,
          createdAt: true,
          redeemedByStudent: {
            select: { studentCode: true, user: { select: { name: true, email: true } }, branch: { select: { name: true } } },
          },
        },
      }),
      prisma.promoRedemption.count({ where: { type: "student_referral" } }),
      prisma.promoRedemptionHold.count({ where: { releasedAt: null } }),
    ]);

    return NextResponse.json({
      codes,
      pendingPayouts,
      recentRedemptions,
      totalRedemptions,
      openHolds,
      truncated: codes.length === 2000 || pendingPayouts.length === 500 || recentRedemptions.length === 300,
    });
  } catch (error) {
    console.error("Admin referrals GET failed:", error);
    return NextResponse.json({ error: "Unable to load referral records" }, { status: 500 });
  }
}
