import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { EXAM_PREP_LINK } from "@/lib/config";

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
 *   3 days before the exam  — listening-specific nudge
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function dayRange(target: Date): { gte: Date; lt: Date } {
  const start = new Date(target);
  start.setHours(0, 0, 0, 0);
  return { gte: start, lt: new Date(start.getTime() + DAY_MS) };
}

export async function runNurtureSweep(now = new Date()): Promise<{ day2: number; week: number; threeDay: number }> {
  const day2 = await sweepDay2(now);
  const week = await sweepBeforeExam(now, 7, "nurtureWeekSent", weekMessage);
  const threeDay = await sweepBeforeExam(now, 3, "nurture3DaySent", threeDayMessage);
  return { day2, week, threeDay };
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
      html: `<p>Hello ${booking.fullName},</p><p>${booking.session.title} is one of the more learnable exams once you know its format and marking rules — most candidates who fail lose marks to the exam's structure, not the language itself. Worth ten minutes reading up on how it's marked.</p>`,
    });
    await prisma.examBooking.update({ where: { id: booking.id }, data: { nurtureDay2Sent: true } });
  }
  return bookings.length;
}

async function sweepBeforeExam(
  now: Date,
  daysOut: number,
  flag: "nurtureWeekSent" | "nurture3DaySent",
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
      subject: daysOut === 7 ? "One week to go" : "3 days to your exam",
      html: message(booking.session.title),
    });
    await prisma.examBooking.update({ where: { id: booking.id }, data: { [flag]: true } });
  }
  return bookings.length;
}

function weekMessage(examTitle: string): string {
  return `<p>It's one week to your ${examTitle} examination.</p><p>This is the week most candidates start practising in earnest — the listening section rewards a trained ear more than last-minute grammar revision.</p><p>Need help getting ready? <a href="${EXAM_PREP_LINK}">${EXAM_PREP_LINK}</a></p>`;
}

function threeDayMessage(examTitle: string): string {
  return `<p>It's 3 days to your ${examTitle} examination.</p><p>Have you practiced the listening? In this window your ears adjusting to spoken German matters more than anything else you could cram.</p><p>Need help? EasyWay can help. <a href="${EXAM_PREP_LINK}">${EXAM_PREP_LINK}</a></p>`;
}
