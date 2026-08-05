import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveAdmin } from "@/lib/admin-roles";
import { shouldRequireMfa, isEnforced, verifyLogin } from "@/lib/mfa";
import { writeAudit } from "@/lib/prisma-guard";
import { unguardedPrisma } from "@/lib/prisma";

/**
 * Everything an admin does to their OWN second factor.
 *
 * Gated on being an admin rather than on the `security` capability, because
 * enrolling is not a privileged act — it is the opposite, and requiring the
 * highest permission in the system in order to protect your account would
 * mean only one person could ever do it.
 *
 * Nobody can turn two-factor on or off for anybody else through here. An admin
 * who has genuinely lost both their phone and their backup codes is a recovery
 * procedure with a human in it, written up in docs/SECURITY.md, not a button.
 */

async function currentAdmin() {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null;
  return resolveAdmin(session?.user?.id);
}

/** Is two-factor on for me, and does my role call for it? */
export async function GET() {
  const admin = await currentAdmin();
  if (!admin) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const user = await prisma.user.findUnique({
    where: { id: admin.userId },
    select: {
      totpEnabledAt: true,
      totpBackupCodes: true,
      adminRole: true,
      adminCapabilities: true,
      role: true,
    },
  });

  const codes = Array.isArray(user?.totpBackupCodes) ? user!.totpBackupCodes.length : 0;

  return NextResponse.json({
    enabled: Boolean(user?.totpEnabledAt),
    enabledAt: user?.totpEnabledAt ?? null,
    backupCodesRemaining: codes,
    expectedForThisRole: shouldRequireMfa(user?.adminRole, user?.adminCapabilities, user?.role),
    enforced: isEnforced(),
  });
}

/**
 * Turn it off. Requires a current code, not just a session.
 *
 * A live session is exactly what an attacker has after stealing a laptop that
 * is still logged in, and letting that session quietly remove the second
 * factor would make the whole thing decorative.
 */
export async function DELETE(request: Request) {
  const admin = await currentAdmin();
  if (!admin) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const token = typeof body?.token === "string" ? body.token : "";

  const check = await verifyLogin(admin.userId, token);
  if (check.status !== "ok") {
    return NextResponse.json(
      { error: "Enter a current code from your authenticator to switch this off." },
      { status: 400 },
    );
  }

  await prisma.user.update({
    where: { id: admin.userId },
    data: { totpSecret: null, totpEnabledAt: null, totpBackupCodes: undefined, totpLastStep: null },
  });

  // Recorded at `alert`, because two-factor being removed from an account that
  // holds the payment book is either a person changing phones or the first
  // visible step of somebody consolidating a break-in. The trail should not
  // have to guess which.
  await writeAudit(unguardedPrisma, {
    action: "permissionChange",
    model: "User",
    recordId: admin.userId,
    affectedCount: 1,
    severity: "alert",
    summary: `Two-factor authentication switched OFF for ${admin.email}`,
  });

  return NextResponse.json({ ok: true });
}
