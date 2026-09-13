import crypto from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { secureCompare } from "@/lib/secure-compare";

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
  return secureCompare(candidate, expected);
}

export function createSessionToken(): string {
  const expires = Date.now() + SESSION_TTL_MS;
  const payload = `admin:${expires}`;
  return `${payload}.${sign(payload)}`;
}

function verifySessionToken(token: string): boolean {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = sign(payload);
  // Constant-time, same reason as checkAdminPassword above — a plain `!==`
  // on a secret comparison leaks timing information an attacker can use to
  // guess it one byte at a time, however impractically slowly.
  if (!secureCompare(expected, signature)) return false;
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

// ---------------------------------------------------------------------------
// Login-attempt lockout
// ---------------------------------------------------------------------------
// ADMIN_PASSWORD is the entire authentication story for this app's back
// office (see the module comment above) — a single guessable password with
// no rate limit is a real way in, not a theoretical one. Ten wrong attempts
// from one IP within fifteen minutes locks that IP out for the rest of the
// window; a genuine admin who mistyped it a few times just waits.
//
// Trade-off worth knowing about: before this, /admin/login needed nothing
// but ADMIN_PASSWORD itself — no database call at all. Checking the lockout
// means every login attempt now reads LoginAttempt first, so a database
// outage means nobody can sign in, even with the correct password, instead
// of only "nobody can see live bookings". That's the right failure mode —
// failing closed on a security check beats failing open — but it is a new
// dependency this route didn't have before, confirmed while testing this
// against an unreachable database: every attempt returned a generic 500
// rather than ever reaching the "wrong password" check.

const LOCKOUT_MAX_FAILURES = 10;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

export function clientIp(req: Request): string {
  // Vercel (and most proxies) set this; the first entry is the original
  // client. Falls back to a shared bucket in local dev, where there is no
  // proxy setting it at all — still better than no limit than none.
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

export async function isLockedOut(ip: string): Promise<boolean> {
  const recentFailures = await prisma.loginAttempt.count({
    where: { ip, success: false, createdAt: { gte: new Date(Date.now() - LOCKOUT_WINDOW_MS) } },
  });
  return recentFailures >= LOCKOUT_MAX_FAILURES;
}

export async function recordLoginAttempt(ip: string, success: boolean): Promise<void> {
  await prisma.loginAttempt.create({ data: { ip, success } });
}
