import { NextResponse } from "next/server";
import bcryptjs from "bcryptjs";
import { requireAuthSession } from "@/lib/auth";
import { prisma, unguardedPrisma } from "@/lib/prisma";
import { passwordProblem } from "@/lib/password-reset";
import { writeAudit } from "@/lib/prisma-guard";
import { classifyLogin, isAcceptableReplacementEmail, isTemporaryLogin } from "@/lib/login-upgrade";

export const dynamic = "force-dynamic";

/**
 * "SET YOUR REAL LOGIN."
 *
 * A student the office onboarded from a paper form signs in with a login we
 * built for them — their phone number at a school subdomain, or an importer
 * placeholder — and a password we generated. Neither is theirs. This route
 * lets them, from the portal, trade both for an email they own and a password
 * they chose, in one step.
 *
 *   GET  → { due, kind, currentEmail, firstName } — is this student on a
 *          temporary login, and what is it. Drives LoginUpgradeMoment.
 *   POST { email, currentPassword, newPassword } → swaps the login. Writes an
 *          audit row and stamps `admission.loginUpgradedByStudentAt` so the
 *          office sees the change on the student's dossier.
 */

export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, name: true },
  });
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    due: isTemporaryLogin(user.email),
    kind: classifyLogin(user.email),
    currentEmail: user.email,
    firstName: (user.name ?? "").trim().split(/\s+/)[0] || null,
  });
}

export async function POST(request: Request) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const email = (typeof body.email === "string" ? body.email : "").trim();
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  if (!email || !currentPassword || !newPassword) {
    return NextResponse.json(
      { error: "Enter your new email, your current password and a new password." },
      { status: 400 },
    );
  }
  if (!isAcceptableReplacementEmail(email)) {
    return NextResponse.json({ error: "That does not look like a real email address you can receive mail at." }, { status: 400 });
  }
  const problem = passwordProblem(newPassword);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, password: true },
  });
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Only students who are actually on a temporary login get to use this path —
  // it is not a general "change my email" (that lives on the profile form).
  if (!isTemporaryLogin(user.email)) {
    return NextResponse.json({ error: "Your login is already set up — nothing to change here." }, { status: 409 });
  }
  if (!(await bcryptjs.compare(currentPassword, user.password))) {
    return NextResponse.json({ error: "Your current password is not correct." }, { status: 400 });
  }
  if (currentPassword === newPassword) {
    return NextResponse.json({ error: "Choose a new password, not the temporary one we sent you." }, { status: 400 });
  }

  const clash = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, NOT: { id: user.id } },
    select: { id: true },
  });
  if (clash) {
    return NextResponse.json({ error: "That email is already used by another account." }, { status: 409 });
  }

  const student = await prisma.student.findUnique({
    where: { userId: user.id },
    select: { id: true, admission: true },
  });
  const admission =
    student && typeof student.admission === "object" && student.admission !== null
      ? (student.admission as Record<string, unknown>)
      : {};

  await prisma.user.update({
    where: { id: user.id },
    data: {
      email,
      password: await bcryptjs.hash(newPassword, 10),
      passwordClaimed: true,
    },
  });

  if (student) {
    await prisma.student.update({
      where: { id: student.id },
      data: {
        admission: {
          ...admission,
          loginUpgradedByStudentAt: new Date().toISOString(),
          loginUpgradedFrom: user.email,
        },
      },
    });
  }

  await writeAudit(unguardedPrisma, {
    action: "update",
    model: "User",
    recordId: user.id,
    affectedCount: 1,
    severity: "notice",
    summary: `Student set their own login: ${user.email} → ${email}`,
  });

  return NextResponse.json({ ok: true, email });
}
