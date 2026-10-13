import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { notify, KIND } from "@/lib/notify";

export const dynamic = "force-dynamic";

/**
 * One partner's whole dashboard — their code(s), the students who signed up
 * with it, and what they've earned. The SAME shape whether it's the partner
 * looking at their own numbers or an admin remote-viewing them from the
 * Influencer Program hub (see src/components/InfluencerDashboard.tsx, which
 * renders this data either way) — one dashboard, two doors in.
 *
 * `?userId=` is the admin door: requires `payments`, the same capability
 * that already owns the whole promo-code system. No `userId` is the
 * partner's own door: requires `influencer`, and is always their own data —
 * there is no way to pass your own id in and see someone else's.
 */
export async function GET(req: NextRequest) {
  const targetUserId = req.nextUrl.searchParams.get("userId");

  const gate = await requireCapability(targetUserId ? "payments" : "influencer");
  if (!gate.ok) return gate.response;

  const ownerUserId = targetUserId || gate.admin.userId;

  const codes = await prisma.promoCode.findMany({
    where: { ownerUserId, type: "influencer" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      code: true,
      label: true,
      status: true,
      partnerType: true,
      discountPercent: true,
      discountFlat: true,
      commissionPercent: true,
      commissionFlat: true,
      payoutBankName: true,
      payoutAccountNumber: true,
      payoutAccountName: true,
      createdAt: true,
      ownerUser: { select: { id: true, name: true, email: true } },
      redemptions: {
        orderBy: { createdAt: "desc" },
        take: 500,
        select: {
          id: true,
          createdAt: true,
          // Full identity for an admin's own scope check (payments already
          // sees full student records everywhere else); a partner sees only
          // the first name they'd recognise from their own audience — see
          // the same call made in the old route this replaces.
          redeemedByStudent: {
            select: {
              id: true,
              user: { select: { name: true, email: targetUserId ? true : false } },
            },
          },
          // Existence, not status text, is the "has this person actually
          // paid" signal — a PromoPayout is only ever created off a real,
          // non-registration-fee tuition payment (recordPromoRewardForPayment
          // in lib/growth/promo-rewards.ts). PromoRedemption.status flips to
          // "activated" the moment the SIGNUP discount is applied, which can
          // happen before any payment — so that field alone cannot be
          // trusted as a "they paid" signal, and the UI must not key off it.
          payouts: { select: { id: true, amount: true, status: true, createdAt: true, creditedAt: true, creditedNote: true } },
        },
      },
    },
  });

  return NextResponse.json({
    codes,
    viewer: targetUserId ? { mode: "admin" as const } : { mode: "self" as const },
  });
}

/** PATCH — a partner updates their own payout bank details. Nothing else is editable from here; rewards/status/type are the admin desk's call (see /api/admin/promo-codes/[id]). */
export async function PATCH(req: NextRequest) {
  const gate = await requireCapability("influencer");
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => null);
  const { promoCodeId, payoutBankName, payoutAccountNumber, payoutAccountName } = (body || {}) as Record<string, unknown>;
  if (typeof promoCodeId !== "string" || !promoCodeId) {
    return NextResponse.json({ error: "promoCodeId is required" }, { status: 400 });
  }

  const code = await prisma.promoCode.findUnique({ where: { id: promoCodeId }, select: { ownerUserId: true } });
  if (!code || code.ownerUserId !== gate.admin.userId) {
    return NextResponse.json({ error: "That's not your code" }, { status: 403 });
  }

  const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

  await prisma.promoCode.update({
    where: { id: promoCodeId },
    data: {
      payoutBankName: clean(payoutBankName),
      payoutAccountNumber: clean(payoutAccountNumber),
      payoutAccountName: clean(payoutAccountName),
    },
  });
  return NextResponse.json({ ok: true });
}

/** POST — "Need help?" from the partner's own dashboard. A message, not a ticket system: it reaches the payments desk as a notification, same as any other internal alert. */
export async function POST(req: NextRequest) {
  const gate = await requireCapability("influencer");
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => null);
  const { message } = (body || {}) as Record<string, unknown>;
  if (typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "A message is required" }, { status: 400 });
  }

  await notify({
    to: { audience: "admin", capability: "payments" },
    kind: KIND.influencerHelpRequest,
    title: "Influencer Program: help request",
    message: `${gate.admin.email}: ${message.trim()}`,
    link: "/admin/influencer-program",
    senderId: gate.admin.userId,
    email: false,
  });

  return NextResponse.json({ ok: true });
}
