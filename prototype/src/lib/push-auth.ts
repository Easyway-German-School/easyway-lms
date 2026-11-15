/**
 * Short-lived signed tokens that let a browser open a WebSocket to the
 * self-hosted push server (see push-server/server.ts) without that server
 * ever seeing the NextAuth session cookie.
 *
 * WHY NOT JUST FORWARD THE SESSION COOKIE: the push server runs on a
 * different host/port than the app, so the cookie's domain would not match
 * and the browser would never send it on the WebSocket handshake anyway.
 * Minting an explicit token from a same-origin API route (which DOES see the
 * cookie) sidesteps that instead of fighting cross-domain cookie rules.
 *
 * Same HMAC-over-timestamp scheme as src/lib/recorder.ts's
 * signRecorderBody/verifyRecorderRequest — proven, already tested, reused
 * here with a distinct purpose string folded into the signed body so a
 * recorder token and a push token can never be swapped for one another even
 * if they shared a secret.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const PURPOSE = "push-auth-v1";
export const PUSH_TOKEN_TTL_MS = 5 * 60_000;

function sign(secret: string, userId: string, expiresAt: number): string {
  return createHmac("sha256", secret).update(`${PURPOSE}.${userId}.${expiresAt}`).digest("hex");
}

export function mintPushToken(userId: string, secret: string, now = Date.now()): string {
  const expiresAt = now + PUSH_TOKEN_TTL_MS;
  const signature = sign(secret, userId, expiresAt);
  return `${userId}.${expiresAt}.${signature}`;
}

export function verifyPushToken(token: string, secret: string, now = Date.now()): { ok: true; userId: string } | { ok: false; reason: string } {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed token" };
  const [userId, expiresAtRaw, signature] = parts as [string, string, string];
  const expiresAt = Number(expiresAtRaw);
  if (!userId || !Number.isFinite(expiresAt)) return { ok: false, reason: "malformed token" };
  if (now > expiresAt) return { ok: false, reason: "expired" };
  const expected = Buffer.from(sign(secret, userId, expiresAt));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "signature mismatch" };
  return { ok: true, userId };
}
