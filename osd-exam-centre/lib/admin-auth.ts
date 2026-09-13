import crypto from "node:crypto";
import { cookies } from "next/headers";

/**
 * Deliberately minimal: one shared admin password (ADMIN_PASSWORD), no user
 * table, no roles. This app has one back office (Jason's team reviewing
 * bookings), not the LMS's five-tier staff hierarchy — building that RBAC
 * again here would be solving a problem this app doesn't have yet. Upgrade
 * to real accounts if/when more than one person needs distinct audit trails.
 *
 * The cookie is an HMAC-signed token, not a raw flag, so it can't be forged
 * by guessing a cookie name — but it is still a SHARED secret, not a login:
 * anyone who has ADMIN_PASSWORD is "the office".
 */

const COOKIE_NAME = "osd_admin_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

function secret(): string {
  const value = process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD;
  if (!value) throw new Error("ADMIN_SESSION_SECRET or ADMIN_PASSWORD must be set");
  return value;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("hex");
}

export function checkAdminPassword(candidate: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createSessionToken(): string {
  const expires = Date.now() + SESSION_TTL_MS;
  const payload = `admin:${expires}`;
  return `${payload}.${sign(payload)}`;
}

function verifySessionToken(token: string): boolean {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  if (sign(payload) !== signature) return false;
  const [, expiresRaw] = payload.split(":");
  const expires = Number(expiresRaw);
  return Number.isFinite(expires) && Date.now() < expires;
}

export async function isAdminRequest(): Promise<boolean> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  return Boolean(token && verifySessionToken(token));
}

export const ADMIN_COOKIE_NAME = COOKIE_NAME;
