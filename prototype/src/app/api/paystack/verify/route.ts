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
 *
 * WHY IT ANSWERS AN UNAUTHENTICATED CALLER, AND WHAT IT MAY THEREFORE SAY.
 *
 * It has to be open: the student arrives back from Paystack's domain, and on a
 * flaky Nigerian connection they may land here before the session cookie is
 * re-established, or on a different device entirely. Requiring a session would
 * break the exact recovery path this exists for.
 *
 * The protection is that a reference cannot be forged — Paystack itself is
 * asked, with the school's secret key, whether the charge is real. But the
 * reference is NOT a secret: it is `easyway-{timestamp}-{userId}`, it sits in
 * localStorage and in the return URL, and it survives in browser history and
 * in any screenshot a student sends to the office.
 *
 * So this route used to return `result.data` — Paystack's entire transaction
 * object — to anyone holding one. That payload carries the payer's name, email
 * and phone, and under `authorization` the card's bank, brand, BIN and last
 * four digits. None of it was ever read: every caller uses `paid` and
 * `transactionStatus` and nothing else. It is now not sent at all, because the
 * safe amount of payment-instrument data to hand an unauthenticated caller is
 * none.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const reference = new URL(request.url).searchParams.get("reference");

  if (!reference) {
    return NextResponse.json({ error: "Missing reference" }, { status: 400 });
  }

  const result = await verifyPaystackTransaction(reference);

  if (!result.success) {
    // `details: result.data` used to ride along here too, which leaked the same
    // payload on the failure path. The message is enough for the student, and
    // the full response is already in the server log for the office.
    return NextResponse.json(
      { error: result.error || "Paystack verification failed" },
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
  });
}
