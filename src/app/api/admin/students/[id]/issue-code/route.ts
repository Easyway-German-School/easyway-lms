import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-roles";
import { assignStudentCode } from "@/lib/student-code";

/**
 * Manual "issue it now" for a student stuck on "NO STUDENT ID ISSUED".
 *
 * Code assignment at signup / manual-add / import is best-effort — see
 * src/lib/student-code-backfill.ts, which sweeps for this on the daily cron —
 * but an office on the phone with a student right now should not have to wait
 * for tomorrow's tick. A no-op (200, unchanged) if the student already has one.
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
    select: {
      id: true,
      studentCode: true,
      level: true,
      classType: true,
      admission: true,
      branch: { select: { name: true, mode: true } },
    },
  });
  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }
  if (student.studentCode) {
    return NextResponse.json({ studentCode: student.studentCode });
  }

  const batch = (student.admission as { batch?: unknown } | null)?.batch;
  const studentCode = await assignStudentCode(student.id, {
    level: student.level,
    batch,
    branch: student.branch,
    classType: student.classType,
  });

  if (!studentCode) {
    return NextResponse.json({ error: "Could not allocate a code — try again in a moment" }, { status: 500 });
  }
  return NextResponse.json({ studentCode });
}
