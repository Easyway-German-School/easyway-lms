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
import { PART_PAYMENT_LOCK_DAYS } from "@/lib/access";
import { buildLedger, ledgerIsPopulated } from "@/lib/finance/ledger";
import { onTrackPlanStudentIds } from "@/lib/payment-plans";

export type FeeReminderResult = {
  sentCount: number;
  totalProcessed: number;
  errors: string[];
};

type ReminderTracking = { "7d"?: boolean; "14d"?: boolean; "30d"?: boolean; locked?: boolean };

const STAGES: Array<{ days: number; key: keyof ReminderTracking }> = [
  { days: 7, key: "7d" },
  { days: 14, key: "14d" },
  { days: 30, key: "30d" },
];

const DAY_MS = 24 * 60 * 60 * 1000;

export async function sendDueFeeReminders(options: {
  studentId?: string;
  /** Ignore the schedule and the already-sent marks. For the "send now" button. */
  forceSend?: boolean;
} = {}): Promise<FeeReminderResult> {
  const { studentId, forceSend = false } = options;
  const now = Date.now();

  // Students on an on-track tuition payment plan — held like a grace date.
  const onTrackPlan = forceSend ? new Set<string>() : await onTrackPlanStudentIds(new Date(now));

  const allInvoices = await prisma.invoice.findMany({
    where: {
      status: "partial",
      ...(studentId && { studentId }),
    },
    orderBy: { createdAt: "asc" },
    include: {
      student: {
        include: {
          user: true,
          tuitionCharges: {
            where: { deletedAt: null },
            select: { id: true, level: true, amount: true, waivedAmount: true, legacyArrears: true, createdAt: true, settledAt: true },
          },
          payments: { where: receivedPaymentFilter(), select: { amount: true } },
        },
      },
      payments: { where: receivedPaymentFilter() },
    },
  });

  // A student who part-paid more than once could carry two open invoices for
  // one balance (older data — the checkout now folds top-ups into one). Chase
  // the oldest open invoice per student and ignore the rest, so nobody is
  // emailed twice for the same money.
  const seenStudents = new Set<string>();
  const invoices = allInvoices.filter((invoice) => {
    if (seenStudents.has(invoice.studentId)) return false;
    seenStudents.add(invoice.studentId);
    return true;
  });

  let sentCount = 0;
  const errors: string[] = [];

  for (const invoice of invoices) {
    try {
      const student = invoice.student;
      const studentEmail = student.user?.email;
      const studentName = student.user?.name;

      if (!studentEmail) continue;

      // An admin grace date in the future silences every stage.
      const graceUntil = student.paymentGraceUntil ? new Date(student.paymentGraceUntil) : null;
      if (!forceSend && graceUntil && now < graceUntil.getTime()) continue;
      if (!forceSend && onTrackPlan.has(student.id)) continue;

      const tracking: ReminderTracking =
        student.feeRemindersScheduled && typeof student.feeRemindersScheduled === "object"
          ? (student.feeRemindersScheduled as ReminderTracking)
          : {};

      const daysSinceCreation = Math.floor((now - new Date(invoice.createdAt).getTime()) / DAY_MS);

      // The per-level ledger, when the student has one. It moves the lock clock
      // onto the oldest still-open GO-FORWARD charge and reports what is owed
      // across every level rather than just this invoice.
      const studentPaid = (student.payments || []).reduce((sum, p) => sum + p.amount, 0);
      const ledger = buildLedger(student.tuitionCharges ?? [], studentPaid, new Date(now));
      const hasLedger = ledgerIsPopulated(ledger);

      // The date portal access pauses for an unsettled balance — 30 days after
      // classes start (or the newest level's charge), falling back to enrolment.
      const anchor =
        (hasLedger && ledger.oldestOpenGoForwardChargeAt
          ? new Date(ledger.oldestOpenGoForwardChargeAt)
          : null) ?? student.classesStartedAt ?? student.createdAt;
      const lockAt = new Date(new Date(anchor).getTime() + PART_PAYMENT_LOCK_DAYS * DAY_MS);

      const invoicePaid = (invoice.payments || []).reduce((sum, payment) => sum + payment.amount, 0);
      const outstandingAmount = hasLedger
        ? ledger.goForwardOutstanding
        : invoice.totalAmount - invoicePaid;
      if (outstandingAmount <= 0) continue;

      type Send = { key: keyof ReminderTracking; stage: number | "locked"; type: string; due: boolean };
      const sends: Send[] = [
        ...STAGES.map((s) => ({
          key: s.key,
          stage: s.days as number | "locked",
          type: `fee_reminder_${s.days}d`,
          due: forceSend || daysSinceCreation >= s.days,
        })),
        {
          key: "locked" as const,
          stage: "locked" as const,
          type: "fee_reminder_locked",
          due: forceSend || now >= lockAt.getTime(),
        },
      ];

      for (const send of sends) {
        const unsent = forceSend || !tracking[send.key];
        if (!send.due || !unsent) continue;

        try {
          const template = feeReminderEmailTemplate(
            studentName || "Student",
            send.stage,
            outstandingAmount,
            invoice.currency,
            lockAt,
          );

          await sendEmail({ to: studentEmail, subject: template.subject, html: template.html });

          await prisma.emailLog.create({
            data: {
              studentId: student.id,
              recipientEmail: studentEmail,
              type: send.type,
              subject: template.subject,
              status: "sent",
            },
          });

          tracking[send.key] = true;
          sentCount++;
        } catch (error) {
          errors.push(`Failed to send ${send.type} to ${studentEmail}: ${error}`);
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
