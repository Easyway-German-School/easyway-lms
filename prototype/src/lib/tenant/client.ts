import { guardedPrisma, prisma } from "@/lib/prisma";
import { createTenantExtension, TenantIsolationError } from "@/lib/tenant/extension";

export { TenantIsolationError };

/**
 * Explicitly scoped clients, for callers that hold a tenant id rather than a
 * request.
 *
 * Most code no longer needs these. The isolation extension is applied to the
 * default `prisma` export and reads the tenant from async context, so a route
 * that has passed through the auth seam is already scoped — see
 * src/lib/tenant/context.ts. These remain for scripts, jobs and tests, which
 * have a tenant in hand and no request to carry it.
 */

/**
 * `tenantId` is required and non-nullable on purpose. The original helper,
 * `tenantWhere()`, returned `{}` when it had no tenant — meaning "no filter",
 * meaning every row. For an internal admin tool that default was merely
 * convenient; for a platform it is precisely backwards. Absence of a tenant
 * must mean deny, never mean all, so there is no way to spell "no tenant" here
 * short of calling `unscopedClient()` and explaining yourself.
 */
export function tenantClient(tenantId: string) {
  if (!tenantId || typeof tenantId !== "string") {
    throw new TenantIsolationError(
      "tenantClient() requires a tenant id. If this call genuinely spans tenants, use unscopedClient(reason).",
    );
  }

  /**
   * Built from the guarded client rather than the default export, which
   * already carries the context-driven copy of this extension. Applying it
   * twice would filter twice — harmless today, but it would also mean two
   * places deciding what "no tenant" means.
   */
  return guardedPrisma.$extends(createTenantExtension(() => ({ kind: "tenant", tenantId })));
}

/**
 * The deliberate way out, for the small number of jobs that legitimately span
 * every tenant: the nightly cron, the backup runner, operator tooling.
 *
 * It takes a written reason and logs it. That is not ceremony — an unscoped
 * client is the one object in this codebase that can read every school's data
 * at once, and the log is what lets somebody later answer "what ran across all
 * tenants last Tuesday, and why". Grepping for this function is also the
 * fastest audit of where isolation is bypassed on purpose.
 *
 * Prefer `runUnscoped(reason, fn)` from context.ts where the bypass covers a
 * block of work rather than a single client: it scopes the exemption to that
 * block instead of handing out an object that can outlive it.
 */
export function unscopedClient(reason: string) {
  if (!reason || reason.trim().length < 10) {
    throw new TenantIsolationError(
      "unscopedClient() requires a reason describing why this operation spans every tenant.",
    );
  }
  console.info(`[tenant] unscoped access: ${reason}`);
  return guardedPrisma;
}

/** Re-exported so callers need only one import. */
export { prisma };
