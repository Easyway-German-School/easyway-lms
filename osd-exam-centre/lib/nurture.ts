import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { EXAM_PREP_LINK } from "@/lib/config";
import { escapeHtml } from "@/lib/html";

/**
 * The soft-sell drip into paid prep classes — the actual business model
 * ("the only way we are making money through this is to invite them for
 * examination preparatory classes... not selling to them directly"). Three
 * stages, each a boolean flag on the booking rather than a separate log
 * table, so the cron sweep is naturally idempotent: a stage that has already
 * fired for a booking is excluded from the query entirely.
 *
 *   +2 days after the booking is CONFIRMED (paid) — educational, no pitch
 *   7 days before the exam  — "have you started practising?"
 *   24 hours before the exam — final reminder
 *
 * The 7-day and 24-hour timing matches the Easyway ÖSD Examination
 * Operations Manual §9's candidate journey exactly (it specifies "7-Day
 * Reminder" then "24-Hour Reminder", not the 3-day gap this used to run).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function dayRange(target: Date): { gte: Date; lt: Date } {
  const start = new Date(target);
  start.setHours(0, 0, 0, 0);
  return { gte: start, lt: new Date(start.getTime() + DAY_MS) };
}

export async function runNurtureSweep(now = new Date()): Promise<{ day2: number; week: number; dayBefore: number }> {
  const day2 = await sweepDay2(now);
  const week = await sweepBeforeExam(now, 7, "nurtureWeekSent", weekMessage);
  // "24 hours before" resolves to "the calendar day before the exam" given
  // this only runs once a day (see vercel.json's daily cron) — true hour
  // precision isn't achievable on that schedule, and isn't what the manual
  // is actually asking for (its own daily-cadence candidate journey has no
  // finer granularity than this either).
  const dayBefore = await sweepBeforeExam(now, 1, "nurtureDayBeforeSent", dayBeforeMessage);
  return { day2, week, dayBefore };
}

async function sweepDay2(now: Date): Promise<number> {
  const target = new Date(now.getTime() - 2 * DAY_MS);
  const { gte, lt } = dayRange(target);

  const bookings = await prisma.examBooking.findMany({
    where: { verifiedAt: { gte, lt }, paymentStatus: "paid", nurtureDay2Sent: false },
    include: { session: { select: { title: true } } },
  });

  for (const booking of bookings) {
    await sendEmail({
      to: booking.email,
      subject: "A quick note about your ÖSD exam",
      html: `<p>Hello ${escapeHtml(booking.fullName)},</p><p>${booking.session.title} is one of the more learnable exams once you know its format and marking rules — most candidates who fail lose marks to the exam's structure, not the language itself. Worth ten minutes reading up on how it's marked.</p>`,
    });
    await prisma.examBooking.update({ where: { id: booking.id }, data: { nurtureDay2Sent: true } });
  }
  return bookings.length;
}

async function sweepBeforeExam(
  now: Date,
  daysOut: number,
  flag: "nurtureWeekSent" | "nurtureDayBeforeSent",
  message: (examTitle: string) => string,
): Promise<number> {
  const target = new Date(now.getTime() + daysOut * DAY_MS);
  const { gte, lt } = dayRange(target);

  const bookings = await prisma.examBooking.findMany({
    where: {
      paymentStatus: "paid",
      status: { not: "cancelled" },
      [flag]: false,
      session: { startDate: { gte, lt } },
    },
    include: { session: { select: { title: true } } },
  });

  for (const booking of bookings) {
    await sendEmail({
      to: booking.email,
      subject: daysOut === 7 ? "One week to go" : "Your exam is tomorrow",
      html: message(booking.session.title),
    });
    await prisma.examBooking.update({ where: { id: booking.id }, data: { [flag]: true } });
  }
  return bookings.length;
}

function weekMessage(examTitle: string): string {
  return `<p>It's one week to your ${examTitle} examination.</p><p>This is the week most candidates start practising in earnest — the listening section rewards a trained ear more than last-minute grammar revision.</p><p>Need help getting ready? <a href="${EXAM_PREP_LINK}">${EXAM_PREP_LINK}</a></p>`;
}

function dayBeforeMessage(examTitle: string): string {
  return `<p>Your ${examTitle} examination is tomorrow.</p><p>Bring your valid identification document — you will not be admitted without it. Arrive early and follow all examination instructions.</p><p>We wish you success.</p>`;
}
