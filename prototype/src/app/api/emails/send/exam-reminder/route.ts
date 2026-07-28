import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/mailer";
import { examReminderEmailTemplate } from "@/lib/email-templates";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

/**
 * POST /api/emails/send/exam-reminder
 * Send exam reminder emails to registered students
 * Can send to individual exam or all exams with upcoming dates
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session || (session.user.role !== "ADMIN" && session.user.role !== "SYSTEM")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { examId, examRegistrationId, sendToAll = false, daysBeforeExam = 3 } = body;

    let examRegistrations;

    if (examRegistrationId) {
      // Send to specific registration
      const registration = await prisma.examRegistration.findUnique({
        where: { id: examRegistrationId },
        include: {
          student: { include: { user: true } },
          exam: { include: { lecturer: { include: { user: true } } } },
        },
      });

      if (!registration) {
        return NextResponse.json({ error: "Exam registration not found" }, { status: 404 });
      }

      examRegistrations = [registration];
    } else if (examId) {
      // Send to all students registered for specific exam
      examRegistrations = await prisma.examRegistration.findMany({
        where: { examId, status: "registered" },
        include: {
          student: { include: { user: true } },
          exam: { include: { lecturer: { include: { user: true } } } },
        },
      });
    } else if (sendToAll) {
      // Send to all students with exams coming up
      const futureDate = new Date(Date.now() + daysBeforeExam * 24 * 60 * 60 * 1000);
      const pastDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);

      examRegistrations = await prisma.examRegistration.findMany({
        where: {
          status: "registered",
          exam: {
            examDate: {
              gte: pastDate,
              lte: futureDate,
            },
          },
        },
        include: {
          student: { include: { user: true } },
          exam: { include: { lecturer: { include: { user: true } } } },
        },
      });
    } else {
      return NextResponse.json(
        { error: "Provide examId, examRegistrationId, or set sendToAll=true" },
        { status: 400 }
      );
    }

    if (examRegistrations.length === 0) {
      return NextResponse.json({ message: "No exam registrations found to send reminders to" }, { status: 200 });
    }

    let sentCount = 0;
    const errors: string[] = [];

    for (const registration of examRegistrations) {
      try {
        const student = registration.student;
        const exam = registration.exam;
        const studentEmail = student.user?.email;
        const studentName = student.user?.name;
        const tutorName = exam?.lecturer?.user?.name;

        if (!studentEmail) continue;

        const template = examReminderEmailTemplate(studentName || "Student", exam?.name || "Exam", exam?.examDate || new Date(), tutorName || undefined);

        await sendEmail({
          to: studentEmail,
          subject: template.subject,
          html: template.html,
        });

        await prisma.emailLog.create({
          data: {
            studentId: student.id,
            recipientEmail: studentEmail,
            type: "exam_reminder",
            subject: template.subject,
            status: "sent",
          },
        });

        sentCount++;
      } catch (error) {
        errors.push(`Failed to send reminder to registration ${registration.id}: ${error}`);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Exam reminders sent to ${sentCount} students`,
      sentCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Error sending exam reminders:", error);
    return NextResponse.json({ error: "Failed to send exam reminders" }, { status: 500 });
  }
}
