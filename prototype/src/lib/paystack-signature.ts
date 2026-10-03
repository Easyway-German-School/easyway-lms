import crypto from "node:crypto";

/**
 * Paystack signs every webhook with HMAC SHA512 of the raw body, keyed by the
 * account's secret key, in the `x-paystack-signature` header. Without this check
 * anyone who knows the URL can POST a charge.success and unlock paid content for
 * free.
 *
 * Pure and key-as-argument on purpose: the platform's webhook checks against the
 * platform key and a business's webhook checks against that business's own key,
 * and the two must never share a code path that reads the key from somewhere.
 */
export function isValidPaystackSignature(
  rawBody: string,
  signature: string | null,
  secretKey: string | null | undefined,
): boolean {
  if (!secretKey || !signature) return false;

  const expected = crypto.createHmac("sha512", secretKey).update(rawBody, "utf8").digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
