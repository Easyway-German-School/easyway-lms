import { getServerSession } from "next-auth";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { derivePaymentStatus, requiredDepositFor, tuitionFeeFor, isReceivedPayment, isRegistrationFeePayment } from "@/lib/payment";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch student data
    const student = await prisma.student.findUnique({
      where: { userId: session.user.id },
      include: {
        user: true,
        branch: true,
        // The profile page names the assigned tutor. A Lecturer has no name of
        // its own — it hangs off the linked user account.
        tutor: { select: { id: true, user: { select: { name: true } } } },
        enrollments: {
          include: {
            pathway: {
              include: {
                courses: {
                  include: {
                    modules: true,
                    materials: true
                  }
                }
              }
            }
          }
        },
        progress: {
          include: {
            course: true
          }
        },
        examRegistrations: {
          include: { exam: true },
          orderBy: { createdAt: "desc" },
        },
        attendances: true,
        notifications: {
          orderBy: { createdAt: "desc" },
        },
        payments: {
          orderBy: { createdAt: "desc" },
        },
      }
    });

    if (!student) {
      return NextResponse.json(
        { error: "Student not found" },
        { status: 404 }
      );
    }

    // Format the response
    const feeLookup = { level: student.level, branch: student.branch?.name ?? null, classType: student.classType };
    const tuitionFee = tuitionFeeFor(feeLookup);
    const requiredDeposit = requiredDepositFor(feeLookup);
    const totalPaid = student.payments
      .filter((payment) => isReceivedPayment(payment.status) && !isRegistrationFeePayment(payment.description))
      .reduce((sum, payment) => sum + payment.amount, 0);
    const paymentMeta = derivePaymentStatus({ totalPaid, tuitionFee, requiredDeposit });
    const paymentStatus = paymentMeta.status;

    const profile = {
      user: {
        id: student.user.id,
        name: student.user.name,
        email: student.user.email,
        createdAt: student.user.createdAt,
      },
      student: {
        id: student.id,
        studentCode: student.studentCode,
        level: student.level,
        status: student.status,
        pathway: student.pathway,
        examReadiness: student.examReadiness,
        nextLive: student.nextLive,
        branch: student.branch,
        tutor: student.tutor ? { id: student.tutor.id, name: student.tutor.user?.name ?? null } : null,
        admission: student.admission,
        paymentStatus,
        paymentSummary: {
          totalPaid,
          tuitionFee,
          requiredDeposit,
          balance: Math.max(0, tuitionFee - totalPaid),
        },
        photoUrl:
          typeof student.admission === "object" && student.admission !== null && "photoUrl" in student.admission
            ? (student.admission as Record<string, unknown>).photoUrl
            : undefined,
      },
      enrollments: student.enrollments.map(e => ({
        id: e.id,
        status: e.status,
        enrolledAt: e.enrolledAt,
        pathway: {
          id: e.pathway.id,
          name: e.pathway.name,
          courses: e.pathway.courses.map(c => ({
            id: c.id,
            title: c.title,
            level: c.level,
            duration: c.duration,
            materials: c.materials,
          })),
        },
      })),
      progress: student.progress.map(p => ({
        courseId: p.courseId,
        courseName: p.course.title,
        percentComplete: p.percentComplete,
        started: p.started,
        completed: p.completed
      })),
      materials: student.enrollments.flatMap(e =>
        e.pathway.courses.flatMap(c => 
          c.materials.map(m => ({
            id: m.id,
            title: m.title,
            fileUrl: m.filePath,
            fileType: m.fileType,
            fileSize: m.fileSize,
            course: {
              id: c.id,
              title: c.title
            }
          }))
        )
      ),
      exams: student.examRegistrations.map((r) => ({
        id: r.id,
        examId: r.examId,
        examName: r.examName,
        examDate: r.examDate.toISOString(),
        level: (r.exam as { course?: { level?: string } } | null)?.course?.level ?? (r.examName.includes("B2") ? "B2" : r.examName.includes("B1") ? "B1" : "A2"),
        status: r.status,
        notes: r.notes,
        registeredAt: r.createdAt.toISOString(),
      })),
      attendance: {
        total: student.attendances.length,
        records: student.attendances.map(a => ({
          id: a.id,
          date: a.date,
          status: a.status,
          notes: a.notes
        }))
      },
      notifications: student.notifications.map((notification) => ({
        id: notification.id,
        title: notification.title,
        message: notification.message,
        channel: notification.channel,
        branchId: notification.branchId,
        level: notification.level,
        status: notification.status,
        sentAt: notification.sentAt?.toISOString() ?? null,
        createdAt: notification.createdAt.toISOString(),
      })),
      payments: student.payments.map((payment) => ({
        id: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        method: payment.method,
        description: payment.description,
        invoiceId: payment.invoiceId,
        stripeSessionId: payment.stripeSessionId,
        paymentIntentId: payment.paymentIntentId,
        createdAt: payment.createdAt.toISOString(),
        updatedAt: payment.updatedAt.toISOString(),
      })),
    };

    return NextResponse.json(profile);
  } catch (error) {
    console.error("Error fetching student profile:", error);
    return NextResponse.json(
      { error: "Failed to fetch profile" },
      { status: 500 }
    );
  }
}
