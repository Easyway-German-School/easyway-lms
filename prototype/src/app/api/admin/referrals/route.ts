import { NextResponse } from "next/server";

import { requireCapability, scopedBranchIds } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Super-admin oversight for the unified promo-code system: every code (both
 * student-referral and influencer), their attributed sign-ups, and the
 * payout queue waiting on an admin action. See /api/admin/promo-codes for
 * creating/editing a code and /api/admin/promo-payouts/[id] for approving
 * and crediting a payout.
 */
export async function GET() {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  try {
    const branchIds = scopedBranchIds(gate.admin);
    // Branch scoping only applies to student-referral codes, whose owner is
    // a Student with a branch. An influencer code has no branch — it is
    // always visible to anyone who can reach this page.
    const studentBranchFilter = branchIds ? { ownerStudent: { branchId: { in: branchIds } } } : {};

    const [codes, pendingPayouts, recentRedemptions, totalRedemptions, openHolds] = await Promise.all([
      prisma.promoCode.findMany({
        where: {
          OR: [
            { type: "influencer" },
            { type: "student_referral", ...studentBranchFilter },
          ],
        },
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
          ownerUser: { select: { name: true, email: true } },
          _count: { select: { redemptions: true } },
        },
      }),
      prisma.promoPayout.findMany({
        where: { status: { in: ["pending", "approved"] } },
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
              ownerUser: { select: { name: true, email: true } },
            },
          },
          promoRedemption: {
            select: { redeemedByStudent: { select: { user: { select: { name: true, email: true } } } } },
          },
        },
      }),
      prisma.promoRedemption.findMany({
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
      prisma.promoRedemption.count(),
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
