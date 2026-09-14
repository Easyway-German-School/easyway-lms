import { prisma } from "@/lib/prisma";
import { runWithTenant, runUnscoped } from "@/lib/tenant/context";

/**
 * Recording a staff sign-in, so the trail has something to compare against.
 *
 * The audit schema has always had `action: "login"` in its vocabulary and an
 * `ip` column with a comment saying a sign-in from an unexpected place is the
 * earliest visible sign of a stolen password — but nothing ever wrote the row.
 * This does, for admin and tutor accounts only. Students sign in every day and
 * a student-account takeover is a far smaller event; widening this is one line
 * in the caller (`auth.ts`), not a rewrite here.
 *
 * Everything about this is best-effort. A sign-in must never fail, or even
 * slow down, because the trail write had a bad moment — so the whole body is
 * wrapped and a failure is swallowed after a log line.
 */

/** The audit `action` these rows carry. Shared with sign-in-anomaly.ts. */
export const SIGN_IN_AUDIT_ACTION = "login";

/** Roles whose sign-ins are worth recording. */
const WATCHED_ROLES = new Set(["admin", "lecturer"]);

export type StaffSignIn = {
  userId: string;
  email: string | null;
  /** Normalised, lower-case: "admin" | "lecturer" | … */
  role: string;
  tenantId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

export async function recordStaffSignIn(input: StaffSignIn): Promise<void> {
  try {
    if (!WATCHED_ROLES.has(input.role)) return;

    const write = () =>
      prisma.auditLog.create({
        data: {
          action: SIGN_IN_AUDIT_ACTION,
          model: "User",
          recordId: input.userId,
          actorId: input.userId,
          actorEmail: input.email ?? undefined,
          actorRole: input.role,
          source: "app",
          ip: input.ip ?? undefined,
          userAgent: input.userAgent?.slice(0, 400) ?? undefined,
          route: "/api/auth/callback/credentials",
          severity: "info",
          summary: `Signed in as ${input.role}`,
          tenantId: input.tenantId ?? undefined,
        },
      });

    // Sign-in runs in the gap where a tenant is being established rather than
    // known. If we have it, scope the write to it so it reads back on the
    // (tenant-scoped) security page; if not, say so explicitly.
    await (input.tenantId
      ? runWithTenant(input.tenantId, write)
      : runUnscoped("recording a sign-in before the user's tenant is in hand", write));
  } catch (error) {
    console.error("recordStaffSignIn failed (sign-in itself is unaffected):", error);
  }
}
