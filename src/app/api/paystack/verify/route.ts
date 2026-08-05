import { NextResponse } from "next/server";

import { verifyPaystackTransaction } from "@/lib/paystack-verify";

/**
 * Verify one Paystack transaction by reference.
 *
 * This route used to carry its own line-for-line copy of
 * `persistPaystackTransaction` — around 130 duplicated lines. The copy is gone:
 * the enrolment foreign-key bug that made successful payments report "Unable to
 * verify payment" lived in BOTH, so fixing the library alone would have left
 * the manual "Verify payment now" button broken in exactly the same way.
 *
 * Callers: the manual verify button on /enrollment/success, and the dashboard's
 * catch-up sweep for a reference left in localStorage when someone closed the
 * tab on Paystack's page. Both are idempotent — the underlying persist returns
 * early once a payment for the reference is already `completed`.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const reference = new URL(request.url).searchParams.get("reference");

  if (!reference) {
    return NextResponse.json({ error: "Missing reference" }, { status: 400 });
  }

  const result = await verifyPaystackTransaction(reference);

  if (!result.success) {
    return NextResponse.json(
      { error: result.error || "Paystack verification failed", details: result.data },
      { status: result.status ?? 502 },
    );
  }

  const transaction = result.data?.data;

  // A confirmed charge we could not write down is reported as an error, but
  // NOT as a verification failure — the distinction decides whether the student
  // is told to try again (pointless, they have paid) or to contact the office.
  if (result.persistFailed) {
    return NextResponse.json(
      {
        success: false,
        paid: transaction?.status === "success",
        persistFailed: true,
        error: result.error,
        reference,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    paid: transaction?.status === "success",
    transactionStatus: transaction?.status ?? "unknown",
    data: result.data,
  });
}
