import type { NextRequest } from "next/server";
import { resolveApiKey, hasScope, type ResolvedKey } from "@/lib/api/keys";
import { apiError } from "@/lib/api/response";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { setTenantScope, beginRequestScope } from "@/lib/tenant/context";
import { creditBlocked } from "@/lib/usage/guard";

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
  /**
   * FIRST STATEMENT, BEFORE ANY AWAIT.
   *
   * This installs the empty scope holder in the CALLER's async context — the
   * route handler's. Everything below fills it in by reference once the key
   * says whose it is. Move this after the first `await` and the handler's
   * queries see no tenant at all, which is how this was originally written and
   * why every v1 endpoint returned 500 while /me, which touches only a global
   * model, passed. See src/lib/tenant/context.ts.
   */
  beginRequestScope();

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

  /**
   * The key has now said whose it is, so everything the handler does from here
   * is scoped to that tenant. This is the API's equivalent of the session seam:
   * one place, so no v1 route has to remember, including the ones written
   * later.
   *
   * This FILLS IN the holder installed at the top — it does not install a new
   * one. By this point we are past several awaits, and a fresh `enterWith` here
   * would attach to this function's own continuation and never reach the route
   * handler that called it.
   */
  setTenantScope(key.tenantId);

  /**
   * A live key on a tenant whose credit has run out — including the grace
   * allowance — is refused here, before the handler does any work. Test keys
   * are exempt, same reasoning as the metering skip below: a sandbox that
   * stops working because of somebody else's unpaid invoice is not a sandbox.
   *
   * Deliberately narrow: this blocks only the partner-facing /api/v1 surface,
   * not student-facing AI, live classes or email — see the philosophy
   * `warnLowBalances` in usage/record.ts already states ("not cut them off").
   * A machine integration with no student watching is a different call.
   */
  if (key.environment === "live") {
    const blocked = await creditBlocked(key.tenantId);
    if (blocked) {
      return {
        ok: false,
        response: apiError(
          "payment_required",
          "This school's platform credit is exhausted. Top up from Platform billing to resume API access.",
        ),
      };
    }
  }

  /**
   * The request itself is billable — the one meter that prices the platform
   * rather than passing a supplier's bill through, so that integration-heavy
   * partners who use no AI still carry their share.
   *
   * Test keys are not metered. A sandbox that costs money is a sandbox nobody
   * develops against, and the whole point of having one is that mistakes in it
   * are free.
   *
   * Fire-and-forget: a billing write must never add latency to, or fail, the
   * call it is measuring. The honest ceiling on this design is one row per
   * request — fine while partners are few, and the first thing that should
   * become an aggregated counter when they are not.
   */
  if (key.environment === "live") {
    void import("@/lib/usage/record").then(({ recordUsage }) =>
      recordUsage({
        meter: "api.request",
        quantity: 1,
        sourceId: `apireq:${crypto.randomUUID()}`,
        metadata: { keyPrefix: key.prefix, scope: requiredScope },
      }),
    );
  }

  return {
    ok: true,
    ctx: { key, tenantId: key.tenantId, sandbox: key.environment === "test" },
  };
}
