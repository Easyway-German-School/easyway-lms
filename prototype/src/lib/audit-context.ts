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

/**
 * Pinned to globalThis, for the same reason the tenant store is.
 *
 * Next bundles a shared module more than once — a route handler and the Prisma
 * client the guard is built from can each end up with their own copy of this
 * file. A module-level `new AsyncLocalStorage()` then gives two stores: the
 * route writes to one and the guard reads the other, and every audit entry
 * comes out anonymous with nothing obviously wrong anywhere. See the same note
 * in src/lib/tenant/context.ts, where it cost an afternoon to find.
 */
const globalForAudit = globalThis as unknown as {
  __easywayAuditStore?: AsyncLocalStorage<AuditActor>;
};

const storage = globalForAudit.__easywayAuditStore ?? new AsyncLocalStorage<AuditActor>();
globalForAudit.__easywayAuditStore = storage;

/**
 * Install an empty actor for this request. MUST be the first statement of a
 * gate, before any `await`.
 *
 * WHY THIS EXISTS AT ALL — and it is the whole reason the audit trail was
 * anonymous. `enterWith` only reaches the CALLER if it runs before the callee's
 * first `await`; after that it attaches to the callee's own continuation and
 * the caller never sees it. Every gate must await the session before it knows
 * who the actor is, so `setAuditActor` was, without exception, running too late
 * — it set a store that died with the gate. The trail recorded 717 actions and
 * named an actor on 23 of them, all 23 from scripts using `runWithAuditActor`,
 * which wraps a callback and therefore never had the problem.
 *
 * The fix is the one the tenant layer already uses, documented at length in
 * src/lib/tenant/context.ts: install an empty MUTABLE holder synchronously —
 * which does reach the caller — and fill it in by reference once the session
 * lookup comes back. The caller holds the same object, so the identity appears
 * in it.
 *
 * Per-request safe because each gate call installs its own holder in its own
 * async context.
 */
export function beginAuditScope(): AuditActor {
  const existing = storage.getStore();

  /**
   * A script's actor is left completely alone. `runWithAuditActor` wraps a
   * whole job in `run`, and a gate called from inside one must not blank the
   * name the job deliberately set.
   *
   * Otherwise JOIN rather than replace: the gates nest (requireCapability calls
   * requireAuthSession), and if each installed a FRESH holder the innermost
   * would be the one filled in while the route held the outermost. That exact
   * mistake is why the tenant version carries the same note.
   */
  if (existing) {
    if (existing.source === "script" || existing.source === "cron" || existing.allowUnscopedWrites) {
      return existing;
    }
    for (const key of Object.keys(existing) as Array<keyof AuditActor>) delete existing[key];
    existing.source = "app";
    return existing;
  }

  const holder: AuditActor = { source: "app" };
  storage.enterWith(holder);
  return holder;
}

/**
 * Attach an actor to everything that happens after this point in the current
 * request.
 *
 * Fills the holder installed by `beginAuditScope` IN PLACE. Assigning a new
 * object here, or calling `enterWith` again, would be invisible to the caller
 * for the reason set out above.
 */
export function setAuditActor(actor: AuditActor): void {
  const holder = storage.getStore();
  if (!holder) {
    // No gate ran first — a script that forgot the wrapper, or a call from
    // outside a request. Best effort; it at least covers anything this same
    // async context goes on to do.
    storage.enterWith({ source: "app", ...actor });
    return;
  }
  Object.assign(holder, { source: holder.source ?? "app", ...actor });
}

/** For scripts and jobs, which have a clean top-level to wrap. */
export function runWithAuditActor<T>(actor: AuditActor, fn: () => T): T {
  return storage.run({ source: "script", ...actor }, fn);
}

export function getAuditActor(): AuditActor | undefined {
  const actor = storage.getStore();
  // An untouched holder is "a request happened", not "somebody did this".
  // Returning it as though it were an actor would put source:"app" on entries
  // with no identity and make the anonymous ones harder, not easier, to spot.
  if (!actor || (!actor.userId && !actor.email && !actor.allowUnscopedWrites)) return undefined;
  return actor;
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
