import { NextResponse } from "next/server";

import { recordIncident } from "@/lib/incidents";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { parseAuthReport, severityForOutcome } from "@/lib/session-confirm";

export const dynamic = "force-dynamic";

/**
 * The browser says what its session check just did. See lib/session-confirm.ts.
 *
 * Open to callers with no session, because that is exactly who is reporting a
 * sign-out. What keeps it safe: the body is an enum and a few small numbers
 * (never free text), one source can send only a handful a minute, and every
 * report folds into an existing incident instead of making a row of its own.
 *
 * Always answers 204 — to a well-formed report, a malformed one, a throttled
 * caller — so it can never become an oracle and the page never has anything to
 * handle.
 */
export async function POST(request: Request) {
  const ip = clientIp(request.headers);
  if (!checkRateLimit(`auth-report:${ip}`, { windowMs: 10 * 60_000, max: 20 }).ok) {
    return new NextResponse(null, { status: 204 });
  }

  const report = parseAuthReport(await request.json().catch(() => null));
  if (!report) return new NextResponse(null, { status: 204 });

  const headline = {
    signed_out: "signed out although the session was valid a moment ago",
    recovered: "session check failed, then recovered (a logout we prevented)",
    unreachable: "session check is not being answered; user kept signed in",
  }[report.outcome];

  await recordIncident({
    kind: "health",
    source: "client",
    route: "/api/auth/session",
    message: `${report.portal} portal: ${headline}`,
    severity: severityForOutcome(report.outcome),
    context: {
      outcome: report.outcome,
      portal: report.portal,
      attempts: report.attempts,
      online: report.online,
      pageHidden: report.hidden,
      onLivePage: report.onLivePage,
    },
  });

  return new NextResponse(null, { status: 204 });
}
