import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

import { authHandler, authOptions } from "@/lib/auth";
import { guardSessionResponse } from "@/lib/session-cookie-guard";

/**
 * GET goes through the cookie guard; POST (sign-in, sign-out, csrf) is untouched.
 *
 * `authHandler` is called with exactly the arguments Next gave this function —
 * next-auth tells its App Router mode from its Pages mode by whether the
 * second argument carries `params`, so the context must be passed through
 * as-is. See lib/session-cookie-guard.ts for what the guard is for.
 */
async function guardedGet(request: NextRequest, context: unknown): Promise<Response> {
  const response = (await (authHandler as (req: NextRequest, ctx: unknown) => Promise<Response>)(
    request,
    context,
  )) as Response;

  const verdict = await guardSessionResponse({
    method: request.method,
    pathname: request.nextUrl.pathname,
    cookieHeader: request.headers.get("cookie"),
    response,
    cookieDecodes: async () =>
      Boolean(
        await getToken({
          req: request,
          secret: process.env.NEXTAUTH_SECRET,
          // Same reasoning as proxy.ts: derive it from the request, not from an
          // env var that may not be visible in this runtime.
          secureCookie: request.nextUrl.protocol === "https:",
        }),
      ),
  });

  if (verdict.action === "pass") return response;

  // The cookie was about to be deleted by a server-side fault. Keep it, say so
  // loudly enough to find, and let the client's check ask again.
  const { captureError } = await import("@/lib/capture-error");
  await captureError("auth-session-cookie-guard", new Error(verdict.reason), {
    routePath: "/api/auth/session",
    method: "GET",
  });
  return verdict.response;
}

export { guardedGet as GET, authHandler as POST };
export { authOptions };
