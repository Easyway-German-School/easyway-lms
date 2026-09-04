import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-roles";

/**
 * Clears a student's code back to "NO STUDENT ID ISSUED" so a wrongly-issued
 * one (wrong branch/level/batch at the moment it was allocated) can be
 * reissued clean via `issue-code` instead of living with a bad identifier.
 *
 * Deliberately does not touch anything the code may already be printed on
 * (certificates, exam entries) — those keep whatever string they were given;
 * this only clears the student record's own pointer to it.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (!auth.admin.can("students")) {
    return NextResponse.json({ error: "Not permitted" }, { status: 403 });
  }

  const { id } = await params;
  const student = await prisma.student.findUnique({
    where: { id },
    select: { id: true, studentCode: true },
  });
  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }
  if (!student.studentCode) {
    return NextResponse.json({ studentCode: null });
  }

  await prisma.student.update({
    where: { id },
    data: { studentCode: null },
  });

  return NextResponse.json({ studentCode: null });
}
