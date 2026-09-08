/**
 * One place server-side errors go to be noticed.
 *
 * docs/SECURITY.md §8 listed "no error tracking" as a known gap: a route that
 * throws, a cron job that fails, an auth path that errors — each writes a line
 * to a log nobody reads and is otherwise invisible. This does not add Sentry
 * (a build-time dependency that is inert without an account); it adds a seam.
 *
 *  - Always: a single structured `console.error` line, greppable in the Vercel
 *    logs by the `[captureError]` prefix.
 *  - If `ERROR_WEBHOOK_URL` is set: a best-effort POST of a compact JSON body,
 *    so the same events can be fanned to Slack, Discord, a webhook-to-email, or
 *    a real Sentry/GlitchTip ingest endpoint later, with no code change here.
 *
 * It never throws and never rejects. An error handler that can itself blow up
 * is worse than none.
 */

export type ErrorContext = Record<string, unknown>;

export async function captureError(
  where: string,
  error: unknown,
  context?: ErrorContext,
): Promise<void> {
  const err = error instanceof Error ? error : new Error(String(error));

  const payload = {
    app: "easyway-lms",
    env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
    where,
    message: err.message,
    stack: err.stack?.split("\n").slice(0, 20).join("\n"),
    context: context ?? {},
    at: new Date().toISOString(),
  };

  // The log line is the part that always happens.
  console.error(`[captureError] ${where}: ${err.message}`, {
    context: payload.context,
    stack: payload.stack,
  });

  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return;

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      // Do not let a slow sink hold a request open.
      signal: AbortSignal.timeout(4000),
    });
  } catch (forwardError) {
    console.error("[captureError] could not reach ERROR_WEBHOOK_URL:", forwardError);
  }
}

/** Fire-and-forget wrapper for call sites that must not await. */
export function captureErrorInBackground(
  where: string,
  error: unknown,
  context?: ErrorContext,
): void {
  void captureError(where, error, context);
}
