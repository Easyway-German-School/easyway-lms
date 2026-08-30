import { guardedPrisma } from "@/lib/prisma";

/**
 * Per-tenant billing enforcement, stored in `SchoolSetting` (JSON, no
 * migration) rather than as columns on `TenantCredit`.
 *
 * The default is OFF for every tenant. A negative balance on its own does
 * nothing — it is only ever a warning — until an operator deliberately turns
 * enforcement on for that school. This is what keeps a bookkeeping slip, or
 * EasyWay's own running trial balance, from cutting a live portal off.
 *
 * When enforcement is on, `usage/guard.ts` refuses metered work once
 * `balanceKobo + graceKobo` goes below zero. `graceKobo` here is an extra
 * allowance layered on top of whatever `TenantCredit.graceKobo` already holds.
 */

export const BILLING_KEY = "platform.billing";

export type BillingSettings = {
  /** When true, a spent-through balance actually blocks metered work. */
  enforce: boolean;
  /** Extra kobo of headroom past zero before blocking. String — it's money. */
  graceKobo: string;
};

export const DEFAULT_BILLING: BillingSettings = { enforce: false, graceKobo: "0" };

function parse(value: unknown): BillingSettings {
  if (!value || typeof value !== "object") return DEFAULT_BILLING;
  const v = value as Record<string, unknown>;
  const graceRaw = v.graceKobo;
  let graceKobo = "0";
  try {
    if (typeof graceRaw === "string" || typeof graceRaw === "number") {
      graceKobo = BigInt(graceRaw).toString();
    }
  } catch {
    graceKobo = "0";
  }
  return { enforce: v.enforce === true, graceKobo };
}

const cache = new Map<string, { value: BillingSettings; at: number }>();
const TTL_MS = 30_000;

export function forgetBillingSettings(tenantId?: string): void {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

export async function billingSettingsFor(tenantId: string): Promise<BillingSettings> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const row = await guardedPrisma.schoolSetting.findFirst({
    where: { tenantId, key: BILLING_KEY },
    select: { value: true },
  });
  const value = parse(row?.value ?? null);
  cache.set(tenantId, { value, at: Date.now() });
  return value;
}

export async function saveBillingSettings(
  tenantId: string,
  patch: Partial<BillingSettings>,
): Promise<BillingSettings> {
  const current = await billingSettingsFor(tenantId);
  const next: BillingSettings = {
    enforce: patch.enforce ?? current.enforce,
    graceKobo:
      patch.graceKobo !== undefined
        ? (() => {
            try {
              return BigInt(patch.graceKobo).toString();
            } catch {
              return current.graceKobo;
            }
          })()
        : current.graceKobo,
  };

  await guardedPrisma.schoolSetting.upsert({
    where: { tenantId_key: { tenantId, key: BILLING_KEY } },
    create: { tenantId, key: BILLING_KEY, value: next },
    update: { value: next },
  });

  forgetBillingSettings(tenantId);
  return next;
}
