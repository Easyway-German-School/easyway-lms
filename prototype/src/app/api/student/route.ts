import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { derivePaymentStatus } from "@/lib/payment";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let student = await prisma.student.findUnique({
      where: { userId: session.user.id as string },
      include: {
        user: true,
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
          pathway: "Goethe exam mastery",
          nextLive: null,
          examReadiness: 0,
          averageGrade: null,
          gradeCount: 0,
          recentGrades: [],
          activePrograms: [],
          outcome: null,
        });
      }

      student = await prisma.student.create({
        data: {
          userId: session.user.id as string,
          level: "A1",
          pathway: "Goethe exam mastery",
          examReadiness: 0,
        },
        include: {
          user: true,
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

    const grades = await prisma.grade.findMany({
      where: { studentId: student.id },
      orderBy: { createdAt: "desc" },
      take: 8,
    });

    const tuitionFees: Record<string, number> = {
      A1: 150000,
      A2: 150000,
      B1: 180000,
      B2: 180000,
      C1: 200000,
      C2: 220000,
    };

    const tuitionFee = tuitionFees[student.level] ?? 150000;
    const registrationFee = 5000;
    const requiredDeposit = Math.round(tuitionFee * 0.6);
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
      pathway: student.pathway,
      nextLive: student.nextLive,
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
      pathway: "Goethe exam mastery",
      nextLive: "No live session scheduled",
      examReadiness: 0,
      averageGrade: null,
      gradeCount: 0,
      recentGrades: [],
      activePrograms: [],
      outcome: "Goethe C1 readiness + German work placement support",
      paymentSummary: {
        totalPaid: 0,
        registrationFee: 5000,
        requiredDeposit: 90000,
        tuitionFee: 150000,
        registrationPaid: true,
        depositPaid: false,
        fullPaid: false,
        accessLevel: "registered",
        paymentProgressPercent: 0,
      },
    });
  }
}
