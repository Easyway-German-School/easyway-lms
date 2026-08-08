import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { requireTenantSession, tenantScopeForUser } from "@/lib/tenant-access";
import { deriveStudentAccess } from "@/lib/access";
import { requiredDepositFor, tuitionFeeFor } from "@/lib/payment";
import { KIND, notify } from "@/lib/notify";

/**
 * Pairing a private student with their tutor.
 *
 * A private student has no branch+level cohort to fall into, so nothing
 * assigns them a tutor automatically — somebody in the office has to say who
 * teaches them. This is that step, and it is the only way `Student.tutorId`
 * gets set for a one-to-one student.
 *
 * The search is deliberately limited to students on a private package. Letting
 * it reach the whole school would make it far too easy to pull a group student
 * into a one-to-one slot they never paid for.
 */

export const dynamic = "force-dynamic";

/** GET ?q= — search private-package students. */
export async function GET(request: NextRequest) {
  const gate = await requireCapability("staff");
  if (!gate.ok) return gate.response;

  const auth = await requireTenantSession();
  if (!auth.ok) return auth.response!;

  const query = (request.nextUrl.searchParams.get("q") ?? "").trim();

  const students = await prisma.student.findMany({
    where: {
      ...tenantScopeForUser(auth.tenantId),
      classType: "private",
      ...(query
        ? {
            OR: [
              { studentCode: { contains: query, mode: "insensitive" as const } },
              { user: { name: { contains: query, mode: "insensitive" as const } } },
              { user: { email: { contains: query, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    },
    include: {
      user: { select: { name: true, email: true } },
      branch: { select: { name: true } },
      payments: { select: { amount: true, status: true } },
      tutor: { select: { id: true, user: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  return NextResponse.json({
    students: students.map((student) => {
      const totalPaid = student.payments
        .filter((payment) => payment.status === "completed")
        .reduce((sum, payment) => sum + payment.amount, 0);
      const feeLookup = {
        level: student.level,
        branch: student.branch?.name ?? null,
        classType: student.classType,
      };
      const access = deriveStudentAccess({
        totalPaid,
        tuitionFee: tuitionFeeFor(feeLookup),
        requiredDeposit: requiredDepositFor(feeLookup),
      });

      return {
        id: student.id,
        name: student.user.name || student.user.email,
        email: student.user.email,
        studentCode: student.studentCode,
        level: student.level,
        branchName: student.branch?.name ?? null,
        totalPaid,
        tuitionFee: access.tuitionFee,
        // Shown next to every result so nobody assigns a tutor to somebody who
        // has not actually bought the package.
        hasPaid: access.hasAccess,
        currentTutorId: student.tutor?.id ?? null,
        currentTutorName: student.tutor?.user.name ?? null,
      };
    }),
  });
}

/** POST — assign a tutor to a private student and tell the student. */
export async function POST(request: NextRequest) {
  const gate = await requireCapability("staff");
  if (!gate.ok) return gate.response;

  const auth = await requireTenantSession();
  if (!auth.ok) return auth.response!;

  const body = await request.json().catch(() => null);
  const studentId = typeof body?.studentId === "string" ? body.studentId : "";
  const lecturerId = typeof body?.lecturerId === "string" ? body.lecturerId : "";

  if (!studentId || !lecturerId) {
    return NextResponse.json({ error: "studentId and lecturerId are required" }, { status: 400 });
  }

  const [student, lecturer] = await Promise.all([
    prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, classType: true, userId: true, user: { select: { tenantId: true } } },
    }),
    prisma.lecturer.findUnique({
      where: { id: lecturerId },
      select: { id: true, phone: true, user: { select: { name: true, email: true, tenantId: true } } },
    }),
  ]);

  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });
  if (!lecturer) return NextResponse.json({ error: "Tutor not found" }, { status: 404 });
  if (auth.tenantId && student.user.tenantId !== auth.tenantId) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }
  if (auth.tenantId && lecturer.user.tenantId !== auth.tenantId) {
    return NextResponse.json({ error: "Tutor not found" }, { status: 404 });
  }
  if (student.classType !== "private") {
    return NextResponse.json(
      { error: "Only students on a private package can be assigned a one-to-one tutor" },
      { status: 400 },
    );
  }

  await prisma.student.update({ where: { id: studentId }, data: { tutorId: lecturerId } });

  const tutorName = lecturer.user.name || lecturer.user.email;
  await notify({
    to: { studentIds: [studentId] },
    kind: KIND.announcement,
    severity: "success",
    title: "Your private tutor has been assigned",
    // The tutor's name is the entire point of the message — a student told
    // only that "a tutor was assigned" has to ring the office to find out who.
    message: `${tutorName} will be taking your private classes. They will be in touch to agree your times, and your sessions will appear on your calendar once booked.`,
    link: "/calendar",
  }).catch((error) => console.error("Private tutor notification failed", error));

  return NextResponse.json({ success: true, tutorName });
}
