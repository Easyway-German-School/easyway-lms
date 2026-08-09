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

/**
 * Pinned to globalThis, for the same reason the Prisma client is.
 *
 * Next bundles a shared module more than once — a route handler and the client
 * the extension is built from can each end up with their own copy of this file.
 * A module-level `new AsyncLocalStorage()` then gives two stores: the route
 * writes to one and the isolation extension reads the other, which presents as
 * every query failing "no tenant in context" no matter how carefully the scope
 * was set. It cost an afternoon to find, and the symptom looked like an
 * AsyncLocalStorage problem rather than a bundling one.
 *
 * One store per process, keyed by a name nothing else will pick.
 */
const globalForTenant = globalThis as unknown as {
  __easywayTenantStore?: AsyncLocalStorage<TenantScope>;
};

const storage =
  globalForTenant.__easywayTenantStore ?? new AsyncLocalStorage<TenantScope>();
globalForTenant.__easywayTenantStore = storage;

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
export function runWithTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  if (!tenantId) {
    throw new Error("runWithTenant() requires a tenant id. Use runUnscoped(reason, fn) instead.");
  }
  // See the note in runUnscoped: the await belongs inside the callback.
  return storage.run({ kind: "tenant", tenantId }, async () => await fn());
}

/**
 * The deliberate way out, for work that legitimately spans every tenant.
 *
 * The reason is required and logged. Grepping for this function is the fastest
 * audit of where isolation is bypassed on purpose, and a bypass nobody can
 * explain is a bypass that should not be there.
 */
export function runUnscoped<T>(reason: string, fn: () => Promise<T>): Promise<T> {
  if (!reason || reason.trim().length < 10) {
    throw new Error(
      "runUnscoped() requires a reason describing why this operation spans every tenant.",
    );
  }
  /**
   * AWAIT INSIDE, not outside.
   *
   * A Prisma call returns a lazy promise — nothing runs until something awaits
   * it. Handing that promise straight back means the caller awaits it after
   * `run()` has already returned, so the query executes with no scope in
   * context: the isolation appears broken while every line of it looks right.
   * Awaiting here keeps execution inside the scope, whatever the caller does
   * with the result.
   */
  return storage.run({ kind: "unscoped", reason }, async () => await fn());
}

/**
 * The non-callback form, for a gate that has already decided and returns.
 *
 * NOT SAFE AS THE FIRST STATEMENT OF A ROUTE HANDLER. `enterWith` attaches the
 * scope to the async resource that is currently running, and at the top of a
 * handler that resource still belongs to the caller — the work below it runs
 * somewhere the scope was never set, and the first query throws. It becomes
 * reliable only once the handler has awaited something of its own.
 *
 * That is too subtle to depend on, so route handlers use `withUnscoped()`
 * below. This stays for gates that are already past an await, which is every
 * gate that has just looked something up.
 */
export function enterUnscoped(reason: string): void {
  if (!reason || reason.trim().length < 10) {
    throw new Error("enterUnscoped() requires a reason.");
  }
  storage.enterWith({ kind: "unscoped", reason });
}

/**
 * Wrap a route handler so everything it does runs unscoped.
 *
 *   export const POST = withUnscoped("why", async (request) => { ... });
 *
 * The wrapper form rather than a call at the top of the body, for the reason
 * above. It also reads as what it is at the export, which is where somebody
 * reviewing the file looks first.
 */
export function withUnscoped<A extends unknown[], R>(
  reason: string,
  handler: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return (...args: A) => runUnscoped(reason, async () => await handler(...args));
}

/**
 * For an endpoint with two callers who need different reach.
 *
 * The periodic jobs are the case: the scheduler runs them for every school on
 * the platform, while an admin pressing "run now" should reach their own school
 * and no further. Same route, same work, two scopes — decided by who knocked.
 */
export function maybeUnscoped<T>(
  unscoped: boolean,
  reason: string,
  fn: () => Promise<T>,
): Promise<T> {
  return unscoped ? runUnscoped(reason, fn) : fn();
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
