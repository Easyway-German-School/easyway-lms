import { NextResponse } from "next/server";

/**
 * A cap on how often one caller may hit an endpoint that answers strangers.
 *
 * Three routes in this app take a POST from someone who is not signed in:
 * sign-in, signup and the public enquiry form. Until now none of them counted
 * attempts, which meant:
 *
 *   sign-in   an attacker could sit on it and test passwords all day. bcrypt
 *             makes each guess slow for us as well as for them, so this is
 *             also the cheapest way to pin the CPU of every serverless
 *             instance the school is paying for.
 *   signup    a script could mint accounts — each one writes a User, a
 *             Student, a student code and an admin alert email.
 *   leads     CORS is deliberately open so the marketing site can post to it,
 *             so anybody at all can fill the enquiries table with noise. That
 *             table is what the office works from every morning.
 *
 * WHAT THIS DOES NOT DO. The counters live in this process's memory. On Vercel
 * every serverless instance has its own, so a caller spread across instances
 * gets a multiple of the limit, and a deploy resets every counter. That is a
 * real weakness and it is worth being plain about: this stops one machine
 * hammering one endpoint, which is what actually happens, and it does not stop
 * a distributed attack.
 *
 * It is in-memory rather than in Postgres on purpose — a database write per
 * request on the sign-in path is its own denial-of-service, and Neon is
 * already the thing that cold-starts. If the school ever needs the stronger
 * guarantee, the upgrade is a `RateLimit` table keyed the same way, or Redis;
 * `checkRateLimit` is the only signature that would have to change.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/**
 * Ceiling on distinct keys held at once.
 *
 * Without it the map is an unbounded write: every new IP that ever calls
 * signup adds an entry that outlives its own window, and the instance leaks
 * until it is recycled. When the ceiling is reached we drop everything already
 * expired, which in normal traffic is nearly all of it.
 */
const MAX_TRACKED_KEYS = 10_000;

function sweep(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitResult = {
  ok: boolean;
  /** Seconds until the window rolls over. Only meaningful when `ok` is false. */
  retryAfter: number;
  remaining: number;
};

/**
 * Count one attempt against `key` and say whether it is allowed.
 *
 * A fixed window rather than a sliding one: it lets a caller spend the whole
 * allowance at the very end of one window and again at the start of the next,
 * which for these limits is harmless and costs a great deal less bookkeeping.
 */
export function checkRateLimit(
  key: string,
  options: { windowMs: number; max: number },
): RateLimitResult {
  const now = Date.now();

  if (buckets.size >= MAX_TRACKED_KEYS) sweep(now);

  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return { ok: true, retryAfter: 0, remaining: options.max - 1 };
  }

  existing.count += 1;

  if (existing.count > options.max) {
    return {
      ok: false,
      retryAfter: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      remaining: 0,
    };
  }

  return { ok: true, retryAfter: 0, remaining: options.max - existing.count };
}

/**
 * Forget a key entirely.
 *
 * Used on a successful sign-in so that somebody who mistyped their password
 * four times and then got it right is not still carrying those four attempts
 * into the next hour.
 */
export function clearRateLimit(key: string) {
  buckets.delete(key);
}

/**
 * Best-effort caller identity.
 *
 * `x-forwarded-for` is a client-supplied header and can be forged — but on
 * Vercel the platform overwrites it at the edge, so the first entry is the
 * real peer. Taking the first entry rather than the last matters: the last is
 * whatever the caller appended.
 */
export function clientIp(headers: Headers | Record<string, unknown> | undefined): string {
  const read = (name: string): string | null => {
    if (!headers) return null;
    if (typeof (headers as Headers).get === "function") {
      return (headers as Headers).get(name);
    }
    const value = (headers as Record<string, unknown>)[name];
    return typeof value === "string" ? value : null;
  };

  const forwarded = read("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();

  return read("x-real-ip") || "unknown";
}

/**
 * The 429 itself.
 *
 * `Retry-After` is not decoration — it is what tells a well-behaved client to
 * back off instead of retrying immediately and digging the hole deeper.
 */
export function rateLimitResponse(
  result: RateLimitResult,
  message: string,
  extraHeaders: Record<string, string> = {},
) {
  return NextResponse.json(
    { error: message },
    {
      status: 429,
      headers: { ...extraHeaders, "Retry-After": String(result.retryAfter) },
    },
  );
}
