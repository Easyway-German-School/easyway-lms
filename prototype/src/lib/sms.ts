/**
 * Outbound SMS, via Termii — the Nigeria-focused aggregator, chosen because
 * its delivery rates on Nigerian networks (MTN, Glo, Airtel, 9mobile) are far
 * better than an international provider's, and it needs no dedicated
 * short-code registration for transactional traffic under a shared Sender ID.
 *
 * Mirrors src/lib/mailer.ts's shape (`isXConfigured`, a single send function)
 * so the two channels read the same way at every call site.
 */

const TERMII_BASE_URL = "https://api.ng.termii.com/api/sms/send";

export function isSmsConfigured(): boolean {
  return Boolean(process.env.TERMII_API_KEY);
}

/**
 * Nigerian numbers arrive in every shape a person types on a form: "0803...",
 * "+234803...", "234803...", with spaces or dashes. Termii wants a bare
 * international-format number with no leading `+` (e.g. "2348031234567").
 *
 * Returns null for anything that cannot confidently be read as a Nigerian
 * mobile number — sending to a mangled number is a wasted, billed SMS, so a
 * caller must treat null as "cannot text this person" rather than guess.
 */
export function normalizeNigerianPhone(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/[^\d]/g, "");
  if (!digits) return null;

  if (digits.startsWith("234") && digits.length === 13) return digits;
  if (digits.startsWith("0") && digits.length === 11) return `234${digits.slice(1)}`;
  // A bare 10-digit local number with the leading 0 already stripped off.
  if (digits.length === 10) return `234${digits}`;

  return null;
}

export type SendSmsResult = { ok: boolean; error?: string };

/** One message, sent inline. Callers should go through sms-queue.ts, not this, for anything user-triggered. */
export async function sendSms({ to, message }: { to: string; message: string }): Promise<SendSmsResult> {
  const apiKey = process.env.TERMII_API_KEY;
  if (!apiKey) return { ok: false, error: "TERMII_API_KEY is not set" };

  const senderId = process.env.TERMII_SENDER_ID || "EasyWay";

  try {
    const res = await fetch(TERMII_BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        to,
        from: senderId,
        sms: message,
        type: "plain",
        channel: "generic",
      }),
    });

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, error: (body && (body.message || body.error)) || `Termii responded ${res.status}` };
    }
    // Termii returns { message_id, ... } on success and { message: "..." } on
    // a rejected/invalid request even with a 200 — a message_id is the only
    // reliable signal the message was actually accepted for delivery.
    if (body && (body.message_id || body.code === "ok")) return { ok: true };
    return { ok: false, error: (body && body.message) || "Termii did not confirm delivery" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Network error" };
  }
}
