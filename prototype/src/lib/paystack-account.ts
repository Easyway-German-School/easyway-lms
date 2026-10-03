import { guardedPrisma } from "@/lib/prisma";
import { currentTenantId } from "@/lib/tenant/context";
import { encryptSecret, decryptSecret } from "@/lib/mfa";
import { guardedFetch } from "@/lib/guarded-fetch";

/**
 * WHOSE PAYSTACK ACCOUNT A PAYMENT GOES THROUGH.
 *
 * Until now there was exactly one: `PAYSTACK_SECRET_KEY` in the environment, which
 * is EasyWay's. That is fine for one school and a leak for two — a second
 * business's students would pay into EasyWay's account.
 *
 * A business can now connect its own Paystack account ("Own Paystack account"),
 * and money then settles straight to it. The rule for which key to use is
 * deliberately short, and the third line is the important one:
 *
 *   1. The tenant has connected an account of its own  -> use it.
 *   2. The tenant IS the platform tenant (EasyWay)      -> the environment key,
 *      exactly as before. EasyWay's behaviour does not change.
 *   3. Anything else                                     -> NO ACCOUNT. Checkout
 *      says payments are not set up yet. It must never quietly collect a
 *      stranger's fees into the platform's Paystack.
 *
 * The secret key is stored encrypted (AES-256-GCM, the same box the two-factor
 * secrets use) in the tenant's own `SchoolSetting` row — no schema migration —
 * and is never sent back to a browser after it is saved.
 */

export const PAYSTACK_ACCOUNT_KEY = "payments.paystack";

const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG || "easyway";

export type PaystackAccount = {
  secretKey: string;
  /** "own": the business's connected account. "platform": EasyWay's, from env. */
  source: "own" | "platform";
};

type StoredAccount = {
  secretKeyEnc: string;
  /** Last four characters, so the screen can say which key is connected. */
  last4: string;
  mode: "live" | "test";
  enabled: boolean;
  connectedAt: string;
};

/** A Paystack secret key: `sk_live_...` or `sk_test_...`. Nothing else is accepted. */
const SECRET_KEY = /^sk_(live|test)_[A-Za-z0-9]{16,}$/;

export function parseSecretKey(input: unknown): { ok: true; key: string; mode: "live" | "test" } | { ok: false } {
  const key = String(input ?? "").trim();
  const match = SECRET_KEY.exec(key);
  if (!match) return { ok: false };
  return { ok: true, key, mode: match[1] as "live" | "test" };
}

const CACHE_MS = 30_000;
const accountCache = new Map<string, { value: PaystackAccount | null; at: number }>();
let platformTenantCache: { id: string | null; at: number } | null = null;

export function forgetPaystackAccount(tenantId?: string): void {
  if (tenantId) accountCache.delete(tenantId);
  else accountCache.clear();
}

/** Whether a tenant is the platform's own (EasyWay), the only one that may use the env key. */
export async function isPlatformTenant(tenantId: string): Promise<boolean> {
  if (platformTenantCache && Date.now() - platformTenantCache.at < 60_000) {
    return platformTenantCache.id === tenantId;
  }
  const row = await guardedPrisma.tenant.findUnique({
    where: { slug: DEFAULT_TENANT_SLUG },
    select: { id: true },
  });
  platformTenantCache = { id: row?.id ?? null, at: Date.now() };
  return platformTenantCache.id === tenantId;
}

async function readStored(tenantId: string): Promise<StoredAccount | null> {
  const row = await guardedPrisma.schoolSetting.findFirst({
    where: { tenantId, key: PAYSTACK_ACCOUNT_KEY },
    select: { value: true },
  });
  const v = row?.value as Partial<StoredAccount> | null | undefined;
  if (!v || typeof v !== "object" || typeof v.secretKeyEnc !== "string") return null;
  return {
    secretKeyEnc: v.secretKeyEnc,
    last4: String(v.last4 ?? ""),
    mode: v.mode === "test" ? "test" : "live",
    enabled: v.enabled !== false,
    connectedAt: String(v.connectedAt ?? ""),
  };
}

/**
 * The key to charge and verify with for this tenant, or null when the tenant has
 * no payment account. `tenantId` null means "no tenant context at all" (a script,
 * an unscoped job) and keeps the historical behaviour: the environment key.
 */
export async function paystackAccountFor(tenantId: string | null | undefined): Promise<PaystackAccount | null> {
  const envKey = process.env.PAYSTACK_SECRET_KEY || null;
  if (!tenantId) return envKey ? { secretKey: envKey, source: "platform" } : null;

  const hit = accountCache.get(tenantId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  let value: PaystackAccount | null = null;

  const stored = await readStored(tenantId);
  if (stored?.enabled) {
    const key = decryptSecret(stored.secretKeyEnc);
    if (key) value = { secretKey: key, source: "own" };
    else console.error("[paystack] a stored tenant key could not be decrypted", { tenantId });
  }

  if (!value && envKey && (await isPlatformTenant(tenantId))) {
    value = { secretKey: envKey, source: "platform" };
  }

  accountCache.set(tenantId, { value, at: Date.now() });
  return value;
}

/** For a signed-in or host-resolved request, once the tenant scope is set. */
export async function paystackAccountForCurrentTenant(): Promise<PaystackAccount | null> {
  return paystackAccountFor(currentTenantId());
}

/**
 * Ask Paystack whether a secret key is real. `/bank` needs a valid key and
 * nothing else, so it works for any account regardless of what it has enabled.
 */
export async function checkKeyWithPaystack(secretKey: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const response = await guardedFetch("paystack", "https://api.paystack.co/bank?perPage=1", {
      method: "GET",
      headers: { Authorization: `Bearer ${secretKey}` },
      cache: "no-store",
    });
    if (response.ok) return { ok: true };
    if (response.status === 401) return { ok: false, reason: "Paystack did not accept that key." };
    return { ok: false, reason: "Paystack could not check that key right now. Try again in a minute." };
  } catch {
    return { ok: false, reason: "Could not reach Paystack. Try again in a minute." };
  }
}

export async function saveOwnAccount(
  tenantId: string,
  secretKey: string,
  mode: "live" | "test",
): Promise<void> {
  const value: StoredAccount = {
    secretKeyEnc: encryptSecret(secretKey),
    last4: secretKey.slice(-4),
    mode,
    enabled: true,
    connectedAt: new Date().toISOString(),
  };
  const existing = await guardedPrisma.schoolSetting.findFirst({
    where: { tenantId, key: PAYSTACK_ACCOUNT_KEY },
    select: { id: true },
  });
  if (existing) {
    await guardedPrisma.schoolSetting.update({ where: { id: existing.id }, data: { value } });
  } else {
    await guardedPrisma.schoolSetting.create({ data: { tenantId, key: PAYSTACK_ACCOUNT_KEY, value } });
  }
  forgetPaystackAccount(tenantId);
}

export async function removeOwnAccount(tenantId: string): Promise<void> {
  await guardedPrisma.schoolSetting.deleteMany({ where: { tenantId, key: PAYSTACK_ACCOUNT_KEY } });
  forgetPaystackAccount(tenantId);
}

/** What the settings screen may show. Never the key itself. */
export async function describeOwnAccount(tenantId: string): Promise<
  | { connected: false; usingPlatformAccount: boolean }
  | { connected: true; last4: string; mode: "live" | "test"; connectedAt: string }
> {
  const stored = await readStored(tenantId);
  if (stored?.enabled) {
    return { connected: true, last4: stored.last4, mode: stored.mode, connectedAt: stored.connectedAt };
  }
  return { connected: false, usingPlatformAccount: await isPlatformTenant(tenantId) };
}
