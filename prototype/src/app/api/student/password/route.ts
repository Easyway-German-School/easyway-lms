import { NextResponse } from "next/server";
import bcryptjs from "bcryptjs";
import { requireAuthSession } from "@/lib/auth";
import { prisma, unguardedPrisma } from "@/lib/prisma";
import { passwordProblem } from "@/lib/password-reset";
import { writeAudit } from "@/lib/prisma-guard";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "Enter your current password and a new password." }, { status: 400 });
  }
  const problem = passwordProblem(newPassword);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  if (currentPassword === newPassword) {
    return NextResponse.json({ error: "Your new password must be different." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { password: true, email: true } });
  if (!user || !(await bcryptjs.compare(currentPassword, user.password))) {
    return NextResponse.json({ error: "Your current password is not correct." }, { status: 400 });
  }

  const hashed = await bcryptjs.hash(newPassword, 10);
  await prisma.user.update({ where: { id: session.user.id }, data: { password: hashed } });
  await writeAudit(unguardedPrisma, {
    action: "update",
    model: "User",
    recordId: session.user.id,
    affectedCount: 1,
    severity: "notice",
    summary: `Password changed by ${user.email}`,
  });

  return NextResponse.json({ ok: true, message: "Your password has been changed." });
}
