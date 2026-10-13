/**
 * Next's official hook for "a request errored on the server". Every thrown
 * error in a route handler, a server component, or a server action that would
 * otherwise only reach the platform log passes through here first.
 *
 * See src/lib/capture-error.ts for where it goes. Kept deliberately thin: this
 * file runs in a constrained runtime, so it does nothing but hand off.
 */

import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  /**
   * This hook also fires for the edge runtime (middleware/proxy.ts). The
   * guard below is correct for a production build, where NEXT_RUNTIME is
   * replaced with a literal per bundle target and this whole branch is
   * dead-code-eliminated out of the edge bundle.
   *
   * It is NOT sufficient for `next dev --webpack`: dev mode skips that
   * elimination pass, so webpack still statically resolves the dynamic
   * import below while compiling the one shared `/instrumentation` entry,
   * walks into capture-error.ts -> incidents.ts -> notify.ts -> push.ts ->
   * `web-push`, and fails on the first Node builtin it can't give an edge
   * bundle (`http`, then `crypto` one layer deeper — adding `web-push` to
   * serverExternalPackages in next.config.js stopped the first, not the
   * second). The practical effect: the FIRST real request of a dev session
   * compiles `/instrumentation`, that compile fails, and every request after
   * it 500s until the server restarts.
   *
   * The actual fix needs capture-error's push-notification step to stop
   * being statically reachable from this file at all — e.g. have it POST to
   * an internal route instead of importing notify.ts/push.ts directly, the
   * same shape Next's own docs use for onRequestError. Tracked separately;
   * not attempted here.
   */
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { captureError } = await import("@/lib/capture-error");
  await captureError("request", error, {
    path: request.path,
    method: request.method,
    routePath: context.routePath,
    routeType: context.routeType,
    renderSource: context.renderSource,
  });
};
