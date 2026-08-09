import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { guardedPrisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * A school buying platform credit.
 *
 * Prepaid, in naira, through Paystack — not a card on file with a monthly
 * charge. That is not a simplification, it is the shape this market actually
 * supports: recurring card billing in Nigeria means routine declines, and a
 * decline in a subscription model is a service interruption plus a debt plus a
 * dunning email. Prepaid turns the same failed payment into a top-up that did
 * not happen, which the school can see and fix, and which stops nothing until
 * the balance actually runs out.
 *
 * It also matches what the customer is buying. Usage is metered per token, per
 * participant-minute, per email; a fixed monthly fee for a variable service
 * either overcharges the quiet school or underprices the busy one.
 */

/**
 * Bounds on a single top-up.
 *
 * The floor is not arbitrary: Paystack's fee is a percentage plus a flat
 * component, so a ₦500 top-up spends a meaningful fraction of itself on the
 * transaction. The ceiling is a typo guard — ₦5,000,000 is a plausible annual
 * spend for a large customer and an implausible accident, and a school that
 * genuinely wants to pay more can do it in two goes or ask us.
 */
const MIN_KOBO = 5_000_00;
const MAX_KOBO = 5_000_000_00;

export async function POST(request: NextRequest) {
  /**
   * The school's own money, so the school's own payments capability — not the
   * platform operator role. An operator crediting somebody's account is a
   * different act with a different route, and conflating them would mean the
   * person who runs the platform could quietly move a customer's balance.
   */
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  const tenantId = gate.session.user.tenantId;
  if (!tenantId) {
    return NextResponse.json(
      { error: "This account is not attached to a school, so it has no balance to top up." },
      { status: 400 },
    );
  }

  const body = await request.json().catch(() => null);
  const naira = Math.round(Number(body?.amountNaira ?? 0));
  const amountKobo = naira * 100;

  if (!Number.isFinite(amountKobo) || amountKobo < MIN_KOBO || amountKobo > MAX_KOBO) {
    return NextResponse.json(
      {
        error: `Top up between ₦${(MIN_KOBO / 100).toLocaleString()} and ₦${(MAX_KOBO / 100).toLocaleString()}.`,
      },
      { status: 400 },
    );
  }

  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    return NextResponse.json({ error: "Paystack is not configured." }, { status: 500 });
  }

  const tenant = await guardedPrisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, slug: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: "No such school." }, { status: 404 });
  }

  const email = String(gate.session.user.email || "").trim().toLowerCase();
  /**
   * Paystack refuses reserved TLDs (.test, .local), which is exactly what the
   * development fixtures use. Same substitution the tuition route makes, and
   * only in development — in production a bad address should be an error the
   * admin sees, not a silent swap to somebody else's inbox.
   */
  const isDev = process.env.NODE_ENV !== "production";
  const reserved = /\.(test|local|localhost|example|invalid)$/i.test(email);
  const payerEmail =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !(reserved && isDev)
      ? email
      : isDev
        ? "operator@example.com"
        : null;

  if (!payerEmail) {
    return NextResponse.json(
      { error: "A valid email address is needed to take payment. Update your account email first." },
      { status: 400 },
    );
  }

  const base = process.env.NEXTAUTH_URL || "http://localhost:3000";

  const response = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: payerEmail,
      amount: amountKobo,
      currency: "NGN",
      reference: `topup-${tenant.slug}-${Date.now()}`,
      callback_url: `${base}/admin/billing?topup=done`,
      metadata: {
        /**
         * The discriminator the webhook branches on. Without it this arrives
         * looking like a student payment and would be credited to a student
         * who never paid.
         */
        kind: "platform_topup",
        tenantId: tenant.id,
        tenantName: tenant.name,
      },
    }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.status) {
    console.error("Paystack top-up init failed", data);
    return NextResponse.json(
      { error: data?.message || "Could not start the payment." },
      { status: 502 },
    );
  }

  return NextResponse.json({
    authorization_url: data.data.authorization_url,
    reference: data.data.reference,
    amountKobo,
  });
}
