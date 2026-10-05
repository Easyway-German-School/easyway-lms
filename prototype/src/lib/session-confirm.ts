/**
 * "Am I really signed out?" — asked before a portal turns anybody away.
 *
 * next-auth's client reports `status: "unauthenticated"` whenever its
 * `/api/auth/session` fetch comes back with nothing usable. It makes no
 * distinction between "the server looked at your cookie and there is no
 * session" and "the request never got an answer" (a dropped packet, a 504, a
 * phone on a saturated link while a live class eats the bandwidth). Every
 * portal shell used to redirect to sign-in on that status the instant it saw
 * it, so a network blip read to the person as being logged out.
 *
 * The two cases are told apart here by asking the endpoint ourselves:
 *
 *   - an answer carrying a user      → alive: the cookie is fine, resync the client
 *   - an answer with an empty object → signed_out: the server says there is no
 *                                       session, redirect now, no waiting
 *   - no answer at all (error, HTML error page, timeout) → unreachable: say
 *                                       nothing about the session, try again
 *
 * Only a real "no session" answer ever signs anybody out.
 *
 * Pure and injectable on purpose — the clock and the network are arguments,
 * so the retry rules are tested without waiting for them.
 */

export type SessionProbe = "alive" | "signed_out" | "unreachable";
export type SessionVerdict = SessionProbe | "cancelled";

/** Waits between the four quick probes: ~15 s in total before the slow loop. */
export const BACKOFF_MS = [1_500, 4_000, 9_000] as const;

/** After the quick probes are spent, keep asking at this pace until we know. */
export const SLOW_RETRY_MS = 30_000;

const PROBE_TIMEOUT_MS = 8_000;

export async function probeSession(
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<SessionProbe> {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl("/api/auth/session", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller?.signal,
    });
    // A 5xx, a 429, a gateway's HTML page: the server did not answer the
    // question, so it has not said "signed out".
    if (!res.ok) return "unreachable";
    const body: unknown = await res.json();
    if (body && typeof body === "object" && Object.keys(body as object).length > 0) return "alive";
    return "signed_out";
  } catch {
    // Network failure, abort, or a body that was not JSON.
    return "unreachable";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type ConfirmDeps = {
  probe: () => Promise<SessionProbe>;
  sleep: (ms: number) => Promise<void>;
  delays?: readonly number[];
  /** True once the question no longer matters (the page moved on). */
  cancelled?: () => boolean;
};

/**
 * Ask until the server gives a real answer, up to `delays.length + 1` times.
 * A definite answer (either way) ends it at once; only "unreachable" retries.
 */
export async function confirmSession(
  deps: ConfirmDeps,
): Promise<{ verdict: SessionVerdict; attempts: number }> {
  const delays = deps.delays ?? BACKOFF_MS;
  let attempts = 0;

  for (let i = 0; i <= delays.length; i++) {
    if (deps.cancelled?.()) return { verdict: "cancelled", attempts };
    const result = await deps.probe();
    attempts += 1;
    if (result !== "unreachable") return { verdict: result, attempts };
    if (i < delays.length) await deps.sleep(delays[i]);
  }
  return { verdict: "unreachable", attempts };
}

// ---------------------------------------------------------------------------
// The report the browser sends so the next complaint arrives with data.
// ---------------------------------------------------------------------------

export const REPORT_OUTCOMES = ["signed_out", "recovered", "unreachable"] as const;
export type ReportOutcome = (typeof REPORT_OUTCOMES)[number];

export const REPORT_PORTALS = ["student", "tutor", "admin", "parent"] as const;
export type ReportPortal = (typeof REPORT_PORTALS)[number];

export type AuthReport = {
  outcome: ReportOutcome;
  portal: ReportPortal;
  attempts: number;
  online: boolean;
  hidden: boolean;
  onLivePage: boolean;
};

/**
 * Accept only the exact shape the browser sends. This endpoint cannot ask who
 * is calling (the caller, by definition, may have no session), so nothing in
 * the body is free text: enums and small numbers only.
 */
export function parseAuthReport(raw: unknown): AuthReport | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  const outcome = REPORT_OUTCOMES.find((o) => o === body.outcome);
  const portal = REPORT_PORTALS.find((p) => p === body.portal);
  if (!outcome || !portal) return null;
  const attempts = Number(body.attempts);
  return {
    outcome,
    portal,
    attempts: Number.isFinite(attempts) ? Math.max(0, Math.min(99, Math.trunc(attempts))) : 0,
    online: body.online !== false,
    hidden: body.hidden === true,
    onLivePage: body.onLivePage === true,
  };
}

/**
 * How loud each outcome is in the incident console.
 *
 *   signed_out  — the server really said "no session" for somebody who had one
 *                 a moment ago and did not press Sign out: the bug people report.
 *   recovered   — a logout we PREVENTED: the client would have bounced them.
 *                 Worth counting, not worth waking anybody.
 *   unreachable — they stayed in, but the session endpoint is not answering.
 */
export function severityForOutcome(outcome: ReportOutcome): "low" | "medium" | "high" {
  if (outcome === "signed_out") return "high";
  if (outcome === "unreachable") return "medium";
  return "low";
}

export function reportPortalFromPath(pathname: string): ReportPortal {
  if (pathname.startsWith("/admin") || pathname.startsWith("/platform")) return "admin";
  if (pathname.startsWith("/lecturer")) return "tutor";
  if (pathname.startsWith("/parent")) return "parent";
  return "student";
}
