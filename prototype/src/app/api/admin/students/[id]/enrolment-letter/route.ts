import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";
import { buildEnrolmentLetterPdf } from "@/lib/enrolment-letter-pdf";
import { isReceivedPayment, isRegistrationFeePayment, tuitionFeeFor } from "@/lib/payment";

/** The office generating a proof-of-enrolment letter on a student's behalf — the same document the student can pull themselves, for when the request comes in by phone or in person. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const { id } = await params;

  const student = await prisma.student.findUnique({
    where: { id },
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
      payments: { where: { status: { in: ["completed", "partial"] } }, select: { amount: true, status: true, description: true } },
    },
  });
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });

  const feeLookup = { level: student.level, branch: student.branch?.name ?? null, classType: student.classType, pathway: student.pathway };
  const totalPaid = student.payments
    .filter((p) => isReceivedPayment(p.status) && !isRegistrationFeePayment(p.description))
    .reduce((sum, p) => sum + p.amount, 0);
  const tuitionSettled = totalPaid >= tuitionFeeFor(feeLookup);

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
