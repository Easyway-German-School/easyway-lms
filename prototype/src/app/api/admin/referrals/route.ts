import { NextResponse } from "next/server";

import { requireCapability, scopedBranchIds } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Super-admin oversight for the STUDENT REFERRAL program only. Every
 * student's code is minted automatically at signup, so there is nothing to
 * create here. Deliberately does NOT list every student's own code — that
 * was the entire student body, most of whom have never referred anyone,
 * which is noise nobody asked to scroll through. This only ever returns
 * actual referral ACTIVITY (a redemption: someone who signed up with
 * someone else's code) and the payout queue it generates. See
 * /admin/influencer-program for travel agents, influencers and other
 * partners — a separate program with its own oversight page.
 */
export async function GET() {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  try {
    const branchIds = scopedBranchIds(gate.admin);
    const studentBranchFilter = branchIds ? { branchId: { in: branchIds } } : {};

    const [referrerCount, pendingPayouts, recentRedemptions, totalRedemptions, openHolds] = await Promise.all([
      prisma.promoCode.count({
        where: { type: "student_referral", ownerStudent: studentBranchFilter, redemptions: { some: {} } },
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
          createdAt: true,
          redeemedByStudent: {
            select: { studentCode: true, user: { select: { name: true, email: true } }, branch: { select: { name: true } } },
          },
          // Who referred them — the whole point of this list.
          promoCode: {
            select: { ownerStudent: { select: { user: { select: { name: true } } } } },
          },
          // Existence (not PromoRedemption.status — see the same note on
          // InfluencerDashboard) is the honest "has this referral actually
          // paid yet" signal: a PromoPayout only ever exists off a real,
          // non-registration-fee tuition payment.
          payouts: { select: { amount: true, status: true } },
        },
      }),
      prisma.promoRedemption.count({ where: { type: "student_referral" } }),
      prisma.promoRedemptionHold.count({ where: { releasedAt: null } }),
    ]);

    return NextResponse.json({
      referrerCount,
      pendingPayouts,
      recentRedemptions,
      totalRedemptions,
      openHolds,
      truncated: pendingPayouts.length === 500 || recentRedemptions.length === 300,
    });
  } catch (error) {
    console.error("Admin referrals GET failed:", error);
    return NextResponse.json({ error: "Unable to load referral records" }, { status: 500 });
  }
}
