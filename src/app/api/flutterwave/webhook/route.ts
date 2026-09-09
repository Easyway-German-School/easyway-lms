import { NextResponse } from "next/server";

import {
  isValidFlutterwaveSignature,
  normalizeMeta,
  persistFlutterwaveCharge,
  persistFlutterwavePrivateUpgrade,
  type FlutterwaveTransaction,
} from "@/lib/flutterwave";
import { settleExamFee } from "@/lib/exam-payments";
import { KIND, notifyInBackground } from "@/lib/notify";
import { withUnscoped } from "@/lib/tenant/context";

/**
 * Flutterwave's server-to-server notification — the mirror of the Paystack
 * webhook, and the path that owns the "payment received" notifications and
 * emails (the browser redirect only confirms for the student).
 *
 * Auth: Flutterwave sends the exact string set as the webhook "Secret hash" in
 * the dashboard, in the `verif-hash` header. No HMAC.
 *
 * Runs `withUnscoped` because Flutterwave carries no tenant; the resolved
 * student pins the scope before any write (see `persistFlutterwaveCharge`).
 */

async function handlePOST(request: Request) {
  try {
    const raw = await request.text();

    if (!isValidFlutterwaveSignature(request.headers.get("verif-hash"))) {
      console.error("Flutterwave webhook rejected: invalid or missing verif-hash");
      notifyInBackground({
        to: { audience: "admin", capability: "payments" },
        kind: KIND.gatewayError,
        severity: "critical",
        title: "Flutterwave webhook rejected",
        message:
          "A Flutterwave webhook arrived with an invalid signature. If international payments are not appearing, check that FLW_SECRET_HASH matches the Secret hash in the Flutterwave dashboard.",
        link: "/admin/payments",
        dedupeKey: `gateway-flw-signature-${new Date().toISOString().slice(0, 13)}`,
      });
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const payload = JSON.parse(raw) as { event?: string; "event.type"?: string; data?: FlutterwaveTransaction };
    const event = String(payload.event || payload["event.type"] || "");
    const data = payload.data;

    if (!data || String(data.status || "").toLowerCase() !== "successful") {
      // Failed / pending charges: acknowledge so Flutterwave stops retrying.
      return NextResponse.json({ received: true });
    }
    if (event && !/charge|completed/i.test(event)) {
      return NextResponse.json({ received: true });
    }

    const meta = normalizeMeta(data.meta);
    const reference = String(data.tx_ref || "");
    const amountNaira = Math.round(Number(data.amount) || 0);

    if (meta.kind === "exam_fee" && meta.registrationId) {
      const result = await settleExamFee({ registrationId: meta.registrationId, reference, amount: amountNaira });
      return NextResponse.json({ received: true, examFee: result });
    }

    if (meta.kind === "private_class_upgrade") {
      const result = await persistFlutterwavePrivateUpgrade({ reference, amountNaira, metadata: meta });
      return NextResponse.json({ received: true, upgrade: result });
    }

    const result = await persistFlutterwaveCharge({
      reference,
      amountNaira,
      currency: "NGN",
      metadata: meta,
      notify: true,
    });
    return NextResponse.json({ received: true, payment: result });
  } catch (error) {
    console.error("Flutterwave webhook error:", error);
    notifyInBackground({
      to: { audience: "admin", capability: "payments" },
      kind: KIND.gatewayError,
      severity: "critical",
      title: "Flutterwave webhook failed",
      message: `A Flutterwave webhook could not be processed: ${
        error instanceof Error ? error.message : "unknown error"
      }. Money may have been taken without the payment being recorded — check the Flutterwave dashboard against Payments.`,
      link: "/admin/payments",
    });
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}

export const POST = withUnscoped(
  "payment provider webhook carries no tenant; the payment record identifies it",
  handlePOST,
);
