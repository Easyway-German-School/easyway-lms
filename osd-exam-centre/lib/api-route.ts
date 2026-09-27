import { NextResponse } from "next/server";

/**
 * Wrap a route handler so an unexpected throw (a Prisma error when the
 * database is unreachable, most often) becomes a JSON 500 instead of an
 * HTML crash page.
 *
 * This exists because of a bug pattern that hit three different routes in
 * this app before this wrapper did: every client-side `fetch(...).then(r =>
 * r.json())` in this codebase assumes the response body IS JSON even on
 * failure, so an uncaught throw here doesn't just 500 — it leaves the
 * calling page's `.then()` chain rejecting with "Unexpected end of JSON
 * input" and, wherever that rejection has no `.catch`, a UI stuck on
 * "Loading…" forever. Wrapping every handler here means that failure mode
 * can't recur route by route.
 */
export function jsonRoute<Req extends Request, Args extends unknown[]>(
  handler: (req: Req, ...args: Args) => Promise<Response>,
): (req: Req, ...args: Args) => Promise<Response> {
  return async (req, ...args) => {
    try {
      return await handler(req, ...args);
    } catch (error) {
      console.error(`Unhandled error in ${req.method} ${new URL(req.url).pathname}:`, error);
      return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
    }
  };
}
