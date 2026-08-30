import { guardedPrisma } from "@/lib/prisma";
import { METERS, PLACEHOLDER_RATES_KOBO, type MeterName } from "@/lib/usage/meter";

/**
 * The platform price list — one set of rates, not one per tenant.
 *
 * Stored as a `SchoolSetting` row on the DEFAULT tenant (`DEFAULT_TENANT_SLUG`)
 * so it needs no migration and no new table. An operator edits the six numbers
 * from the console; anything they have not set falls back to the placeholder in
 * meter.ts. `isPlaceholder` on each entry is what the console shows in red
 * until a real, invoice-backed number replaces it.
 *
 * These are the numbers the nightly rollup in usage/record.ts actually bills
 * at. `quote()`/`costKobo()` used elsewhere for rough estimates still read the
 * placeholders — an estimate that is a little stale is fine; a bill that is
 * wrong is not, which is why only the rollup reads this.
 */

export const RATES_KEY = "platform.rates";

const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG || "easyway";

export type RateRow = { meter: MeterName; kobo: number; per: number; isPlaceholder: boolean };

function parseStored(value: unknown): Partial<Record<MeterName, number>> {
  if (!value || typeof value !== "object") return {};
  const out: Partial<Record<MeterName, number>> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k in PLACEHOLDER_RATES_KOBO && typeof v === "number" && Number.isFinite(v) && v >= 0) {
      out[k as MeterName] = Math.round(v);
    }
  }
  return out;
}

const cache: { value: Partial<Record<MeterName, number>>; at: number } = { value: {}, at: 0 };
const TTL_MS = 60_000;

export function forgetRates(): void {
  cache.at = 0;
}

async function storedRates(): Promise<Partial<Record<MeterName, number>>> {
  if (Date.now() - cache.at < TTL_MS) return cache.value;
  const tenant = await guardedPrisma.tenant.findUnique({
    where: { slug: DEFAULT_TENANT_SLUG },
    select: { id: true },
  });
  if (!tenant) {
    cache.value = {};
    cache.at = Date.now();
    return {};
  }
  const row = await guardedPrisma.schoolSetting.findFirst({
    where: { tenantId: tenant.id, key: RATES_KEY },
    select: { value: true },
  });
  cache.value = parseStored(row?.value ?? null);
  cache.at = Date.now();
  return cache.value;
}

/** The kobo rate actually charged for one meter, right now. */
export async function rateKoboFor(meter: MeterName): Promise<number> {
  const stored = await storedRates();
  return stored[meter] ?? PLACEHOLDER_RATES_KOBO[meter];
}

/** The whole table, live values merged over placeholders — for the rollup. */
export async function ratesKobo(): Promise<Record<MeterName, number>> {
  const stored = await storedRates();
  const out = { ...PLACEHOLDER_RATES_KOBO };
  for (const k of Object.keys(out) as MeterName[]) {
    if (stored[k] != null) out[k] = stored[k]!;
  }
  return out;
}

/** The table plus which entries are still placeholders — for the console. */
export async function rateRows(): Promise<RateRow[]> {
  const stored = await storedRates();
  return (Object.keys(PLACEHOLDER_RATES_KOBO) as MeterName[]).map((meter) => ({
    meter,
    kobo: stored[meter] ?? PLACEHOLDER_RATES_KOBO[meter],
    per: METERS[meter].per,
    isPlaceholder: stored[meter] == null,
  }));
}

export async function saveRates(patch: Partial<Record<MeterName, number>>): Promise<void> {
  const tenant = await guardedPrisma.tenant.findUnique({
    where: { slug: DEFAULT_TENANT_SLUG },
    select: { id: true },
  });
  if (!tenant) throw new Error(`No default tenant "${DEFAULT_TENANT_SLUG}" to hold the price list.`);

  const current = await storedRates();
  const next: Partial<Record<MeterName, number>> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in PLACEHOLDER_RATES_KOBO)) continue;
    if (v == null || Number.isNaN(Number(v))) {
      delete next[k as MeterName]; // clearing a value reverts it to the placeholder
    } else if (Number(v) >= 0) {
      next[k as MeterName] = Math.round(Number(v));
    }
  }

  await guardedPrisma.schoolSetting.upsert({
    where: { tenantId_key: { tenantId: tenant.id, key: RATES_KEY } },
    create: { tenantId: tenant.id, key: RATES_KEY, value: next },
    update: { value: next },
  });
  forgetRates();
}
