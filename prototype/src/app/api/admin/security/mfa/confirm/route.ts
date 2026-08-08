import { NextResponse } from "next/server";
import { unguardedPrisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-roles";
import { confirmEnrolment } from "@/lib/mfa";
import { writeAudit } from "@/lib/prisma-guard";

/**
 * Step two: prove the authenticator app works, and switch two-factor on.
 *
 * The backup codes come back in this response and are never retrievable again
 * — they are stored hashed, exactly like passwords. The screen has to make
 * that clear, because an admin who clicks past them has quietly given up their
 * only route back in from a lost phone.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const admin = auth.admin;

  const body = await request.json().catch(() => ({}));
  const token = typeof body?.token === "string" ? body.token : "";

  const result = await confirmEnrolment(admin.userId, token);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  await writeAudit(unguardedPrisma, {
    action: "permissionChange",
    model: "User",
    recordId: admin.userId,
    affectedCount: 1,
    severity: "notice",
    summary: `Two-factor authentication switched ON for ${admin.email}`,
  });

  return NextResponse.json({ ok: true, backupCodes: result.backupCodes });
}
