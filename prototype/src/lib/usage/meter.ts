/**
 * What a tenant is billed for, and what it costs us.
 *
 * The prices here are not invented. Every meter except `api.request` is a
 * direct pass-through of a bill this platform already receives — LiveKit
 * charges by participant-minute, R2 by stored gigabyte, the model providers by
 * token, the email provider by send. That is the whole pricing argument: a
 * school can be shown exactly which of its own actions produced a line on the
 * invoice, and the margin is a stated multiple rather than a number somebody
 * picked.
 *
 * It also means the cheapest thing we can do for a customer's bill is the same
 * as the cheapest thing we can do for our own — which is why lib/ai-cache.ts
 * matters commercially and not just technically. A cache hit is a call neither
 * of us pays for.
 *
 * PRICES ARE PLACEHOLDERS pending real provider invoices and Jason's margin
 * decision. They are marked so nobody quotes them to a customer by accident.
 */

export const METERS = {
  /**
   * Model output. Priced per 1,000 tokens because that is how providers quote
   * and comparing against them should be arithmetic-free for the buyer.
   */
  "ai.tokens": { unit: "token", per: 1000, label: "AI generation" },

  /**
   * Live classroom, per participant-minute. A tutor and nine students for an
   * hour is 600 units, not 60 — which is exactly how LiveKit bills us.
   */
  "live.participant_minutes": { unit: "minute", per: 1, label: "Live class" },

  /** Recording egress and storage, per gigabyte-month. */
  "storage.gb_month": { unit: "gigabyte", per: 1, label: "Storage" },

  /** Per delivered message. */
  "email.sent": { unit: "email", per: 1, label: "Email" },

  /**
   * Per authenticated API call. The only meter that is not a cost
   * pass-through: it prices the platform itself rather than a supplier, and
   * exists so integration-heavy tenants who use no AI still carry their share.
   */
  "api.request": { unit: "request", per: 1000, label: "API requests" },

  /**
   * Distinct students who did anything at all in the calendar month. The
   * fairest headline number for a school, and the one they can predict.
   */
  "students.active_monthly": { unit: "student", per: 1, label: "Active students" },
} as const;

export type MeterName = keyof typeof METERS;

/** Kobo per `METERS[meter].per` units. PLACEHOLDER — see the note above. */
export const PLACEHOLDER_RATES_KOBO: Record<MeterName, number> = {
  "ai.tokens": 200,
  "live.participant_minutes": 50,
  "storage.gb_month": 15000,
  "email.sent": 100,
  "api.request": 500,
  "students.active_monthly": 25000,
};

export function costKobo(
  meter: MeterName,
  quantity: number,
  /**
   * The live rate for this meter, from usage/rates.ts. Omitted, it falls back
   * to the placeholder above — fine for a rough `quote()`, not for the bill,
   * which is why the nightly rollup passes the real value.
   */
  rateKobo: number = PLACEHOLDER_RATES_KOBO[meter],
): number {
  const { per } = METERS[meter];
  const rate = rateKobo;
  /**
   * Rounded up, per billing period, not per event. Rounding each event up
   * turns a thousand one-token calls into a thousand roundings — a customer
   * who is billed for a hundred times what they used and is entirely right to
   * be angry about it. The ceiling belongs in the daily rollup.
   */
  return Math.ceil((quantity / per) * rate);
}

/**
 * Build the idempotency key for an event.
 *
 * The rule that makes the ledger trustworthy: the key must be derivable from
 * the source event alone, so that replaying that event a year later produces
 * the same key and is rejected as the duplicate it is. Never a timestamp,
 * never a random value, never `Date.now()`.
 *
 *   meterKey("ai.tokens", `aicache:${cacheRowId}`)
 *   meterKey("live.participant_minutes", `livekit:${sessionId}:${identity}`)
 *   meterKey("email.sent", `email:${emailMessageId}`)
 */
export function meterKey(meter: MeterName, sourceId: string): string {
  if (!sourceId || /^\d+$/.test(sourceId)) {
    throw new Error(
      `Refusing to build an idempotency key from "${sourceId}". It must identify the source event, not a counter or a timestamp.`,
    );
  }
  return `${meter}:${sourceId}`;
}
