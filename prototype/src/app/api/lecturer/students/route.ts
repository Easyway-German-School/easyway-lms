import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deriveStudentAccess } from "@/lib/access";
import { requiredDepositFor, tuitionFeeFor } from "@/lib/payment";
import {
  describeAssignment,
  isAssigned,
  matchesBatch,
  readAssignment,
  studentWhereForAssignment,
} from "@/lib/lecturer-assignment";

export const dynamic = "force-dynamic";

/**
 * The tutor's own students, with the detail an admin sees.
 *
 * Two things used to make this list wrong. It went through Enrollment, which
 * almost nobody has rows in, so a tutor with a full class saw "No students
 * enrolled". And once that was fixed it read the tutor's single branch + level,
 * so a tutor who takes two levels — or works at two branches — saw only one of
 * them and had no way of knowing the rest existed.
 *
 * It now reads the admin-set assignment, through the same clause the roster,
 * attendance, grading and announcements all use. A student appears here the
 * moment they register for a matching branch and level. Nobody adds them.
 *
 * Payment status is included because a tutor is usually the first person a
 * student talks to about their balance, and sending them to the office blind
 * helps nobody. Amounts are visible; card details do not exist here at all.
 */
export async function GET() {
  try {
    const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const lecturer = await prisma.lecturer.findUnique({
      where: { userId: session.user.id },
    });

    if (!lecturer) {
      return NextResponse.json({ error: "Lecturer profile not found" }, { status: 404 });
    }

    const assignment = readAssignment(lecturer);
    const where = studentWhereForAssignment(assignment);

    if (!where || !isAssigned(assignment)) {
      return NextResponse.json({
        assigned: false,
        cohortLabel: null,
        students: [],
        // Deliberately points at the office rather than a form. A tutor cannot
        // set this themselves any more, so telling them to go and fix it would
        // send them to a page that only shows them what they were given.
        message:
          "You have not been assigned a class yet. The school office sets this — ask them to add your branch and level.",
      });
    }

    const [students, branches] = await Promise.all([
      prisma.student.findMany({
        where: where as any,
        include: {
          user: { select: { name: true, email: true, createdAt: true } },
          branch: { select: { name: true } },
          payments: { select: { amount: true, status: true } },
          attendances: { select: { present: true } },
          _count: { select: { assignmentSubmissions: true, certificates: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.branch.findMany({ select: { id: true, name: true, mode: true } }),
    ]);

    const branchNames = new Map(branches.map((branch) => [branch.id, branch.name]));

    const rows = students
      // Batch lives inside the admission JSON, which SQLite cannot filter on.
      .filter((student) => matchesBatch(assignment, student.admission))
      .map((student) => {
        const admission =
          typeof student.admission === "object" && student.admission !== null
            ? (student.admission as Record<string, unknown>)
            : {};

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
          branchName: student.branch?.name ?? null,
          sessionSlot: student.sessionSlot,
          classType: student.classType,
          deliveryMode: student.deliveryMode,
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

    const onlineBranchIds = new Set(
      branches.filter((branch) => branch.mode === "online").map((branch) => branch.id),
    );

    return NextResponse.json({
      assigned: true,
      cohortLabel: describeAssignment(assignment, branchNames),
      assignment,
      isOnlineBranch: assignment.branchIds.some((id) => onlineBranchIds.has(id)),
      students: rows,
    });
  } catch (error) {
    console.error("Lecturer students lookup failed", error);
    return NextResponse.json({ error: "Could not load your students" }, { status: 500 });
  }
}
