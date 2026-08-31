/**
 * Fee reminders for partly-paid invoices, at 7, 14 and 30 days.
 *
 * This lived inside the POST handler of /api/emails/send/fee-reminders, which
 * meant the only way to run it was an HTTP request to ourselves. The cron route
 * did exactly that — and authenticated with `Bearer $SYSTEM_API_KEY` against a
 * handler that only accepts a NextAuth session whose role is ADMIN or SYSTEM.
 * There is no SYSTEM role, and a bearer token is not a session, so that call
 * has been returning 401 to a caller that logged `success: true` around it.
 * Nobody has been reminded about anything.
 *
 * Pulling it out here gives the scheduler a function to call instead of a URL
 * to authenticate against, which removes the failure entirely rather than
 * papering over it.
 */

import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/mailer";
import { feeReminderEmailTemplate } from "@/lib/email-templates";
import { receivedPaymentFilter } from "@/lib/payment";

export type FeeReminderResult = {
  sentCount: number;
  totalProcessed: number;
  errors: string[];
};

type ReminderTracking = { "7d"?: boolean; "14d"?: boolean; "30d"?: boolean };

const STAGES: Array<{ days: number; key: keyof ReminderTracking }> = [
  { days: 7, key: "7d" },
  { days: 14, key: "14d" },
  { days: 30, key: "30d" },
];

export async function sendDueFeeReminders(options: {
  studentId?: string;
  /** Ignore the schedule and the already-sent marks. For the "send now" button. */
  forceSend?: boolean;
} = {}): Promise<FeeReminderResult> {
  const { studentId, forceSend = false } = options;

  const invoices = await prisma.invoice.findMany({
    where: {
      status: "partial",
      ...(studentId && { studentId }),
    },
    include: {
      student: { include: { user: true } },
      payments: { where: receivedPaymentFilter() },
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

      const tracking: ReminderTracking =
        student.feeRemindersScheduled && typeof student.feeRemindersScheduled === "object"
          ? (student.feeRemindersScheduled as ReminderTracking)
          : {};

      const daysSinceCreation = Math.floor(
        (Date.now() - new Date(invoice.createdAt).getTime()) / (1000 * 60 * 60 * 24),
      );

      for (const stage of STAGES) {
        const due = forceSend || daysSinceCreation >= stage.days;
        const unsent = forceSend || !tracking[stage.key];
        if (!due || !unsent) continue;

        try {
          const paid = (invoice.payments || []).reduce((sum, payment) => sum + payment.amount, 0);
          const outstandingAmount = invoice.totalAmount - paid;
          if (outstandingAmount <= 0) continue;

          const template = feeReminderEmailTemplate(
            studentName || "Student",
            stage.days,
            outstandingAmount,
            invoice.currency,
          );

          await sendEmail({ to: studentEmail, subject: template.subject, html: template.html });

          await prisma.emailLog.create({
            data: {
              studentId: student.id,
              recipientEmail: studentEmail,
              type: `fee_reminder_${stage.days}d`,
              subject: template.subject,
              status: "sent",
            },
          });

          tracking[stage.key] = true;
          sentCount++;
        } catch (error) {
          errors.push(`Failed to send ${stage.days}d reminder to ${studentEmail}: ${error}`);
        }
      }

      await prisma.student.update({
        where: { id: student.id },
        data: { feeRemindersScheduled: tracking },
      });
    } catch (error) {
      errors.push(`Failed to process invoice ${invoice.id}: ${error}`);
    }
  }

  return { sentCount, totalProcessed: invoices.length, errors };
}
