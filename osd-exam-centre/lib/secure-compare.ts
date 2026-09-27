import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison for anything checked against a secret (a
 * password, a signed token, a webhook signature, a cron bearer token). A
 * plain `===`/`!==` short-circuits on the first mismatched byte, which leaks
 * how many leading characters were correct via response timing — slow and
 * impractical over the network, but not a reason to leave it in when the
 * fix is one function. This is the third place this exact bug turned up
 * (admin session token, Flutterwave webhook signature, now the cron bearer
 * token); centralizing it here is what stops a fourth.
 */
export function secureCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
