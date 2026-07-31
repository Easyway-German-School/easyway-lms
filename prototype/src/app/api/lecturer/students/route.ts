import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deriveStudentAccess } from "@/lib/access";
import { requiredDepositFor, tuitionFeeFor } from "@/lib/payment";
import { roomDisplayName } from "@/lib/live-classroom";

export const dynamic = "force-dynamic";

/**
 * The tutor's own students, with the detail an admin sees.
 *
 * Tutors could previously only reach students through Enrollment, which almost
 * nobody has rows in — so the attendance page showed "No students enrolled" to
 * a tutor with a full class. The real grouping is the one the whole school
 * runs on: branch + level + sitting.
 *
 * Payment status is included because a tutor is usually the first person a
 * student talks to about their balance, and sending them to the office blind
 * helps nobody. Amounts are visible; card details do not exist here at all.
 */
export async function GET() {
  try {
    const session = (await getServerSession(authOptions as any)) as any;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const lecturer = await prisma.lecturer.findUnique({
      where: { userId: session.user.id },
      include: { branch: { select: { id: true, name: true, mode: true } } },
    });

    if (!lecturer) {
      return NextResponse.json({ error: "Lecturer profile not found" }, { status: 404 });
    }

    if (!lecturer.branchId || !lecturer.level) {
      return NextResponse.json({
        assigned: false,
        cohortLabel: null,
        students: [],
        message: "Set your branch, level and session under Customise my classes to see your students.",
      });
    }

    const students = await prisma.student.findMany({
      where: {
        branchId: lecturer.branchId,
        level: lecturer.level,
        ...(lecturer.sessionSlot ? { sessionSlot: lecturer.sessionSlot } : {}),
      },
      include: {
        user: { select: { name: true, email: true, createdAt: true } },
        payments: { select: { amount: true, status: true } },
        attendances: { select: { present: true } },
        _count: { select: { assignmentSubmissions: true, certificates: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const branchName = lecturer.branch?.name ?? null;

    const rows = students.map((student) => {
      const admission =
        typeof student.admission === "object" && student.admission !== null
          ? (student.admission as Record<string, unknown>)
          : {};

      const totalPaid = student.payments
        .filter((payment) => payment.status === "completed")
        .reduce((sum, payment) => sum + payment.amount, 0);
      const feeLookup = { level: student.level, branch: branchName };
      const access = deriveStudentAccess({
        totalPaid,
        tuitionFee: tuitionFeeFor(feeLookup),
        requiredDeposit: requiredDepositFor(feeLookup),
      });

      const present = student.attendances.filter((attendance) => attendance.present).length;
      const attendanceRate = student.attendances.length
        ? Math.round((present / student.attendances.length) * 100)
        : null;

      return {
        id: student.id,
        name: student.user.name || student.user.email,
        email: student.user.email,
        studentCode: student.studentCode,
        level: student.level,
        sessionSlot: student.sessionSlot,
        classType: student.classType,
        status: student.status,
        pathway: student.pathway,
        joinedAt: student.user.createdAt.toISOString(),
        phone: typeof admission.phone === "string" ? admission.phone : null,
        city: typeof admission.city === "string" ? admission.city : null,
        country: typeof admission.country === "string" ? admission.country : null,
        batch: typeof admission.batch === "string" ? admission.batch : null,
        photoUrl: typeof admission.photoUrl === "string" ? admission.photoUrl : null,
        totalPaid,
        tuitionFee: access.tuitionFee,
        outstanding: Math.max(0, access.tuitionFee - totalPaid),
        hasAccess: access.hasAccess,
        attendanceRate,
        sessionsRecorded: student.attendances.length,
        submissions: student._count.assignmentSubmissions,
        certificates: student._count.certificates,
      };
    });

    return NextResponse.json({
      assigned: true,
      cohortLabel: roomDisplayName({
        branchName,
        level: lecturer.level,
        sessionSlot: lecturer.sessionSlot,
      }),
      isOnlineBranch: lecturer.branch?.mode === "online",
      students: rows,
    });
  } catch (error) {
    console.error("Lecturer students lookup failed", error);
    return NextResponse.json({ error: "Could not load your students" }, { status: 500 });
  }
}
