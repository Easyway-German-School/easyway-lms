import crypto from "node:crypto";
import bcryptjs from "bcryptjs";
import { prisma } from "@/lib/prisma";

/**
 * Forgotten-password handling.
 *
 * This is the first way into an account that does not require already being in
 * it, which makes it the most attackable surface in the product. Four rules
 * shape everything below:
 *
 *   1. The reset link is a credential. Stored hashed, exactly like a password.
 *   2. It works once, and briefly.
 *   3. Asking whether an address has an account must not answer the question.
 *   4. Using it ends the old sessions, or a reset does not evict the person
 *      the user is resetting because of.
 */

/** An hour. Long enough to find the email, short enough that an archived copy stops working. */
const TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * 32 bytes from the CSPRNG, base64url.
 *
 * Not `Math.random`, not a uuid: this value is the entire proof of identity
 * for the request that follows, so it needs to be unguessable in the
 * cryptographic sense rather than merely unique.
 */
function generateToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Issue a reset token for an email address, if it belongs to anybody.
 *
 * Returns null when it does not — and every caller must treat that exactly
 * like success. The endpoint's response cannot differ between "sent" and "no
 * such account" or it becomes a way to test which of a leaked address list are
 * real customers of this school.
 */
export async function createResetToken(
  email: string,
  requestedIp?: string | null,
): Promise<{ token: string; userId: string; name: string | null } | null> {
  const normalized = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: normalized },
    select: { id: true, name: true },
  });

  if (!user) return null;

  /**
   * Any earlier live token for this account is spent first.
   *
   * Otherwise every request adds another working key and they accumulate — a
   * user who clicks "forgot password" five times has five valid links in five
   * emails, four of which they will never think about again. Only the newest
   * should open the door.
   */
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  const token = generateToken();

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      requestedIp: requestedIp ?? null,
    },
  });

  return { token, userId: user.id, name: user.name };
}

export type ConsumeResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid" | "expired" | "used" };

/**
 * Spend a token and set the new password, or explain why not.
 *
 * The whole thing is one transaction. Split apart, a failure between "mark
 * used" and "write password" leaves the user with a dead link and the old
 * password — locked out by the very feature meant to let them back in.
 */
export async function consumeResetToken(
  token: string,
  newPassword: string,
): Promise<ConsumeResult> {
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });

  /**
   * Looked up by hash, so an attacker's guess is compared against stored
   * digests rather than against a secret we hold in memory. There is no
   * timing signal worth chasing here: a miss returns before any user record
   * is touched, and the response is identical either way.
   */
  if (!row) return { ok: false, reason: "invalid" };
  if (row.usedAt) return { ok: false, reason: "used" };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };

  const hashed = await bcryptjs.hash(newPassword, 10);

  await prisma.$transaction([
    prisma.passwordResetToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: row.userId },
      data: {
        password: hashed,
        /**
         * An account claimed by whoever holds the mailbox is a claimed
         * account. Leaving this false would let the original invite link keep
         * working after the password had been changed by somebody else.
         */
        passwordClaimed: true,
      },
    }),
  ]);

  return { ok: true, userId: row.userId };
}

/**
 * When this account's password was last reset, or null if never.
 *
 * Read by the session callback to evict tokens minted before the change. The
 * table is small — tokens expire and are pruned — and the lookup is indexed on
 * (userId, usedAt).
 */
export async function lastPasswordResetAt(userId: string): Promise<Date | null> {
  const row = await prisma.passwordResetToken.findFirst({
    where: { userId, usedAt: { not: null } },
    orderBy: { usedAt: "desc" },
    select: { usedAt: true },
  });
  return row?.usedAt ?? null;
}

/**
 * Housekeeping for the daily cron.
 *
 * Expired tokens are useless but they are not inert: they keep the table
 * growing and they keep a record of who asked for a reset and from where,
 * which is worth holding briefly for abuse investigation and not worth
 * holding forever.
 */
export async function pruneExpiredResetTokens(olderThanDays = 30): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const { count } = await prisma.passwordResetToken.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });
  return count;
}

/**
 * Re-exported so server code has one obvious import for everything about
 * resetting a password. The rule itself lives in password-rules.ts, which has
 * no server dependencies, because the browser form needs it too.
 */
export { passwordProblem } from "@/lib/password-rules";
