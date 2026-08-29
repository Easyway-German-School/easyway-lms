import { guardedPrisma } from "@/lib/prisma";
import { currentTenantId } from "@/lib/tenant/context";
import { DEFAULT_FEATURES, FEATURES_KEY, parseFeatures, type TenantFeatures } from "@/lib/tenant/features";

/**
 * THE DATABASE HALF, KEPT SEPARATE FROM THE PURE HALF ON PURPOSE.
 *
 * See the note at the top of branding-server.ts — the same trap applies here.
 * `admin/platform/page.tsx` is a "use client" component that needs the
 * `TenantFeatures` type and `DEFAULT_FEATURES` to render the toggle UI;
 * anything importable from it must not reach `@/lib/prisma`.
 */

const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG || "easyway";

/**
 * Resolved features per tenant, cached briefly — same idiom as
 * `brandingForHost`. A tenant's feature set changes only when an operator
 * saves the console, not on every page load, but it should still take effect
 * within the minute rather than after a redeploy.
 */
const cache = new Map<string, { value: TenantFeatures; at: number }>();
const TTL_MS = 60_000;

export function forgetFeatures(): void {
  cache.clear();
}

/**
 * Uses `guardedPrisma` rather than the tenant-scoped default export: this has
 * to work both from inside a tenant's own request (a student loading the exam
 * centre) and from the platform console, which runs unscoped by design. There
 * is no cross-tenant read possible either way — the caller already decided
 * whose `tenantId` to ask for.
 */
export async function featuresFor(tenantId: string): Promise<TenantFeatures> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const row = await guardedPrisma.schoolSetting.findFirst({
    where: { tenantId, key: FEATURES_KEY },
    select: { value: true },
  });

  const value = parseFeatures(row?.value ?? null);
  cache.set(tenantId, { value, at: Date.now() });
  return value;
}

/** For a signed-in request, once `setTenantScope` has already run. */
export async function featuresForCurrentTenant(): Promise<TenantFeatures> {
  const tenantId = currentTenantId();
  if (!tenantId) return DEFAULT_FEATURES;
  return featuresFor(tenantId);
}

/**
 * For a pre-auth server component that only has a hostname — the same shape
 * as `brandingForHost`, and deliberately its own small lookup rather than a
 * shared helper: it needs only the tenant id, `brandingForHost` needs three
 * public columns, and the two have no reason to stay in lockstep.
 */
export async function featuresForHost(host: string): Promise<TenantFeatures> {
  const key = host.toLowerCase();

  const byDomain = await guardedPrisma.tenant.findFirst({
    where: { domain: key, status: "active" },
    select: { id: true },
  });

  const tenant =
    byDomain ??
    (await guardedPrisma.tenant.findUnique({
      where: { slug: DEFAULT_TENANT_SLUG },
      select: { id: true },
    }));

  if (!tenant) return DEFAULT_FEATURES;
  return featuresFor(tenant.id);
}
