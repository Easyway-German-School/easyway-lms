import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability, adminHasCapability } from "@/lib/admin-roles";

export const dynamic = "force-dynamic";

/**
 * GET — an influencer's own promo code(s), the sign-ups they attributed, and
 * their payout ledger. `?scope=all` additionally requires `payments` — the
 * same split as the rest of the admin area: `influencer` is a read-only own
 * view, `payments` is the desk that owns the whole promo-code system (same
 * capability /admin/referrals already sits behind).
 */
export async function GET(req: NextRequest) {
  const gate = await requireCapability("influencer");
  if (!gate.ok) return gate.response;

  const scope = req.nextUrl.searchParams.get("scope");
  const wantsAll = scope === "all";
  if (wantsAll && !(await adminHasCapability(gate.admin.userId, "payments"))) {
    return NextResponse.json({ error: "Your admin role does not cover payments" }, { status: 403 });
  }

  const codes = await prisma.promoCode.findMany({
    where: wantsAll ? { type: "influencer" } : { ownerUserId: gate.admin.userId, type: "influencer" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      code: true,
      label: true,
      status: true,
      discountPercent: true,
      discountFlat: true,
      commissionPercent: true,
      commissionFlat: true,
      createdAt: true,
      ownerUser: { select: { name: true, email: true } },
      redemptions: {
        orderBy: { createdAt: "desc" },
        take: 500,
        select: {
          id: true,
          status: true,
          discountAmount: true,
          createdAt: true,
          // First name only — an influencer sees who engaged, not full PII.
          // Full identity stays on the super-admin oversight page.
          redeemedByStudent: { select: { user: { select: { name: true } } } },
        },
      },
      payouts: {
        orderBy: { createdAt: "desc" },
        take: 500,
        select: { id: true, amount: true, status: true, createdAt: true, creditedAt: true, creditedNote: true },
      },
    },
  });

  return NextResponse.json({ codes });
}
