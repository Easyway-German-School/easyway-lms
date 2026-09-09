import { NextResponse } from "next/server";

import { normalizeMeta, verifyFlutterwaveTransaction } from "@/lib/flutterwave";
import { settleExamFee } from "@/lib/exam-payments";

/**
 * Verify one Flutterwave transaction by its numeric id — the mirror of
 * `/api/paystack/verify`.
 *
 * Unauthenticated for the same reason: the student is coming back from
 * Flutterwave's domain, possibly before the session cookie is re-established or
 * on another device. The protection is that the charge is checked against
 * Flutterwave with the school's secret key, and only `paid` / status flow back
 * — never the payment-instrument details from the transaction object.
 *
 * Callers: the redirect landing (`/enrollment/success`, `/exam-centre/paid`) and
 * the client catch-up poll. All idempotent — the persist deduces on `tx_ref`.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const transactionId = url.searchParams.get("transaction_id") || url.searchParams.get("id");

  if (!transactionId) {
    return NextResponse.json({ error: "Missing transaction_id" }, { status: 400 });
  }

  const result = await verifyFlutterwaveTransaction(transactionId);

  if (!result.success) {
    return NextResponse.json(
      { error: result.error || "Flutterwave verification failed" },
      { status: result.status ?? 502 },
    );
  }

  const transaction = result.data;
  const paid = transaction?.status?.toLowerCase() === "successful";
  const meta = normalizeMeta(transaction?.meta);

  if (result.persistFailed) {
    return NextResponse.json(
      { success: false, paid, persistFailed: true, error: result.error, reference: transaction?.tx_ref },
      { status: 500 },
    );
  }

  // Exam fees are not persisted inside the lib — settle the seat here. Idempotent.
  if (paid && meta.kind === "exam_fee" && meta.registrationId) {
    const amount = Math.round(Number(transaction?.amount) || 0);
    const settled = await settleExamFee({
      registrationId: meta.registrationId,
      reference: String(transaction?.tx_ref || ""),
      amount,
    });
    return NextResponse.json({
      success: true,
      paid,
      amount,
      alreadySettled: settled.alreadySettled,
      registrationId: meta.registrationId,
      transactionStatus: transaction?.status ?? "unknown",
    });
  }

  return NextResponse.json({
    success: true,
    paid,
    transactionStatus: transaction?.status ?? "unknown",
  });
}
