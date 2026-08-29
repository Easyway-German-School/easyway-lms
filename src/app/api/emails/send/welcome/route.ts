import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/mailer";
import { welcomeEmailTemplate } from "@/lib/email-templates";
import { getServerSession } from "next-auth";
import { requireAuthSession } from "@/lib/auth";

/**
 * POST /api/emails/send/welcome
 * Send a welcome email after payment is completed
 * Requires: paymentId or studentId + enrollmentInfo
 */
export async function POST(request: Request) {
  try {
    const session = await requireAuthSession();
    
    // Check if admin or system
    if (!session || (session.user.role !== "ADMIN" && session.user.role !== "SYSTEM")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { paymentId, studentId, pathwayName } = body;

    if (!paymentId && !studentId) {
      return NextResponse.json({ error: "paymentId or studentId required" }, { status: 400 });
    }

    let payment;
    if (paymentId) {
      payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        include: { student: { include: { user: true } } },
      });
    } else {
      // Get the most recent completed payment for this student
      payment = await prisma.payment.findFirst({
        where: {
          studentId,
          status: "completed",
          welcomeEmailSentAt: null,
        },
        orderBy: { createdAt: "desc" },
        include: { student: { include: { user: true } } },
      });
    }

    if (!payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    if (payment.welcomeEmailSentAt) {
      return NextResponse.json({ error: "Welcome email already sent for this payment" }, { status: 400 });
    }

    const student = payment.student;
    const studentEmail = student.user?.email;
    const studentName = student.user?.name;

    if (!studentEmail) {
      return NextResponse.json({ error: "Student email not found" }, { status: 400 });
    }

    // Send welcome email
    const template = welcomeEmailTemplate(studentName || "Student", pathwayName || payment.description || "your program");
    
    await sendEmail({
      to: studentEmail,
      subject: template.subject,
      html: template.html,
    });

    // Mark email as sent
    await prisma.payment.update({
      where: { id: payment.id },
      data: { welcomeEmailSentAt: new Date() },
    });

    // Log email
    await prisma.emailLog.create({
      data: {
        studentId: student.id,
        recipientEmail: studentEmail,
        type: "welcome",
        subject: template.subject,
        status: "sent",
      },
    });

    return NextResponse.json({ success: true, message: "Welcome email sent" });
  } catch (error) {
    console.error("Error sending welcome email:", error);
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
  }
}
