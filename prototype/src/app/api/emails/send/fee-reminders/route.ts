import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/mailer";
import { feeReminderEmailTemplate } from "@/lib/email-templates";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

/**
 * POST /api/emails/send/fee-reminders
 * Send fee reminder emails for PARTIAL payments at 7, 14, and 30 days
 * Can be called manually or via cron job
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session || (session.user.role !== "ADMIN" && session.user.role !== "SYSTEM")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { studentId, forceSend = false } = body;

    // Get all students with PARTIAL payment status or outstanding balance
    const invoices = await prisma.invoice.findMany({
      where: {
        status: "partial", // Only PARTIAL payments
        ...(studentId && { studentId }),
      },
      include: {
        student: { include: { user: true } },
        payments: { where: { status: "completed" } },
      },
    });

    let sentCount = 0;
    const errors: string[] = [];

    for (const invoice of invoices) {
      try {
        const student = invoice.student;
        const studentEmail = student.user?.email;
        const studentName = student.user?.name;

        if (!studentEmail) continue;

        // Parse fee reminders tracking
        let remindersScheduled: { "7d"?: boolean; "14d"?: boolean; "30d"?: boolean } = {};
        if (student.feeRemindersScheduled && typeof student.feeRemindersScheduled === "object") {
          remindersScheduled = student.feeRemindersScheduled as { "7d"?: boolean; "14d"?: boolean; "30d"?: boolean };
        }

        // Calculate days since first payment
        const createdDate = new Date(invoice.createdAt);
        const now = new Date();
        const daysSinceCreation = Math.floor((now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24));

        // Determine which reminders to send
        const remindersToSend: Array<{ days: number; key: "7d" | "14d" | "30d" }> = [
          { days: 7, key: "7d" },
          { days: 14, key: "14d" },
          { days: 30, key: "30d" },
        ];

        for (const reminder of remindersToSend) {
          if ((forceSend || daysSinceCreation >= reminder.days) && (!remindersScheduled[reminder.key] || forceSend)) {
            try {
              const outstandingAmount = invoice.totalAmount - (invoice.payments || []).reduce((sum, p) => sum + p.amount, 0);

              if (outstandingAmount > 0) {
                const template = feeReminderEmailTemplate(
                  studentName || "Student",
                  reminder.days,
                  outstandingAmount,
                  invoice.currency
                );

                await sendEmail({
                  to: studentEmail,
                  subject: template.subject,
                  html: template.html,
                });

                await prisma.emailLog.create({
                  data: {
                    studentId: student.id,
                    recipientEmail: studentEmail,
                    type: `fee_reminder_${reminder.days}d`,
                    subject: template.subject,
                    status: "sent",
                  },
                });

                // Mark reminder as sent
                remindersScheduled[reminder.key] = true;
                sentCount++;
              }
            } catch (error) {
              errors.push(`Failed to send ${reminder.days}d reminder to ${studentEmail}: ${error}`);
            }
          }
        }

        // Update student's reminder tracking
        await prisma.student.update({
          where: { id: student.id },
          data: { feeRemindersScheduled: remindersScheduled },
        });
      } catch (error) {
        errors.push(`Failed to process invoice ${invoice.id}: ${error}`);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Fee reminders sent to ${sentCount} students`,
      sentCount,
      totalProcessed: invoices.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Error sending fee reminders:", error);
    return NextResponse.json({ error: "Failed to send fee reminders" }, { status: 500 });
  }
}

/**
 * GET /api/emails/send/fee-reminders
 * Get statistics on fee reminders sent
 */
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session || (session.user.role !== "ADMIN" && session.user.role !== "SYSTEM")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get email log statistics
    const emailStats = await prisma.emailLog.groupBy({
      by: ["type"],
      where: {
        type: {
          contains: "fee_reminder",
        },
      },
      _count: true,
    });

    // Get count of students with PARTIAL invoices
    const partialInvoices = await prisma.invoice.count({
      where: { status: "partial" },
    });

    return NextResponse.json({
      totalPartialInvoices: partialInvoices,
      emailStats: emailStats.reduce(
        (acc, stat) => {
          acc[stat.type] = stat._count;
          return acc;
        },
        {} as Record<string, number>
      ),
    });
  } catch (error) {
    console.error("Error fetching fee reminder stats:", error);
    return NextResponse.json({ error: "Failed to fetch statistics" }, { status: 500 });
  }
}
