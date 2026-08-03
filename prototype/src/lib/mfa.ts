import crypto from "node:crypto";
import bcryptjs from "bcryptjs";
import { generateSecret, generateURI, verifySync } from "otplib";
import { prisma } from "@/lib/prisma";
import { capabilitiesForUser, SUPER_ONLY_CAPABILITIES } from "@/lib/admin-roles";

/**
 * Two-factor authentication for the accounts that can see everything.
 *
 * The honest case for it: this school stores passport scans, home addresses,
 * dates of birth and payment records for every student on its books. A single
 * admin password is the whole of that. Passwords are reused, phished, typed
 * into the wrong window and shared with a colleague "just for today", and none
 * of those events look like an attack in any log. A second factor is the only
 * control here that survives the password being known.
 *
 * Standard TOTP (RFC 6238), so it works with Google Authenticator, Microsoft
 * Authenticator, Authy, 1Password, Bitwarden — whatever the office already
 * has. Nothing to install and no SMS, which is worth saying plainly: SMS
 * two-factor is defeated by SIM swap, and SIM swap is not exotic in Nigeria.
 */

const ISSUER = "EasyWay Language School";

/**
 * How much clock disagreement to forgive, in SECONDS — not time-steps, which
 * is what the option name suggests and what most examples assume. 30 seconds
 * is exactly one step either side.
 *
 * Both directions, deliberately. A phone that is slightly ahead is as common
 * as one behind, and this project has already lost an afternoon to a machine
 * whose clock was four hours out — every LiveKit token it minted was rejected
 * as future-dated. An asymmetric window would have made that a two-factor
 * lockout instead of a video bug.
 */
const DRIFT_TOLERANCE_SECONDS: [number, number] = [30, 30];

const BACKUP_CODE_COUNT = 10;

/* -------------------------------------------------------------------------- */
/* Secret storage                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The key that protects the TOTP secrets at rest.
 *
 * Derived from a dedicated variable when there is one, and from NEXTAUTH_SECRET
 * otherwise, so that two-factor works the moment it is deployed rather than
 * waiting on a configuration step somebody has to remember. The trade-off is
 * stated rather than hidden: sharing a root secret with session signing means
 * rotating NEXTAUTH_SECRET invalidates every enrolment, and everybody has to
 * enrol again. Setting MFA_ENCRYPTION_KEY avoids that and is the better
 * long-term arrangement.
 */
function encryptionKey(): Buffer {
  const material = process.env.MFA_ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET;
  if (!material) {
    throw new Error(
      "Cannot use two-factor authentication: neither MFA_ENCRYPTION_KEY nor NEXTAUTH_SECRET is set.",
    );
  }
  // A fixed salt, because the same key must come out on every server and every
  // deploy. The salt is not the secret here; `material` is.
  return crypto.scryptSync(material, "easyway-mfa-v1", 32);
}

/** AES-256-GCM, so tampering with a stored secret is detected, not decrypted. */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(stored: string): string | null {
  try {
    const [version, iv, tag, payload] = stored.split(".");
    if (version !== "v1" || !iv || !tag || !payload) return null;
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(payload, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // A key that has changed, or a row somebody edited. Either way this
    // account can no longer produce valid codes and must re-enrol.
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Enrolment                                                                   */
/* -------------------------------------------------------------------------- */

export type EnrolmentOffer = {
  /** The otpauth:// URI, for the QR code. */
  uri: string;
  /** The same secret in text, for anyone who cannot scan. */
  manualKey: string;
};

/**
 * Start enrolment: mint a secret, store it encrypted, hand back the QR.
 *
 * Two-factor is NOT on at this point. `totpEnabledAt` stays null until a code
 * from this secret is confirmed, so somebody who abandons the setup screen
 * halfway is not locked out of their own account by a secret their phone never
 * received.
 */
export async function beginEnrolment(userId: string, email: string): Promise<EnrolmentOffer> {
  const secret = generateSecret();

  await prisma.user.update({
    where: { id: userId },
    data: { totpSecret: encryptSecret(secret), totpEnabledAt: null, totpLastStep: null },
  });

  return {
    uri: generateURI({ secret, label: email, issuer: ISSUER }),
    manualKey: secret,
  };
}

/**
 * Finish enrolment by proving the phone works.
 *
 * Returns the backup codes, once. They are stored hashed, so this is the only
 * moment they can be shown — which is the point, and is why the screen says so
 * loudly.
 */
export async function confirmEnrolment(
  userId: string,
  token: string,
): Promise<{ ok: true; backupCodes: string[] } | { ok: false; error: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpSecret: true },
  });
  if (!user?.totpSecret) return { ok: false, error: "Start the setup again — no pending secret." };

  const secret = decryptSecret(user.totpSecret);
  if (!secret) return { ok: false, error: "Stored secret could not be read. Start the setup again." };

  const result = verifySync({
    token: normalizeToken(token),
    secret,
    epochTolerance: DRIFT_TOLERANCE_SECONDS,
  });
  if (!result.valid) {
    return { ok: false, error: "That code is not right. Check your phone's clock and try the next one." };
  }

  const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, makeBackupCode);
  // Hashed in NORMALIZED form, matching what consumeBackupCode compares. The
  // displayed code carries a hyphen for readability; hashing that literal
  // would mean no code could ever match, because the input side strips it.
  const hashed = await Promise.all(
    backupCodes.map((code) => bcryptjs.hash(normalizeBackupCode(code), 10)),
  );

  await prisma.user.update({
    where: { id: userId },
    data: {
      totpEnabledAt: new Date(),
      totpBackupCodes: hashed,
      totpLastStep: "timeStep" in result ? (result.timeStep as number) : null,
    },
  });

  return { ok: true, backupCodes };
}

/* -------------------------------------------------------------------------- */
/* Verification at sign-in                                                     */
/* -------------------------------------------------------------------------- */

export type MfaCheck =
  | { status: "not_enrolled" }
  | { status: "ok" }
  | { status: "required" }
  | { status: "invalid" };

/**
 * Check a code during sign-in. Accepts a TOTP code or one backup code.
 *
 * Deliberately does not distinguish "wrong code" from "no code" to the caller
 * beyond required/invalid: an attacker holding a stolen password should learn
 * as little as possible about why their guess failed.
 */
export async function verifyLogin(userId: string, token: string | undefined): Promise<MfaCheck> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpSecret: true, totpEnabledAt: true, totpBackupCodes: true, totpLastStep: true },
  });

  if (!user?.totpEnabledAt || !user.totpSecret) return { status: "not_enrolled" };
  if (!token || !token.trim()) return { status: "required" };

  const secret = decryptSecret(user.totpSecret);
  if (!secret) return { status: "invalid" };

  const candidate = normalizeToken(token);

  // A six-digit code is a TOTP; anything else is treated as a backup code.
  if (/^\d{6}$/.test(candidate)) {
    const result = verifySync({
      token: candidate,
      secret,
      epochTolerance: DRIFT_TOLERANCE_SECONDS,
      // Every code strictly once. Without this, a code observed over a
      // shoulder or lifted from a phishing page stays usable for the rest of
      // its window, which is the whole attack two-factor is meant to blunt.
      ...(user.totpLastStep ? { afterTimeStep: user.totpLastStep } : {}),
    });

    if (!result.valid) return { status: "invalid" };

    await prisma.user.update({
      where: { id: userId },
      data: { totpLastStep: "timeStep" in result ? (result.timeStep as number) : null },
    });
    return { status: "ok" };
  }

  return consumeBackupCode(userId, candidate, user.totpBackupCodes);
}

/**
 * Backup codes are single-use: the matching hash is removed on success.
 *
 * Every stored hash is compared even after a match, so the time this takes
 * does not reveal how many codes remain or which one matched.
 */
async function consumeBackupCode(
  userId: string,
  candidate: string,
  stored: unknown,
): Promise<MfaCheck> {
  const hashes = Array.isArray(stored) ? (stored as string[]) : [];
  if (hashes.length === 0) return { status: "invalid" };

  const normalized = normalizeBackupCode(candidate);
  const comparisons = await Promise.all(
    hashes.map((hash) => bcryptjs.compare(normalized, hash).catch(() => false)),
  );
  const index = comparisons.indexOf(true);
  if (index === -1) return { status: "invalid" };

  const remaining = hashes.filter((_, position) => position !== index);
  await prisma.user.update({
    where: { id: userId },
    data: { totpBackupCodes: remaining },
  });
  return { status: "ok" };
}

/* -------------------------------------------------------------------------- */
/* Policy                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Whether this account is one that ought to be carrying a second factor.
 *
 * Scoped to the capabilities that see everything — `payments` and `security` —
 * rather than to every admin. A secretary marking a register is not the
 * account worth defending hardest, and making the whole office set up an
 * authenticator app on day one is how a security control gets resented and
 * then worked around.
 */
export function shouldRequireMfa(adminRole: unknown, overrides: unknown, role: unknown): boolean {
  if (String(role ?? "").toLowerCase() !== "admin") return false;
  const capabilities = capabilitiesForUser(adminRole, overrides);
  return SUPER_ONLY_CAPABILITIES.some((capability) => capabilities.includes(capability));
}

/**
 * Whether an account that ought to have it must actually be turned away.
 *
 * Off unless MFA_ENFORCED is set, and that default is deliberate rather than
 * timid: switching enforcement on before anybody has enrolled locks every
 * super admin out of the system that would let them enrol. The order is
 * enrol, verify, then enforce, and it is written down in docs/SECURITY.md.
 */
export function isEnforced(): boolean {
  return process.env.MFA_ENFORCED === "true";
}

/* -------------------------------------------------------------------------- */

function normalizeToken(token: string): string {
  // Authenticator apps display "123 456"; password managers paste it with the
  // space. Rejecting that would be a support call, not a security measure.
  return token.replace(/[\s-]/g, "").trim();
}

/**
 * The comparable form of a backup code: no separators, upper case.
 *
 * Both the hash and the input go through this, which is the only thing keeping
 * them in step — the code is *shown* as ABCDE-FGHIJ but never stored or
 * compared that way. Uppercasing means a code typed in lower case off a phone
 * keyboard still works.
 */
function normalizeBackupCode(code: string): string {
  return code.replace(/[\s-]/g, "").trim().toUpperCase();
}

function makeBackupCode(): string {
  // Base32-ish alphabet with no 0/O/1/I/L, because these get read off a piece
  // of paper by somebody already having a bad day.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(10);
  const body = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  return `${body.slice(0, 5)}-${body.slice(5, 10)}`;
}
