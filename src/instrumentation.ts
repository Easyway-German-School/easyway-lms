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
  const { captureError } = await import("@/lib/capture-error");
  await captureError("request", error, {
    path: request.path,
    method: request.method,
    routePath: context.routePath,
    routeType: context.routeType,
    renderSource: context.renderSource,
  });
};
