import { guardedPrisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant/context";

/**
 * Which school a request belongs to when nobody is signed in.
 *
 * Signed-in requests get their tenant from the session. Public ones — the
 * signup form, the branch list that feeds it, certificate verification — have
 * only the hostname they arrived on, so that is what decides.
 *
 * Getting this wrong in the permissive direction would mean a student
 * registering at one school and appearing at another, so there is no "any
 * tenant" fallback: an unrecognised host resolves to the default tenant, and
 * the default tenant is a named, configured thing rather than "whichever row
 * comes first".
 */

const DEFAULT_SLUG = process.env.DEFAULT_TENANT_SLUG || "easyway";

/**
 * Cached for a minute. Every public request would otherwise open with a tenant
 * lookup, and a domain moves between tenants roughly never — but it does move,
 * so this expires rather than being cached for the process lifetime.
 */
const CACHE_MS = 60_000;
const cache = new Map<string, { id: string; at: number }>();

/**
 * Exported rather than kept private: this is the same derivation
 * `api/tenant/branding/route.ts`, the root layout and the exam centre need,
 * and three hand-written copies of "strip the port, lowercase it" is how they
 * end up disagreeing about what a host is.
 *
 * Takes the headers object directly (not a request wrapping one) — `next/
 * headers`'s `headers()` and `NextRequest.headers` are both `Headers`-like
 * with a `.get()`, which is the only overlap the two callers share.
 */
export function hostOf(headers: { get(name: string): string | null }): string {
  const raw = headers.get("x-forwarded-host") || headers.get("host") || "";
  // Strip the port; localhost:3000 and localhost are the same customer.
  return raw.split(":")[0].trim().toLowerCase();
}

export async function resolveTenantId(request: {
  headers: { get(name: string): string | null };
}): Promise<string> {
  const host = hostOf(request.headers);
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.id;

  /**
   * Unguarded by tenant on purpose: this is the lookup that DECIDES the tenant,
   * so it cannot already be scoped to one. Tenant is a global model, so the
   * isolation extension passes it through anyway — this uses the guarded client
   * directly to say so out loud rather than by coincidence.
   */
  const byDomain = host
    ? await guardedPrisma.tenant.findFirst({
        where: { domain: host, status: "active" },
        select: { id: true },
      })
    : null;

  const tenant =
    byDomain ??
    (await guardedPrisma.tenant.findUnique({
      where: { slug: DEFAULT_SLUG },
      select: { id: true },
    }));

  if (!tenant) {
    /**
     * No default tenant means the backfill has not run. Refusing is the only
     * safe answer: the alternative is a signup that lands in no school at all
     * and a student the office cannot see.
     */
    throw new Error(
      `No tenant for host "${host}" and no tenant with slug "${DEFAULT_SLUG}". Run prisma/manual/001_tenant_platform.`,
    );
  }

  cache.set(host, { id: tenant.id, at: Date.now() });
  return tenant.id;
}

/** Resolve, then run the handler scoped to whatever came back. */
export async function withRequestTenant<T>(
  request: { headers: { get(name: string): string | null } },
  fn: (tenantId: string) => Promise<T>,
): Promise<T> {
  const tenantId = await resolveTenantId(request);
  return runWithTenant(tenantId, () => fn(tenantId));
}

/** Drops the cache. Called when a tenant's domain changes. */
export function forgetTenantHosts(): void {
  cache.clear();
}
