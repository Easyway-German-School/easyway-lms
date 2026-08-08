import type { NextRequest } from "next/server";
import { resolveApiKey, hasScope, type ResolvedKey } from "@/lib/api/keys";
import { apiError } from "@/lib/api/response";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/lib/rate-limit";

/**
 * The door on every /api/v1 route.
 *
 * Session cookies are not accepted here, deliberately. The internal routes
 * authenticate with a NextAuth session because their caller is our own
 * browser; a public API authenticated the same way would be reachable from any
 * page a signed-in user happens to visit, which is the definition of CSRF. A
 * bearer token cannot be attached by a browser on someone's behalf.
 */

export type ApiContext = {
  key: ResolvedKey;
  tenantId: string;
  /** True on a test key. Handlers must never touch real money in test mode. */
  sandbox: boolean;
};

export type ApiGate =
  | { ok: true; ctx: ApiContext }
  | { ok: false; response: ReturnType<typeof apiError> };

function bearerFrom(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, ...rest] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer") return null;
  const value = rest.join(" ").trim();
  return value || null;
}

/**
 * Authenticate, authorise and meter a request.
 *
 * `requiredScope` is mandatory rather than optional. An optional scope
 * argument means a route can be written without one and will authorise
 * anybody holding any key — the same "forgot the filter" failure the tenant
 * client exists to prevent, one layer up.
 */
export async function requireApiKey(
  request: NextRequest,
  requiredScope: string,
): Promise<ApiGate> {
  const presented = bearerFrom(request) ?? request.headers.get("x-api-key");

  /**
   * The key is never read from the query string.
   *
   * The tenant-portal spike accepted `?apiKey=`, which puts a live credential
   * into access logs, browser history, referer headers and any CDN in front of
   * it. A header is the only place it belongs.
   */
  const resolved = await resolveApiKey(presented);

  if (!resolved.ok) {
    /**
     * Unauthenticated attempts are limited by IP. Without it the endpoint is
     * an oracle a script can grind against, and every attempt costs us a
     * database lookup.
     */
    const ip = clientIp(request.headers);
    const limit = checkRateLimit(`apiauth:ip:${ip}`, { windowMs: 60 * 1000, max: 30 });
    if (!limit.ok) {
      return { ok: false, response: rateLimitResponse(limit, "Too many requests.") as never };
    }

    // One message for missing, malformed, unknown, revoked and expired. Which
    // of those it was is information an attacker does not get for free.
    return {
      ok: false,
      response: apiError("unauthenticated", "A valid API key is required."),
    };
  }

  const { key } = resolved;

  if (!hasScope(key, requiredScope)) {
    return {
      ok: false,
      response: apiError(
        "forbidden",
        `This key does not carry the "${requiredScope}" scope.`,
      ),
    };
  }

  /**
   * Per-key limiting, so one partner's runaway loop cannot degrade the API for
   * every other partner.
   *
   * Honest caveat: the counter is per serverless instance (see
   * src/lib/rate-limit.ts), so the effective ceiling is this number times the
   * number of live instances. Adequate while partners are few and the first
   * thing that must move to Redis before they are not.
   */
  const limit = checkRateLimit(`apikey:${key.id}`, { windowMs: 60 * 1000, max: 120 });
  if (!limit.ok) {
    return {
      ok: false,
      response: rateLimitResponse(limit, "Rate limit exceeded for this API key.") as never,
    };
  }

  return {
    ok: true,
    ctx: { key, tenantId: key.tenantId, sandbox: key.environment === "test" },
  };
}
