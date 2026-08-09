import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Whose data the current request is allowed to touch.
 *
 * The isolation extension needs a tenant id at the moment a query runs, and the
 * only place that knows it — the route handler, holding the session — is
 * nowhere near the Prisma call five modules deep. This is the same problem
 * src/lib/audit-context.ts solves, solved the same way, for the same reason:
 * threading a tenant argument through every function in between would touch
 * most of the codebase and would be forgotten by the next route somebody adds.
 *
 * The difference is what happens when it is missing. An unknown audit actor is
 * a gap in a log. An unknown tenant is one school reading another school's
 * students, so this one fails closed: a tenant-owned query with no scope in
 * context throws instead of returning everything.
 */

export type TenantScope =
  /** A signed-in request, or one authenticated by an API key. */
  | { kind: "tenant"; tenantId: string }
  /**
   * Deliberately spanning every tenant: the nightly cron, the backup runner,
   * operator tooling, migrations. Carries a written reason so that "what ran
   * across all tenants last Tuesday, and why" is an answerable question.
   */
  | { kind: "unscoped"; reason: string }
  /**
   * Explicitly nobody. Set by the auth seam when a request has no session, or
   * has one whose user carries no tenant. Distinct from "no scope at all"
   * because it is a positive statement — it overwrites whatever was there,
   * which is what stops a scope leaking from one request into the next.
   */
  | { kind: "none" };

const storage = new AsyncLocalStorage<TenantScope>();

/**
 * `enterWith` rather than `run`, for the reason given in audit-context.ts: the
 * caller is a gate that returns rather than a wrapper that takes a callback,
 * and rewriting every route handler into a callback would be a large diff whose
 * only effect is stylistic.
 *
 * It is called unconditionally by the auth seam — including with `null` — so
 * that every request states its scope rather than inheriting one. A gate that
 * only sets the scope on success would leave the previous value in place on
 * failure, and the previous value belongs to somebody else.
 */
export function setTenantScope(tenantId: string | null | undefined): void {
  storage.enterWith(tenantId ? { kind: "tenant", tenantId } : { kind: "none" });
}

/** For scripts, jobs and tests, which have a clean top-level to wrap. */
export function runWithTenant<T>(tenantId: string, fn: () => T): T {
  if (!tenantId) {
    throw new Error("runWithTenant() requires a tenant id. Use runUnscoped(reason, fn) instead.");
  }
  return storage.run({ kind: "tenant", tenantId }, fn);
}

/**
 * The deliberate way out, for work that legitimately spans every tenant.
 *
 * The reason is required and logged. Grepping for this function is the fastest
 * audit of where isolation is bypassed on purpose, and a bypass nobody can
 * explain is a bypass that should not be there.
 */
export function runUnscoped<T>(reason: string, fn: () => T): T {
  if (!reason || reason.trim().length < 10) {
    throw new Error(
      "runUnscoped() requires a reason describing why this operation spans every tenant.",
    );
  }
  return storage.run({ kind: "unscoped", reason }, fn);
}

/** The non-callback form, for a gate that has already decided and returns. */
export function enterUnscoped(reason: string): void {
  if (!reason || reason.trim().length < 10) {
    throw new Error("enterUnscoped() requires a reason.");
  }
  storage.enterWith({ kind: "unscoped", reason });
}

export function currentScope(): TenantScope | undefined {
  return storage.getStore();
}

export function currentTenantId(): string | null {
  const scope = storage.getStore();
  return scope?.kind === "tenant" ? scope.tenantId : null;
}

/**
 * `strict` refuses an unscoped query on a tenant-owned table. `warn` lets it
 * through and logs it.
 *
 * Strict is the default because fail-open is the failure this whole layer
 * exists to prevent, and a setting whose safe value is not the default is a
 * setting that will be wrong somewhere. `warn` exists as an environment
 * variable rather than a code change so that a path nobody anticipated can be
 * unblocked in production in the time it takes to save a Vercel setting —
 * which is the difference between a bad afternoon and an outage.
 */
export function isolationMode(): "strict" | "warn" {
  return process.env.TENANT_ISOLATION === "warn" ? "warn" : "strict";
}
