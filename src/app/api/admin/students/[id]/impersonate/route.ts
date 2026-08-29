import { NextRequest, NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import { requireAdmin } from "@/lib/admin-roles";
import { prisma, unguardedPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/prisma-guard";
import { IMPERSONATION_MAX_AGE_SECONDS, readSessionCookie, sessionCookieOptions } from "@/lib/impersonation";

/**
 * START acting as a student. See src/lib/impersonation.ts for the mechanism.
 *
 * SUPER ADMIN ONLY, and not overridable by a per-person capability grant the
 * way the rest of the admin area is — this is more powerful than reading the
 * audit trail (`security`, itself already hand-granted only), so it does not
 * ride the ordinary grant/revoke diff at all. Every use is written to that
 * same audit trail at `alert` severity: the student is never told, but the
 * school always can find out who did this and when.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const admin = auth.admin;

  if (admin.adminRole !== "super") {
    return NextResponse.json({ error: "Only a super admin can act as a student" }, { status: 403 });
  }

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });

  const { id } = await params;
  const student = await prisma.student.findUnique({
    where: { id },
    select: {
      id: true,
      user: { select: { id: true, name: true, email: true, role: true, tenantId: true } },
    },
  });
  if (!student) return NextResponse.json({ error: "No such student" }, { status: 404 });
  if (String(student.user.role).toLowerCase() !== "student") {
    return NextResponse.json({ error: "This account is not a student" }, { status: 400 });
  }

  // The admin's own signed-in cookie, folded whole into the new token so
  // ending the session needs no lookup — see src/lib/impersonation.ts.
  const ownCookie = readSessionCookie(request);
  if (!ownCookie) {
    return NextResponse.json({ error: "Your own session could not be read" }, { status: 401 });
  }
  const { name: cookieName, value: adminRawToken, secure } = ownCookie;

  const studentToken = {
    id: student.user.id,
    role: "student",
    tenantId: student.user.tenantId ?? undefined,
    name: student.user.name,
    email: student.user.email,
    issuedAt: Date.now(),
    pwCheckedAt: Date.now(),
    adminLocked: false,
    impersonatorId: admin.userId,
    impersonatorEmail: admin.email,
    impersonatedStudentId: student.id,
    impersonatorToken: adminRawToken,
  };

  const encoded = await encode({
    token: studentToken,
    secret,
    maxAge: IMPERSONATION_MAX_AGE_SECONDS,
  });

  await writeAudit(unguardedPrisma, {
    action: "impersonationStart",
    model: "Student",
    recordId: student.id,
    severity: "alert",
    summary: `${admin.email} started acting as ${student.user.name ?? student.user.email ?? "a student"}`,
  });

  const response = NextResponse.json({ ok: true, redirectTo: "/dashboard" });
  response.cookies.set(cookieName, encoded, sessionCookieOptions(secure, IMPERSONATION_MAX_AGE_SECONDS));
  return response;
}
