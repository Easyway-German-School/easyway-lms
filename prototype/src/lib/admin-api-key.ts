import crypto from "node:crypto";
import { guardedPrisma } from "@/lib/prisma";
import { CAPABILITIES, type Capability } from "@/lib/admin-roles";

/**
 * Self-issued credentials for calling /api/admin/* without a browser session.
 *
 * Deliberately a separate namespace (`eak_`) from ApiKey's `ewk_` partner
 * keys in src/lib/api/keys.ts — that table lets a third party act as a scoped
 * slice of ONE tenant; this one lets the admin who created it act as THEMSELF,
 * narrowed to whichever capabilities the key was issued with. Different
 * threat model, different table, same hash-and-prefix shape.
 */

const KEY_NAMESPACE = "eak";

export type GeneratedAdminApiKey = {
  /** Shown once, at creation. Never retrievable again. */
  plaintext: string;
  prefix: string;
  tokenHash: string;
};

export function generateAdminApiKey(): GeneratedAdminApiKey {
  const prefix = crypto.randomBytes(4).toString("hex");
  // See the long comment on the twin function in src/lib/api/keys.ts: mapping
  // `_` out of the secret keeps `plaintext.split("_")` at exactly three parts.
  const secret = crypto.randomBytes(32).toString("base64url").replace(/_/g, "-");
  const plaintext = `${KEY_NAMESPACE}_${prefix}_${secret}`;
  return { plaintext, prefix, tokenHash: hashAdminApiKey(plaintext) };
}

export function hashAdminApiKey(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext).digest("hex");
}

export type ResolvedAdminApiKey = {
  id: string;
  userId: string;
  capabilities: Capability[];
};

/**
 * Look a key up and say whether it may be used, without saying why not — the
 * caller returns one 401 for missing, malformed, unknown, revoked and expired
 * alike, same reasoning as resolveApiKey() in src/lib/api/keys.ts.
 *
 * Runs on `guardedPrisma`, not the tenant-scoped `prisma` — deliberately, and
 * for the identical reason resolveApiKey() does: finding the key is how the
 * caller's tenant gets identified in the first place, so scoping this one
 * query to a tenant would require already knowing the answer. It is safe
 * because the lookup key is a 256-bit secret the caller has already proved
 * they hold.
 */
export async function resolveAdminApiKey(
  plaintext: string | null | undefined,
): Promise<ResolvedAdminApiKey | null> {
  if (!plaintext || !plaintext.startsWith(`${KEY_NAMESPACE}_`)) return null;

  const row = await guardedPrisma.adminApiKey.findUnique({
    where: { tokenHash: hashAdminApiKey(plaintext) },
    select: { id: true, userId: true, capabilities: true, revokedAt: true, expiresAt: true },
  });

  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;

  // Fire-and-forget, same call as resolveApiKey() — not worth the latency on
  // every request, and losing one on a crash costs nothing.
  void guardedPrisma.adminApiKey
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  const capabilities = row.capabilities
    .split(",")
    .map((c) => c.trim())
    .filter((c): c is Capability => (CAPABILITIES as readonly string[]).includes(c));

  return { id: row.id, userId: row.userId, capabilities };
}
