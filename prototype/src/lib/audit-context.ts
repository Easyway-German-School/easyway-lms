import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who is doing the thing that is about to be written.
 *
 * The audit trail is only worth keeping if it names somebody, and the place
 * that knows the name — the route handler, holding the session — is nowhere
 * near the place that does the writing, which is a Prisma call five modules
 * deep. Threading an actor argument through every function in between would
 * touch most of the codebase and would be forgotten on the next new route.
 *
 * So it rides on the async context instead. Node keeps this per-request even
 * though the process serves many requests at once, which is precisely the
 * property needed here and the reason a module-level variable would be a bug:
 * under any concurrency at all it would attribute one admin's deletion to
 * whoever happened to be mid-request beside them.
 */

export type AuditActor = {
  userId?: string;
  email?: string;
  /** admin | student | lecturer | system, plus the admin sub-role if known. */
  role?: string;
  /** app | script | cron | assistant | seed */
  source?: string;
  ip?: string;
  userAgent?: string;
  route?: string;
  requestId?: string;
  /**
   * Lets a deliberate bulk operation through the blast-radius guard.
   *
   * Off by default and never set from a request handler — this is for seeds,
   * ports and the retention job, where wiping a whole table is the entire
   * point rather than an accident.
   */
  allowUnscopedWrites?: boolean;
};

const storage = new AsyncLocalStorage<AuditActor>();

/**
 * Attach an actor to everything that happens after this point in the current
 * request.
 *
 * `enterWith` rather than `run` because the caller is a gate that returns —
 * `requireCapability()` checks the session and hands back a context, it does
 * not wrap the rest of the handler in a callback. Rewriting sixty route
 * handlers into callbacks to satisfy `run` would be a large diff whose only
 * effect is stylistic, and every route added afterwards would have to
 * remember the wrapper or silently log nothing.
 */
export function setAuditActor(actor: AuditActor): void {
  storage.enterWith({ source: "app", ...actor });
}

/** For scripts and jobs, which have a clean top-level to wrap. */
export function runWithAuditActor<T>(actor: AuditActor, fn: () => T): T {
  return storage.run({ source: "script", ...actor }, fn);
}

export function getAuditActor(): AuditActor | undefined {
  return storage.getStore();
}

/**
 * Read what can be read about the caller from the request.
 *
 * `x-forwarded-for` is what Vercel puts the client address in; it is a list
 * and the first entry is the client. It is worth stating plainly that this
 * header is only as trustworthy as the proxy in front — behind Vercel it is
 * set by the platform, but nothing here should be treated as proof of origin
 * in a dispute. It is a lead, not evidence.
 */
export function actorFromRequest(request: {
  headers: { get(name: string): string | null };
  url?: string;
}): Pick<AuditActor, "ip" | "userAgent" | "route" | "requestId"> {
  const headers = request.headers;
  const forwarded = headers.get("x-forwarded-for") || "";
  return {
    ip: forwarded.split(",")[0]?.trim() || headers.get("x-real-ip") || undefined,
    userAgent: headers.get("user-agent")?.slice(0, 400) || undefined,
    route: request.url ? safePath(request.url) : undefined,
    requestId: headers.get("x-vercel-id") || headers.get("x-request-id") || undefined,
  };
}

/** Path only. Query strings on this app carry student ids and tokens. */
function safePath(url: string): string | undefined {
  try {
    return new URL(url).pathname;
  } catch {
    return undefined;
  }
}
