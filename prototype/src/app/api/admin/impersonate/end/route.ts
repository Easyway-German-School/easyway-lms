import { NextRequest, NextResponse } from "next/server";
import { decode } from "next-auth/jwt";
import { beginRequestScope } from "@/lib/tenant/context";
import { beginAuditScope, setAuditActor } from "@/lib/audit-context";
import { unguardedPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/prisma-guard";
import { readSessionCookie, sessionCookieOptions } from "@/lib/impersonation";

/**
 * END an act-as session and hand the browser its admin cookie back.
 *
 * Stateless by design — see src/lib/impersonation.ts. The admin's original
 * token was folded into the student token as a claim when the session
 * started; this just lifts it back out and re-sets it as the cookie. No
 * lookup, so it works even if the student's own record changed underneath
 * the session.
 */
export async function POST(request: NextRequest) {
  beginRequestScope();
  beginAuditScope();

  const secret = process.env.NEXTAUTH_SECRET;
  const ownCookie = readSessionCookie(request);
  if (!secret || !ownCookie) {
    return NextResponse.json({ error: "No session" }, { status: 401 });
  }
  const { name: cookieName, value: raw, secure } = ownCookie;

  const token = await decode({ token: raw, secret });
  const adminToken = token?.impersonatorToken as string | undefined;
  if (!token || !adminToken) {
    return NextResponse.json({ error: "Not currently acting as a student" }, { status: 400 });
  }

  setAuditActor({
    userId: token.impersonatorId as string | undefined,
    email: token.impersonatorEmail as string | undefined,
    role: "admin:super",
    source: "app",
  });
  await writeAudit(unguardedPrisma, {
    action: "impersonationEnd",
    model: "Student",
    recordId: (token.impersonatedStudentId as string) ?? null,
    severity: "notice",
    summary: `${token.impersonatorEmail ?? "An admin"} stopped acting as ${token.name ?? token.email ?? "a student"}`,
  });

  const studentId = token.impersonatedStudentId as string | undefined;
  const response = NextResponse.json({
    ok: true,
    redirectTo: studentId ? `/admin/students/${studentId}` : "/admin",
  });
  // Restored verbatim — it is still the admin's original, unexpired token.
  response.cookies.set(cookieName, adminToken, sessionCookieOptions(secure, 30 * 24 * 60 * 60));
  return response;
}
