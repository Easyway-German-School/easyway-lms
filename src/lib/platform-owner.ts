import crypto from "node:crypto";
import bcryptjs from "bcryptjs";
import { guardedPrisma } from "@/lib/prisma";
import { createResetToken } from "@/lib/password-reset";
import { queueEmail } from "@/lib/email-queue";
import { tenantOwnerInviteHtml } from "@/lib/platform-owner-email";

/**
 * The first human in a new school.
 *
 * Onboarding a tenant creates the container — the tenant row, its credit
 * ledger, its feature flags — and nothing else. Until this, that left a school
 * that literally nobody could sign into: an operator runs the PLATFORM, not any
 * one school, so `/admin/staff` (which creates users in the caller's own
 * tenant) is no help here. This is the missing step: an operator names the
 * school's owner, and that person gets a "set your password" link.
 *
 * The account is a full `super` admin scoped to the new tenant. From their
 * first sign-in they do everything else themselves — more admins, branches,
 * tutors, students — from the ordinary admin portal on their own domain.
 */

export type TenantOwner = {
  id: string;
  name: string | null;
  email: string;
  createdAt: string;
  /** false while the invite link is still the only way in. */
  passwordClaimed: boolean;
};

export async function listTenantOwners(tenantId: string): Promise<TenantOwner[]> {
  const rows = await guardedPrisma.user.findMany({
    where: { tenantId, role: "ADMIN", adminRole: "super", deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, createdAt: true, passwordClaimed: true },
  });
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

export type CreateOwnerResult =
  | { ok: true; owner: TenantOwner; setupUrl: string }
  | { ok: false; error: string };

export async function createTenantOwner(
  tenantId: string,
  input: { name: string; email: string },
): Promise<CreateOwnerResult> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();

  if (!name) return { ok: false, error: "A name is required." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: "That isn't a valid email address." };
  }

  const tenant = await guardedPrisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, brandName: true },
  });
  if (!tenant) return { ok: false, error: "No such school." };

  // Email is globally unique. A person who already has an account anywhere on
  // the platform cannot be made the owner of a second school from here — that
  // would be a cross-tenant identity, which the isolation model does not allow.
  const clash = await guardedPrisma.user.findUnique({ where: { email }, select: { id: true } });
  if (clash) {
    return {
      ok: false,
      error: `${email} already has an account on the platform. Use a different address for this school's owner.`,
    };
  }

  // A password nobody knows. The real one is set through the link below; until
  // then `passwordClaimed: false` is what keeps the invite valid and the
  // account unusable by anyone who guesses the address.
  const unusable = await bcryptjs.hash(crypto.randomBytes(24).toString("base64url"), 10);

  const user = await guardedPrisma.user.create({
    data: {
      email,
      name,
      role: "ADMIN",
      adminRole: "super",
      tenantId,
      password: unusable,
      passwordClaimed: false,
    },
    select: { id: true, name: true, email: true, createdAt: true, passwordClaimed: true },
  });

  // Reuses the forgotten-password machinery: same one-time, one-hour, hashed
  // token, same `/auth/reset` page. "Set your first password" and "reset a
  // forgotten one" are the same operation from the token's point of view.
  const issued = await createResetToken(email);
  const base = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "").replace(/\/$/, "");
  const setupUrl = issued ? `${base}/auth/reset?token=${issued.token}` : `${base}/auth/forgot`;

  const schoolName = tenant.brandName?.trim() || tenant.name;
  await queueEmail({
    to: email,
    subject: `You've been set up as the owner of ${schoolName}`,
    html: tenantOwnerInviteHtml({ name, schoolName, setupUrl }),
    type: "platform_owner_invite",
    identity: "support",
  });

  return {
    ok: true,
    owner: { ...user, createdAt: user.createdAt.toISOString() },
    setupUrl,
  };
}
