import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { loadStudentLedger } from "@/lib/tuition-charges";

export const dynamic = "force-dynamic";

/**
 * Move a payout through pending -> approved -> credited. There is no
 * automated payout rail (see src/lib/growth/promo-rewards.ts): crediting is
 * an admin-triggered, auditable bookkeeping action, not a bank transfer.
 *
 *   referral_credit  applied as a waiver on the REFERRER's own oldest open
 *                     TuitionCharge, same mechanism as a scholarship — see
 *                     TuitionCharge.waivedAmount. Falls back to a free-text
 *                     note when the referrer has nothing open to waive.
 *   commission        always a free-text note (an influencer has no in-app
 *                     ledger to credit against — paid off-system).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const action = typeof (body as Record<string, unknown> | null)?.action === "string" ? (body as Record<string, unknown>).action : "";
  const note = typeof (body as Record<string, unknown> | null)?.note === "string" ? ((body as Record<string, unknown>).note as string).trim() : "";

  const payout = await prisma.promoPayout.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      amount: true,
      kind: true,
      promoCode: { select: { ownerStudentId: true, code: true } },
    },
  });
  if (!payout) return NextResponse.json({ error: "Payout not found" }, { status: 404 });

  if (action === "approve") {
    if (payout.status !== "pending") {
      return NextResponse.json({ error: "Only a pending payout can be approved" }, { status: 409 });
    }
    await prisma.promoPayout.update({
      where: { id },
      data: { status: "approved", approvedById: gate.admin.userId, approvedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "credit") {
    if (payout.status !== "approved") {
      return NextResponse.json({ error: "Only an approved payout can be credited" }, { status: 409 });
    }

    let creditedViaChargeId: string | null = null;

    if (payout.kind === "referral_credit" && payout.promoCode.ownerStudentId) {
      // ledger.lines is already FIFO-ordered, oldest charge first.
      const ledger = await loadStudentLedger(payout.promoCode.ownerStudentId);
      const openLine = ledger.lines.find((line) => line.outstanding > 0 && !line.legacyArrears);

      if (openLine) {
        const charge = await prisma.tuitionCharge.findUnique({
          where: { id: openLine.chargeId },
          select: { id: true, amount: true, waivedAmount: true },
        });
        if (charge) {
          const nextWaived = Math.min(charge.amount, charge.waivedAmount + payout.amount);
          await prisma.tuitionCharge.update({
            where: { id: charge.id },
            data: {
              waivedAmount: nextWaived,
              waivedReason: `Promo code ${payout.promoCode.code} referral credit`,
            },
          });
          creditedViaChargeId = charge.id;
        }
      }
    }

    if (!creditedViaChargeId && !note) {
      return NextResponse.json(
        { error: "No open charge to waive this against — add a note on how this was paid out." },
        { status: 400 },
      );
    }

    await prisma.promoPayout.update({
      where: { id },
      data: {
        status: "credited",
        creditedViaChargeId,
        creditedNote: note || null,
        creditedById: gate.admin.userId,
        creditedAt: new Date(),
      },
    });
    return NextResponse.json({ ok: true, creditedViaChargeId });
  }

  return NextResponse.json({ error: "action must be 'approve' or 'credit'" }, { status: 400 });
}
