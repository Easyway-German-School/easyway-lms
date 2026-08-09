import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";

/**
 * Partner API credentials.
 *
 * The format is `ewk_{env}_{prefix}_{secret}` — for example
 * `ewk_test_a1b2c3d4_9f8e...`. Four parts, each earning its place:
 *
 *   ewk       so a key found in a log or a paste is identifiable as ours, and
 *             so secret-scanning tools can be taught one pattern.
 *   env       so `test` and `live` are distinguishable by eye. The single most
 *             common integration accident is running test traffic against
 *             production, and a key that reads `ewk_live_` in a staging config
 *             is visible in review in a way an opaque blob is not.
 *   prefix    the non-secret handle. Stored plainly, unique, safe to log and
 *             to show in a dashboard. It is what makes "which key did this?"
 *             answerable without ever holding the secret.
 *   secret    32 bytes from the CSPRNG. Hashed on arrival, kept nowhere.
 *
 * The alternative — one opaque string, stored hashed — means support cannot
 * identify a key from a log line, so somebody eventually asks a customer to
 * send them a live credential over email. The prefix exists to make that
 * conversation unnecessary.
 */

const KEY_NAMESPACE = "ewk";

export type ApiEnvironment = "test" | "live";

export type GeneratedKey = {
  /** Shown once, at creation. Never retrievable again. */
  plaintext: string;
  prefix: string;
  keyHash: string;
};

export function generateApiKey(environment: ApiEnvironment): GeneratedKey {
  const prefix = crypto.randomBytes(4).toString("hex");
  /**
   * THE SECRET MUST NOT CONTAIN THE DELIMITER.
   *
   * base64url's alphabet is A–Z a–z 0–9 `-` `_` — and that underscore is the
   * character this format splits on. A 43-character secret therefore contained
   * at least one `_` about half the time (1 - (63/64)^43 ≈ 49%), which made
   * `plaintext.split("_")` return five or more parts, which made
   * `resolveApiKey` call the key malformed and reject it.
   *
   * So roughly every other key the school issued was dead on arrival: created
   * fine, stored fine, shown to the partner once — and then refused on every
   * request, with a reason deliberately indistinguishable from "no such key"
   * so that nobody could tell it apart from a typo.
   *
   * Mapping `_` onto `-` costs one bit of alphabet (63 symbols, ~257 bits over
   * 43 characters) and makes the documented four-part shape actually true.
   */
  const secret = crypto.randomBytes(32).toString("base64url").replace(/_/g, "-");
  const plaintext = `${KEY_NAMESPACE}_${environment}_${prefix}_${secret}`;

  return { plaintext, prefix, keyHash: hashApiKey(plaintext) };
}

/**
 * Plain sha256, not bcrypt, and that is deliberate.
 *
 * Password hashing is slow on purpose because passwords are low-entropy and
 * guessable. This secret is 256 random bits — it cannot be brute-forced at any
 * cost, so the slowness would buy nothing and would be paid on every single
 * API request. Fast hashing is the correct choice for a high-entropy secret.
 */
export function hashApiKey(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext).digest("hex");
}

/** Pull the prefix out for logging without treating the rest as anything. */
export function describeApiKey(plaintext: string): string {
  const parts = plaintext.split("_");
  if (parts.length < 4) return "malformed";
  return `${parts[0]}_${parts[1]}_${parts[2]}`;
}

export type ResolvedKey = {
  id: string;
  tenantId: string;
  environment: ApiEnvironment;
  scopes: string[];
  prefix: string;
};

export type KeyFailure =
  | "missing"
  | "malformed"
  | "unknown"
  | "revoked"
  | "expired";

/**
 * Look a key up and say whether it may be used.
 *
 * Compared by hash, so a wrong key is a miss rather than a comparison against
 * anything secret. Every failure returns the same shape and the caller returns
 * the same status for all of them — distinguishing "no such key" from "revoked
 * key" tells an attacker which of their guesses once existed.
 */
export async function resolveApiKey(
  plaintext: string | null | undefined,
): Promise<{ ok: true; key: ResolvedKey } | { ok: false; reason: KeyFailure }> {
  if (!plaintext) return { ok: false, reason: "missing" };

  /**
   * `>= 4`, not `=== 4`, and that is the repair rather than a loosening.
   *
   * Every key issued before the generator stopped emitting underscores (see
   * generateApiKey) has a secret that may split into extra parts. Those keys
   * are perfectly good — the lookup is by hash of the WHOLE plaintext, and
   * nothing below reads `parts[3]` — they were only ever rejected by this
   * shape check. An exact count here would leave every one of them dead with
   * no way for the holder to tell why.
   *
   * The parts that carry meaning are still checked exactly: the namespace
   * below, and the environment and prefix, which are drawn from fixed
   * alphabets and cannot contain a delimiter.
   */
  const parts = plaintext.split("_");
  if (parts.length < 4 || parts[0] !== KEY_NAMESPACE) {
    return { ok: false, reason: "malformed" };
  }

  const row = await prisma.apiKey.findUnique({
    where: { keyHash: hashApiKey(plaintext) },
    select: {
      id: true,
      tenantId: true,
      environment: true,
      scopes: true,
      prefix: true,
      revokedAt: true,
      expiresAt: true,
    },
  });

  if (!row) return { ok: false, reason: "unknown" };
  if (row.revokedAt) return { ok: false, reason: "revoked" };
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }

  /**
   * Recorded without awaiting. "Last used" is useful for spotting a key that
   * has quietly stopped working, or one still live after an integration was
   * decommissioned — but it is not worth adding a write to the latency of
   * every request, and losing one on a crash costs nothing.
   */
  void prisma.apiKey
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return {
    ok: true,
    key: {
      id: row.id,
      tenantId: row.tenantId,
      environment: row.environment === "live" ? "live" : "test",
      scopes: row.scopes ? row.scopes.split(",").map((s) => s.trim()).filter(Boolean) : [],
      prefix: row.prefix,
    },
  };
}

/**
 * Scope check.
 *
 * A key with no scopes has no access rather than total access. This is the
 * same inversion the tenant client makes: for an internal helper "unset means
 * everything" is convenient, and for a credential handed to a third party it
 * is a breach waiting for someone to forget a field.
 */
export function hasScope(key: ResolvedKey, required: string): boolean {
  if (key.scopes.includes("*")) return true;
  if (key.scopes.includes(required)) return true;

  // "students:*" grants "students:read".
  const [resource] = required.split(":");
  return key.scopes.includes(`${resource}:*`);
}
