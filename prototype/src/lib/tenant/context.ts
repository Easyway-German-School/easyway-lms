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

/**
 * MUTABLE, and that is the whole mechanism.
 *
 * `enterWith` only reaches the caller if it runs before the callee's first
 * `await` — after that it attaches to the callee's own continuation and the
 * caller never sees it. Measured, not assumed:
 *
 *   gate awaits first, then enterWith  →  caller sees undefined
 *   gate enterWith with no await       →  caller sees the value
 *
 * Every gate here has to await something (the session, the key lookup) before
 * it knows the tenant, so pushing the finished value up is impossible. So the
 * gate installs an empty holder SYNCHRONOUSLY — which does reach the caller —
 * and fills it in by reference once the answer arrives. The caller is holding
 * the same object, so it sees the tenant appear.
 *
 * This is per-request safe because each gate call installs its own holder in
 * its own async context; five concurrent requests get five holders. Verified
 * under concurrency rather than reasoned about.
 */
export type TenantScope = {
  /**
   * tenant   — a signed-in request, or one authenticated by an API key.
   * unscoped — deliberately spanning every tenant: the nightly cron, the backup
   *            runner, operator tooling. Carries a written reason so that "what
   *            ran across all tenants last Tuesday, and why" is answerable.
   * none     — explicitly nobody. What a holder starts as, and what a request
   *            with no session settles at. Distinct from "no scope at all"
   *            because it is a positive statement.
   */
  kind: "tenant" | "unscoped" | "none";
  tenantId?: string;
  reason?: string;
};

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
 * Install an empty scope for this request. MUST be the first statement of a
 * gate, before any `await`.
 *
 * This is the half that reaches the caller. Everything after it — the session
 * lookup, the key lookup — fills the holder in by reference.
 *
 * Starting at `none` rather than leaving it unset is what stops one request
 * inheriting another's scope: a gate that installed nothing on the failure path
 * would leave whatever was there, and whatever was there belongs to somebody
 * else.
 */
export function beginRequestScope(): TenantScope {
  const existing = storage.getStore();

  /**
   * JOIN an existing holder rather than replacing it.
   *
   * The gates nest: requireCapability calls requireAuthSession calls
   * getServerAuthSession, and each of them begins the scope because each can
   * also be the outermost one. If every call installed a FRESH holder, the
   * innermost would be the one that got filled in and the route — holding the
   * outermost — would still see nothing. That is exactly what happened: the v1
   * routes worked, because their gate is one level deep, and every admin route
   * returned 500.
   *
   * An `unscoped` holder is left completely alone. A deliberate cross-tenant
   * job that happens to call a gate must not have its exemption quietly
   * downgraded.
   */
  if (existing) {
    if (existing.kind === "unscoped") return existing;
    existing.kind = "none";
    existing.tenantId = undefined;
    existing.reason = undefined;
    return existing;
  }

  const holder: TenantScope = { kind: "none" };
  storage.enterWith(holder);
  return holder;
}

/**
 * Fill in the scope once the tenant is known.
 *
 * Mutates the holder a gate already installed. If there is none — a page or a
 * script calling this directly — it installs one, which works there because
 * such a caller is the top of its own context.
 *
 * Called unconditionally by the auth seam, including with `null`, so that every
 * request states its scope rather than inheriting one.
 */
export function setTenantScope(tenantId: string | null | undefined): void {
  const holder = storage.getStore();
  const next: TenantScope = tenantId
    ? { kind: "tenant", tenantId }
    : { kind: "none" };

  if (holder) {
    holder.kind = next.kind;
    holder.tenantId = next.tenantId;
    holder.reason = undefined;
    return;
  }
  storage.enterWith(next);
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
 * Mutates the holder if a gate installed one, exactly like setTenantScope, so
 * it reaches the caller for the same reason. Without a holder it installs one,
 * which only works when called before the caller's first await — so a route
 * handler should use `withUnscoped()` below rather than calling this on its
 * first line.
 */
export function enterUnscoped(reason: string): void {
  if (!reason || reason.trim().length < 10) {
    throw new Error("enterUnscoped() requires a reason.");
  }
  const holder = storage.getStore();
  if (holder) {
    holder.kind = "unscoped";
    holder.reason = reason;
    holder.tenantId = undefined;
    return;
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
  return scope?.kind === "tenant" ? (scope.tenantId ?? null) : null;
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
