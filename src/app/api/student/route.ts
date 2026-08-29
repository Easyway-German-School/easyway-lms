import { getServerSession } from "next-auth";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { derivePaymentStatus, REGISTRATION_FEE, requiredDepositFor, tuitionFeeFor } from "@/lib/payment";
import { NextResponse } from "next/server";
import { mayAutoCreateStudent } from "@/lib/candidates";

export async function GET() {
  try {
    const session = await requireAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let student = await prisma.student.findUnique({
      where: { userId: session.user.id as string },
      include: {
        user: true,
        // Tuition is priced by branch as well as level.
        branch: { select: { name: true } },
        // Only ever populated for a private student, but harmless to join
        // for everyone else since tutorId is null there.
        tutor: { select: { id: true, photoUrl: true, specialization: true, bio: true, user: { select: { name: true } } } },
        enrollments: {
          include: {
            pathway: true,
          },
        },
        payments: true,
      },
    });

    if (!student) {
      const userRole = (session.user as { role?: string } | undefined)?.role;
      if (userRole === "LECTURER" || userRole === "ADMIN") {
        return NextResponse.json({
          name: (session.user as any)?.name || "Learner",
          level: "A1",
          pathway: "Language training",
          nextLive: null,
          examReadiness: 0,
          averageGrade: null,
          gradeCount: 0,
          recentGrades: [],
          activePrograms: [],
          outcome: null,
        });
      }

      // An exam candidate has no Student record on purpose; creating one here
      // would quietly promote them into the full student portal.
      if (!(await mayAutoCreateStudent(session.user.id as string))) {
        return NextResponse.json({ error: "Not a student account", candidate: true }, { status: 403 });
      }

      student = await prisma.student.create({
        data: {
          userId: session.user.id as string,
          level: "A1",
          pathway: "Language training",
          examReadiness: 0,
        },
        include: {
          user: true,
          branch: { select: { name: true } },
          tutor: { select: { id: true, photoUrl: true, specialization: true, bio: true, user: { select: { name: true } } } },
          enrollments: {
            include: {
              pathway: true,
            },
          },
          payments: true,
        },
      });
    }

    if (!student) {
      return NextResponse.json({ error: "Unable to load student profile" }, { status: 500 });
    }

    const nextPrivateClass = student.classType === "private"
      ? await prisma.privateClass.findFirst({
          where: { studentId: student.id, status: { in: ["scheduled", "postponed"] }, scheduledAt: { gte: new Date() } },
          orderBy: { scheduledAt: "asc" },
          select: { scheduledAt: true, topic: true },
        })
      : null;
    const nextLive = nextPrivateClass
      ? `${nextPrivateClass.scheduledAt.toLocaleString()}${nextPrivateClass.topic ? ` · ${nextPrivateClass.topic}` : ""}`
      : student.nextLive;

    const grades = await prisma.grade.findMany({
      where: { studentId: student.id },
      orderBy: { createdAt: "desc" },
      take: 8,
    });

    const feeLookup = { level: student.level, branch: student.branch?.name ?? null, classType: student.classType };
    const tuitionFee = tuitionFeeFor(feeLookup);
    const registrationFee = REGISTRATION_FEE;
    const requiredDeposit = requiredDepositFor(feeLookup);
    const totalPaid = student.payments
      .filter((payment) => payment.status === "completed")
      .reduce((sum, payment) => sum + payment.amount, 0);
    const registrationPaid = true;
    const paymentMeta = derivePaymentStatus({ totalPaid, tuitionFee, requiredDeposit });
    const depositPaid = paymentMeta.depositPaid;
    const fullPaid = paymentMeta.fullPaid;
    const accessLevel = paymentMeta.fullPaid ? "full" : paymentMeta.depositPaid ? "partial" : "registered";
    const paymentProgressPercent = paymentMeta.paymentProgressPercent;
    const gradeCount = grades.length;
    const averageGrade = gradeCount > 0 ? Math.round(grades.reduce((sum, grade) => sum + grade.score, 0) / gradeCount) : null;
    const recentGrades = grades.map((grade) => ({
      type: grade.type,
      score: grade.score,
      createdAt: grade.createdAt,
    }));

    return NextResponse.json({
      name: student.user?.name || "Learner",
      studentCode: student.studentCode,
      level: student.level,
      branchName: student.branch?.name ?? null,
      classType: student.classType,
      deliveryMode: student.deliveryMode,
      tutorId: student.tutor?.id ?? null,
      tutorName: student.tutor?.user?.name ?? null,
      tutorPhotoUrl: student.tutor?.photoUrl ?? null,
      tutorSpecialization: student.tutor?.specialization ?? null,
      tutorBio: student.tutor?.bio ?? null,
      pathway: student.pathway,
      germanyGoal: student.germanyGoal,
      germanyGoalNote: student.germanyGoalNote,
      nextLive,
      examReadiness: student.examReadiness,
      averageGrade,
      gradeCount,
      recentGrades,
      activePrograms: student.enrollments.map((enrollment) => enrollment.pathway.name),
      outcome: student.outcome,
      paymentSummary: {
        totalPaid,
        registrationFee,
        requiredDeposit,
        tuitionFee,
        registrationPaid,
        depositPaid,
        fullPaid,
        accessLevel,
        paymentProgressPercent,
      },
    });
  } catch (error) {
    console.error("Student profile API fallback triggered:", error);
    return NextResponse.json({
      name: "Learner",
      level: "A1",
      pathway: "Language training",
      nextLive: "No live session scheduled",
      examReadiness: 0,
      averageGrade: null,
      gradeCount: 0,
      recentGrades: [],
      activePrograms: [],
      outcome: "C1 readiness + German work placement support",
      branchName: null,
      paymentSummary: {
        totalPaid: 0,
        registrationFee: REGISTRATION_FEE,
        // No branch on this path, so the standard-tier A1 price is the honest
        // placeholder rather than a number invented here.
        requiredDeposit: requiredDepositFor({ level: "A1", branch: null }),
        tuitionFee: tuitionFeeFor({ level: "A1", branch: null }),
        registrationPaid: true,
        depositPaid: false,
        fullPaid: false,
        accessLevel: "registered",
        paymentProgressPercent: 0,
      },
    });
  }
}
