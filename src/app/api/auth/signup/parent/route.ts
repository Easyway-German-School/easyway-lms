import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcryptjs from "bcryptjs";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { currentTenantId, setTenantScope } from "@/lib/tenant/context";
import { resolveTenantId } from "@/lib/tenant/resolve";

/**
 * A parent/guardian's own account.
 *
 * Deliberately thin: this creates the login and records the child the parent
 * claims, and nothing else. The monitoring screens (attendance, results,
 * notifications) that will eventually read from this account are a separate,
 * later build — see the Parent model doc-comment in prisma/schema.prisma.
 *
 * The claimed child is looked up but never trusted on its own: a parent
 * typing somebody else's child's email is exactly the kind of claim that
 * must not self-link into real access, so `studentId` on a match is recorded
 * for the office to confirm rather than acted on anywhere yet.
 */
export async function POST(request: NextRequest) {
  try {
    setTenantScope(await resolveTenantId(request));

    const ip = clientIp(request.headers);
    const limit = checkRateLimit(`parent-signup:ip:${ip}`, {
      windowMs: 60 * 60 * 1000,
      max: 10,
    });
    if (!limit.ok) {
      return rateLimitResponse(
        limit,
        "Too many registration attempts from this connection. Please try again later.",
      );
    }

    const body = await request.json().catch(() => null);
    const { name, email, password, phone, childName, childEmail, childStudentCode } = body || {};

    const normalizedName = typeof name === "string" ? name.trim() : "";
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const normalizedPassword = typeof password === "string" ? password : "";
    const normalizedPhone = typeof phone === "string" ? phone.trim() : "";
    const normalizedChildName = typeof childName === "string" ? childName.trim() : "";
    const normalizedChildEmail = typeof childEmail === "string" ? childEmail.trim().toLowerCase() : "";
    const normalizedChildStudentCode = typeof childStudentCode === "string" ? childStudentCode.trim() : "";

    if (!normalizedName || !normalizedEmail || !normalizedPassword || !normalizedPhone || !normalizedChildName) {
      return NextResponse.json(
        { error: "Name, email, password, phone and your child's name are required." },
        { status: 400 },
      );
    }
    if (normalizedPassword.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
    }
    if (!normalizedChildEmail && !normalizedChildStudentCode) {
      return NextResponse.json(
        { error: "Please provide your child's registered email or student code, so the school can link your account." },
        { status: 400 },
      );
    }

    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
      return NextResponse.json({ error: "Email already registered" }, { status: 409 });
    }

    // Best-effort match, recorded for the office to confirm — see doc-comment.
    let matchedStudentId: string | null = null;
    if (normalizedChildStudentCode) {
      const byCode = await prisma.student.findUnique({
        where: { studentCode: normalizedChildStudentCode },
        select: { id: true },
      });
      matchedStudentId = byCode?.id ?? null;
    }
    if (!matchedStudentId && normalizedChildEmail) {
      const childUser = await prisma.user.findUnique({
        where: { email: normalizedChildEmail },
        select: { student: { select: { id: true } } },
      });
      matchedStudentId = childUser?.student?.id ?? null;
    }

    const hashedPassword = await bcryptjs.hash(normalizedPassword, 10);

    let user;
    try {
      user = await prisma.user.create({
        data: {
          email: normalizedEmail,
          name: normalizedName,
          password: hashedPassword,
          role: "PARENT",
          tenantId: currentTenantId(),
          parent: {
            create: {
              phone: normalizedPhone,
              childName: normalizedChildName,
              childEmail: normalizedChildEmail || null,
              childStudentCode: normalizedChildStudentCode || null,
              studentId: matchedStudentId,
            },
          },
        },
      });
    } catch (prismaError: any) {
      if (prismaError?.code === "P2002" && prismaError?.meta?.target?.includes("email")) {
        return NextResponse.json({ error: "Email already registered" }, { status: 409 });
      }
      throw prismaError;
    }

    return NextResponse.json(
      { message: "Parent account created", user: { id: user.id, email: user.email, name: user.name } },
      { status: 201 },
    );
  } catch (error) {
    console.error("Parent sign up error:", error);
    return NextResponse.json(
      {
        error: "Unable to create account right now. Please try again in a moment.",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
