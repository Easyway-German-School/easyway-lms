import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildEnrolmentLetterPdf } from "@/lib/enrolment-letter-pdf";
import { getStudentAccess } from "@/lib/student-access";
import { hasPaidAnyTuition } from "@/lib/payment";

/**
 * A student's own downloadable proof-of-enrolment letter — for a visa
 * office, an embassy, or an employer. Self-service so a student does not
 * have to wait on the office for something that only restates facts already
 * on their own record.
 */
export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: {
      id: true,
      studentCode: true,
      level: true,
      classType: true,
      pathway: true,
      deliveryMode: true,
      createdAt: true,
      classesStartedAt: true,
      branch: { select: { name: true } },
      user: { select: { name: true, tenant: { select: { brandName: true } } } },
      payments: { select: { amount: true, status: true, description: true } },
    },
  });
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });

  // The letter says "enrolled", so it waits for the first tuition payment —
  // full or part. A registration fee alone is an application, not enrolment.
  if (!hasPaidAnyTuition(student.payments)) {
    return NextResponse.json(
      { error: "Your enrolment letter is available once you have made a tuition payment." },
      { status: 403 },
    );
  }

  // Same ledger-aware computation the portal itself uses. This used to
  // compare lifetime totalPaid against the flat current-level fee — which
  // reads a promoted student's already-settled earlier level as unpaid
  // progress toward the new one, or a lifetime total that happens to exceed
  // one level's fee as "settled" when the ledger says otherwise. Wrong either
  // way on a document a visa office or employer may rely on.
  const access = await getStudentAccess(student.id);
  const tuitionSettled = (access?.outstandingBalance ?? Infinity) <= 0;

  const pdf = await buildEnrolmentLetterPdf({
    schoolName: student.user?.tenant?.brandName ?? undefined,
    studentName: student.user?.name ?? "Student",
    studentCode: student.studentCode,
    level: student.level,
    pathway: student.pathway,
    branchName: student.branch?.name ?? null,
    deliveryMode: student.deliveryMode,
    enrolledAt: student.classesStartedAt ?? student.createdAt,
    tuitionSettled,
    referenceNo: `${student.id.slice(-8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`,
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="enrolment-letter-${student.studentCode ?? student.id.slice(-8)}.pdf"`,
    },
  });
}
