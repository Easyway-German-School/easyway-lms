import bcryptjs from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { sendStudentPasswordResetEmail } from "@/lib/student-password-reset-email";
import { generateTempPassword } from "@/lib/student-password";

/**
 * The office's fast path for a locked-out student, called in and unable to
 * remember their password.
 *
 * The self-service flow (`/api/auth/password/request`) already exists, but it
 * depends on a queued email the student has to go find. When they've called
 * the office directly, waiting on that is the wrong answer — this sets a new
 * password immediately and emails it as a courtesy, the same shape as the
 * admin-sets-a-staff-password action in `/api/admin/staff` and the
 * parent-account welcome email.
 */

export const dynamic = "force-dynamic";

const MIN_PASSWORD = 8;

function badPassword(password: string): string | null {
  if (password.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters`;
  return null;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const custom = typeof body.password === "string" && body.password.trim() ? body.password.trim() : null;

  if (custom) {
    const weak = badPassword(custom);
    if (weak) return NextResponse.json({ error: weak }, { status: 400 });
  }

  const student = await prisma.student.findUnique({
    where: { id },
    select: { id: true, userId: true, user: { select: { name: true, email: true } } },
  });
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });

  const password = custom ?? generateTempPassword();
  const hash = await bcryptjs.hash(password, 10);

  await prisma.user.update({
    where: { id: student.userId },
    data: { password: hash, passwordClaimed: true },
  });

  let emailed = true;
  try {
    await sendStudentPasswordResetEmail({
      studentName: student.user.name ?? "there",
      studentEmail: student.user.email,
      temporaryPassword: password,
    });
  } catch (error) {
    // The password is already changed and usable — a mail hiccup must not
    // make the office think the reset itself failed.
    console.error("Could not queue student password reset email:", error);
    emailed = false;
  }

  return NextResponse.json({ success: true, password, emailed, email: student.user.email });
}
