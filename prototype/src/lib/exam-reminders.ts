/**
 * Exam reminders — the send-one-registration step, shared by the admin's
 * manual "send now" button and the daily cron sweep.
 *
 * The sweep used to only exist as a manual POST an admin had to remember to
 * trigger from `/admin/emails` — nothing scheduled it, so a student who
 * registered and then nobody in the office thought to click the button got no
 * reminder at all. `sendDueExamReminders` gives the single cron dispatcher
 * (`/api/cron/tick`) a function to call instead.
 *
 * It fires on a single calendar day — exactly `daysBeforeExam` days out —
 * rather than a multi-day window, so running once a day naturally sends each
 * registration exactly one reminder instead of re-sending on every tick that
 * still falls inside a wider range.
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { sendEmail } from "@/lib/mailer";
import { examReminderEmailTemplate } from "@/lib/email-templates";

type RegistrationWithExam = Prisma.ExamRegistrationGetPayload<{
  include: { student: { include: { user: true } }; exam: { include: { lecturer: { include: { user: true } } } } };
}>;

export async function sendExamReminder(registration: RegistrationWithExam): Promise<boolean> {
  const student = registration.student;
  const exam = registration.exam;
  // External candidates sit exams here too and have no Student row.
  const studentEmail = student?.user?.email ?? registration.candidateEmail;
  const studentName = student?.user?.name ?? registration.candidateName;
  const tutorName = exam?.lecturer?.user?.name;

  if (!studentEmail) return false;

  const template = examReminderEmailTemplate(
    studentName || "Student",
    exam?.name || "Exam",
    exam?.examDate || new Date(),
    tutorName || undefined,
  );

  await sendEmail({ to: studentEmail, subject: template.subject, html: template.html });

  await prisma.emailLog.create({
    data: {
      studentId: student?.id ?? null,
      recipientEmail: studentEmail,
      type: "exam_reminder",
      subject: template.subject,
      status: "sent",
    },
  });

  return true;
}

export type ExamReminderResult = { sentCount: number; totalProcessed: number; errors: string[] };

export async function sendDueExamReminders(daysBeforeExam = 3): Promise<ExamReminderResult> {
  const dayStart = new Date();
  dayStart.setDate(dayStart.getDate() + daysBeforeExam);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const registrations = await prisma.examRegistration.findMany({
    where: { status: "registered", exam: { examDate: { gte: dayStart, lt: dayEnd } } },
    include: {
      student: { include: { user: true } },
      exam: { include: { lecturer: { include: { user: true } } } },
    },
  });

  let sentCount = 0;
  const errors: string[] = [];

  for (const registration of registrations) {
    try {
      if (await sendExamReminder(registration)) sentCount++;
    } catch (error) {
      errors.push(`Failed to send reminder to registration ${registration.id}: ${error}`);
    }
  }

  return { sentCount, totalProcessed: registrations.length, errors };
}
