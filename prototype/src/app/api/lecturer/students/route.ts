import { NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isReceivedPayment, isRegistrationFeePayment } from "@/lib/payment";
import { accessFromStudent } from "@/lib/student-access";
import {
  belongsToLecturer,
  describeAssignment,
  isAssigned,
  readAssignment,
  studentWhereForLecturer,
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
 * Payment status is included only as a non-sensitive tag. Exact fees, paid
 * totals, and outstanding balances belong to the office and never cross this
 * tutor API boundary.
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
    const where = studentWhereForLecturer(assignment, lecturer.id);

    if (!where) {
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
          coTutors: { select: { lecturerId: true } },
          payments: { select: { amount: true, status: true, description: true } },
          tuitionCharges: {
            where: { deletedAt: null },
            select: { id: true, level: true, amount: true, waivedAmount: true, legacyArrears: true, createdAt: true, settledAt: true },
          },
          attendances: { select: { present: true } },
          _count: { select: { assignmentSubmissions: true, certificates: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.branch.findMany({ select: { id: true, name: true, mode: true } }),
    ]);

    const branchNames = new Map(branches.map((branch) => [branch.id, branch.name]));

    const rows = students
      // Batch lives inside the admission JSON, which cannot be filtered on in
      // the query. A student named onto this tutor skips the check entirely.
      .filter((student) => belongsToLecturer(assignment, lecturer.id, student))
      .map((student) => {
        const admission =
          typeof student.admission === "object" && student.admission !== null
            ? (student.admission as Record<string, unknown>)
            : {};

        const receivedTuitionPayments = student.payments.filter(
          (payment) => isReceivedPayment(payment.status) && !isRegistrationFeePayment(payment.description),
        );
        // Same computation the student's own portal and the admin remote view
        // run (lib/student-access.ts) — not a hand-rolled copy, which is
        // exactly what let this tag disagree with whether the student could
        // actually get into the room. `paymentPlanOnTrack` is skipped here on
        // purpose: it is its own async query per student, too expensive for a
        // roster of fifty, and skipping it only ever makes this tag STRICTER
        // than the truth (a same-or-worse "Owing" instead of a false "Paid"),
        // never the wrong direction.
        const accessInput = { ...student, payments: receivedTuitionPayments };
        const access = accessFromStudent(accessInput);
        const totalPaid = access.totalPaid;

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
          // Named onto this tutor by the office rather than matched into the
          // class. Shown as a tag so a tutor is never surprised by a student
          // their class description does not explain.
          namedByOffice:
            student.tutorId === lecturer.id ||
            student.coTutors.some((link) => link.lecturerId === lecturer.id),
          joinedAt: student.user.createdAt.toISOString(),
          phone: typeof admission.phone === "string" ? admission.phone : null,
          city: typeof admission.city === "string" ? admission.city : null,
          country: typeof admission.country === "string" ? admission.country : null,
          batch: typeof admission.batch === "string" ? admission.batch : null,
          photoUrl: typeof admission.photoUrl === "string" ? admission.photoUrl : null,
          paymentStatus: access.batchLocked
            ? "Awaiting intake"
            : access.hasAccess
              ? "Paid"
              : totalPaid > 0
                ? "Owing"
                : "Pending",
          hasAccess: access.hasAccess,
          // Placed in an intake that has not opened — their portal is a
          // countdown, so "outstanding" would misread a fully-paid learner.
          waitingBatch: access.batchLocked ? access.batchLabel : null,
          attendanceRate,
          sessionsRecorded: student.attendances.length,
          submissions: student._count.assignmentSubmissions,
          certificates: student._count.certificates,
        };
      });

    const onlineBranchIds = new Set(
      branches.filter((branch) => branch.mode === "online").map((branch) => branch.id),
    );

    // No class described AND nobody named: the office has said nothing at all.
    if (!rows.length && !isAssigned(assignment)) {
      return NextResponse.json({
        assigned: false,
        cohortLabel: null,
        students: [],
        message:
          "You have not been assigned a class yet. The school office sets this — ask them to add your branch and level.",
      });
    }

    return NextResponse.json({
      assigned: true,
      // A tutor who has only named students has no class description to show,
      // and "No class assigned" over a list of their students reads as a bug.
      cohortLabel: isAssigned(assignment)
        ? describeAssignment(assignment, branchNames)
        : `${rows.length} student${rows.length === 1 ? "" : "s"} assigned to you by the office`,
      assignment,
      isOnlineBranch: assignment.branchIds.some((id) => onlineBranchIds.has(id)),
      students: rows,
    });
  } catch (error) {
    console.error("Lecturer students lookup failed", error);
    return NextResponse.json({ error: "Could not load your students" }, { status: 500 });
  }
}
