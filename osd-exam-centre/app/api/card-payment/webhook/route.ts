import { NextRequest, NextResponse } from "next/server";
import { settleCardPayment } from "@/lib/booking";
import { verifyFlutterwaveWebhookSignature } from "@/lib/payments";
import { jsonRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/**
 * Server-to-server backstop for card payments. The browser redirect
 * (../callback/route.ts) settles the booking for anyone who stays on the
 * page; this settles it for anyone who closes the tab first. Both call the
 * same idempotent settleCardPayment, so whichever runs first wins and the
 * second is a no-op.
 *
 * jsonRoute's 500-on-throw is exactly what's wanted here (not just fallback
 * safety): a genuine exception (e.g. the database is briefly unreachable)
 * should make Flutterwave retry the webhook later, unlike a settlement that
 * deliberately failed its own checks (handled below, still 200).
 */
export const POST = jsonRoute(async (req: NextRequest) => {
  if (!verifyFlutterwaveWebhookSignature(req.headers.get("verif-hash"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const transactionId = body?.data?.id ? String(body.data.id) : null;
  if (!transactionId || body?.data?.status !== "successful") {
    // Flutterwave sends webhooks for failed/other events too — nothing to
    // settle, and returning 200 stops it from being retried forever.
    return NextResponse.json({ ok: true, skipped: true });
  }

  const result = await settleCardPayment(transactionId);
  if (!result.ok) {
    console.error("Card payment webhook settlement failed:", result.error, { transactionId });
    // Still 200: Flutterwave's amount/currency checks already happened in
    // verifyCardPayment, so a rejected settlement here is a real problem to
    // find in logs, not a delivery failure worth Flutterwave retrying.
  }

  return NextResponse.json({ ok: true });
});
