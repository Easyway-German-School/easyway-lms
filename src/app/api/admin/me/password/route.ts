import { getServerSession } from "next-auth";
import bcryptjs from "bcryptjs";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { resolveAdmin } from "@/lib/admin-roles";

/**
 * An admin changing their own password.
 *
 * Separate from the staff route on purpose. That one is a super admin acting
 * on somebody else and needs the `staff` capability; this is a person acting
 * on themselves and needs only their current password. Without it, a secretary
 * whose password had been handed to them on a slip of paper had no way to
 * change it to something the office had not seen.
 *
 * THE CURRENT PASSWORD IS REQUIRED and that is not ceremony. A session cookie
 * on a machine somebody walked away from is enough to reach this route; the
 * old password is what stops that becoming a permanent account takeover.
 */

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string };
  } | null;
  const admin = await resolveAdmin(session?.user?.id);
  if (!admin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";

  if (!currentPassword || !newPassword) {
    return NextResponse.json(
      { error: "Enter your current password and the new one" },
      { status: 400 },
    );
  }
  if (newPassword.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }
  if (newPassword === currentPassword) {
    return NextResponse.json({ error: "That is the password you already have" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: admin.userId },
    select: { password: true },
  });
  if (!user || !(await bcryptjs.compare(currentPassword, user.password))) {
    return NextResponse.json({ error: "That current password is not right" }, { status: 401 });
  }

  await prisma.user.update({
    where: { id: admin.userId },
    data: { password: await bcryptjs.hash(newPassword, 10), passwordClaimed: true },
  });

  return NextResponse.json({ success: true });
}
