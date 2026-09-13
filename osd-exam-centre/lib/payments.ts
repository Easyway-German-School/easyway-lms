import { secureCompare } from "@/lib/secure-compare";

/**
 * Manual Moniepoint bank-transfer details shown to every candidate. Same
 * design as the LMS's manualBankTransferDetails() (see EasyWay LMS repo,
 * src/lib/exam-payments.ts) for the same reason: no live Monnify/Moniepoint
 * merchant API keys exist yet, so this is "upload a slip, an admin checks
 * the bank app and clicks confirm" rather than an auto-reconciled reserved
 * account. When Monnify API access lands, only this function needs to
 * change — everywhere else just asks "what account do I show/verify".
 */
export function bankTransferDetails(): { bankName: string; accountName: string; accountNumber: string } {
  return {
    bankName: process.env.EXAM_BANK_NAME || "Moniepoint MFB",
    accountName: process.env.EXAM_BANK_ACCOUNT_NAME || "Easyway German Language School",
    accountNumber: process.env.EXAM_BANK_ACCOUNT_NUMBER || "",
  };
}

/**
 * International card payment, via Flutterwave — for candidates sitting from
 * outside Nigeria who cannot make a Nigerian bank transfer. Bank transfer
 * (above) stays the default for everyone else: it's far cheaper (a flat fee
 * vs. Flutterwave's ~3.9% on international cards), so this is deliberately
 * the fallback, not a replacement.
 *
 * Charges the SAME naira amount as the bank transfer — no card surcharge —
 * matching the EasyWay LMS's own Flutterwave-international decision (see
 * that repo's feat/flutterwave-international-payments branch). Flutterwave
 * settles an international card charge in NGN itself; the surcharge only
 * shows up on the CANDIDATE's own bank statement as an FX/foreign-currency
 * fee, which is between them and their card issuer.
 */

const FLW_BASE = "https://api.flutterwave.com/v3";

export function cardPaymentsEnabled(): boolean {
  return Boolean(process.env.FLUTTERWAVE_SECRET_KEY);
}

type FlutterwaveInitiateResponse = { status: string; message?: string; data?: { link: string } };
type FlutterwaveVerifyResponse = {
  status: string;
  data?: {
    status: string;
    currency: string;
    amount: number;
    tx_ref: string;
    meta?: { bookingId?: string };
  };
};

/**
 * Start a Flutterwave checkout for one booking's fee. Returns the hosted
 * payment page to send the candidate's browser to.
 */
export async function initiateCardPayment(
  booking: { id: string; referenceCode: string; feeTotal: number; email: string; fullName: string },
  redirectUrl: string,
): Promise<{ ok: true; paymentLink: string } | { ok: false; error: string }> {
  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!secretKey) return { ok: false, error: "Card payments are not configured." };

  // bookingId travels in `meta`, not just the tx_ref string, so verification
  // never has to parse an id back out of a reference — it reads it straight
  // off Flutterwave's own verified response.
  const txRef = `osd-${booking.id}-${Date.now()}`;

  const res = await fetch(`${FLW_BASE}/payments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      tx_ref: txRef,
      // Amount comes from the booking row on the SERVER, never the client —
      // the same rule as the bank-transfer amount shown on screen.
      amount: booking.feeTotal,
      currency: "NGN",
      redirect_url: redirectUrl,
      customer: { email: booking.email, name: booking.fullName },
      meta: { bookingId: booking.id },
      customizations: {
        title: "Easyway ÖSD Examination Centre",
        description: `Exam fee — booking ${booking.referenceCode}`,
      },
    }),
  });

  const data = (await res.json().catch(() => null)) as FlutterwaveInitiateResponse | null;
  if (!res.ok || data?.status !== "success" || !data.data?.link) {
    return { ok: false, error: data?.message || "Could not start the card payment." };
  }
  return { ok: true, paymentLink: data.data.link };
}

/**
 * Verify a transaction Flutterwave says succeeded, and return the booking it
 * paid for. Called from both the browser redirect and the webhook — either
 * can settle the booking first; confirmBookingPayment (lib/booking.ts) is
 * idempotent on `seatNumber`, so whichever runs second is a no-op.
 */
export async function verifyCardPayment(
  transactionId: string,
): Promise<{ ok: true; bookingId: string; amount: number } | { ok: false; error: string }> {
  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!secretKey) return { ok: false, error: "Card payments are not configured." };

  const res = await fetch(`${FLW_BASE}/transactions/${encodeURIComponent(transactionId)}/verify`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  const data = (await res.json().catch(() => null)) as FlutterwaveVerifyResponse | null;

  const tx = data?.data;
  if (!res.ok || data?.status !== "success" || !tx || tx.status !== "successful") {
    return { ok: false, error: "Payment was not successful." };
  }
  if (tx.currency !== "NGN") {
    return { ok: false, error: `Unexpected currency: ${tx.currency}` };
  }
  const bookingId = tx.meta?.bookingId;
  if (!bookingId) {
    return { ok: false, error: "This transaction is not an ÖSD exam booking." };
  }

  return { ok: true, bookingId, amount: tx.amount };
}

/**
 * Refund a card charge — the one scenario this ever needs to run: a sitting
 * fills up (via bank transfers an admin already verified) in the window
 * between a candidate starting a card checkout and Flutterwave confirming
 * it. The charge succeeds; there is no seat to give them. See
 * lib/booking.ts settleCardPayment(), which calls this automatically the
 * instant that happens, rather than leaving someone charged with nothing.
 *
 * Untested against Flutterwave's real API, same as the rest of this file —
 * no live key exists yet to test a real refund against.
 */
export async function refundCardPayment(
  transactionId: string,
  amount: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const secretKey = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!secretKey) return { ok: false, error: "Card payments are not configured." };

  const res = await fetch(`${FLW_BASE}/transactions/${encodeURIComponent(transactionId)}/refund`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ amount }),
  });
  const data = (await res.json().catch(() => null)) as { status?: string; message?: string } | null;
  if (!res.ok || data?.status !== "success") {
    return { ok: false, error: data?.message || "Flutterwave refused the refund request." };
  }
  return { ok: true };
}

/** Flutterwave signs webhooks with a shared secret hash header, not a signature scheme. */
export function verifyFlutterwaveWebhookSignature(headerValue: string | null): boolean {
  const expected = process.env.FLUTTERWAVE_WEBHOOK_SECRET_HASH;
  if (!expected || !headerValue) return false;
  // Constant-time: a plain `===` on a secret leaks timing information an
  // attacker could use to guess it byte by byte.
  return secureCompare(expected, headerValue);
}
