/**
 * The exam-prep upsell drip.
 *
 * A booked-and-paid ÖSD/telc candidate is not the business — the prep class
 * they can be sold into is. This is deliberately NOT the logistics reminder
 * in exam-reminders.ts ("arrive 30 minutes early, bring ID"); it is three
 * soft-sell touches timed off the booking and the sitting itself:
 *
 *   +2 days after booking   — educational, no pitch yet ("ÖSD rewards
 *                              candidates who know the format")
 *   7 days before the exam  — "have you started practising?" + a link
 *   3 days before the exam  — skill-specific nudge (listening) + a link
 *
 * Each fires on a single calendar day, keyed by a per-stage dedupeKey, so the
 * hourly cron tick sends each candidate each stage exactly once no matter how
 * often it runs — the same shape as exam-campaign-reminders.ts and
 * exam-reminders.ts.
 *
 * Internal EasyWay tests are excluded (examBody = "internal") — there is
 * nothing to upsell a student already enrolled here into.
 */

import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";
import { schoolDayOffset } from "@/lib/school-time";

/**
 * Where the "Need help?" / prep-class links point. A single env var rather
 * than hard-coding a path, because the actual prep-class page this funnels
 * into is a placeholder until the ÖSD info list and pricing are confirmed —
 * see the memory note this session left about the exam-booking build.
 */
function prepClassLink(): string {
  return process.env.EXAM_PREP_CLASS_URL || "/exams/osd";
}

type NurtureRegistration = {
  id: string;
  userId: string | null;
  studentId: string | null;
  examName: string;
  candidateName: string | null;
};

async function sendStage(
  registration: NurtureRegistration,
  stage: "day2" | "week_before" | "three_days_before",
  title: string,
  message: string,
): Promise<boolean> {
  const to = registration.userId
    ? { userIds: [registration.userId] }
    : registration.studentId
      ? { studentIds: [registration.studentId] }
      : null;
  if (!to) return false;

  await notify({
    to,
    title,
    message,
    kind: `exam.prep_nurture_${stage}`,
    severity: "info",
    link: prepClassLink(),
    dedupeKey: `exam-prep-nurture:${registration.id}:${stage}`,
    push: true,
  });
  return true;
}

const NOT_INTERNAL = { not: "internal" } as const;
/** A seat only counts once the fee is settled — nobody gets sold prep classes for a booking they never confirmed. */
const CONFIRMED_PAYMENT = { in: ["paid", "waived"] as string[] };

export type ExamPrepNurtureResult = { day2: number; weekBefore: number; threeDaysBefore: number };

export async function sendDueExamPrepNurture(now = new Date()): Promise<ExamPrepNurtureResult> {
  const [day2, weekBefore, threeDaysBefore] = await Promise.all([
    sendDay2(now),
    sendBeforeExam(now, 7, "week_before", (name) =>
      [
        `It's one week to your ${name} examination.`,
        "This is the week most candidates start practising in earnest — the listening section rewards a trained ear more than last-minute grammar revision.",
        `Need help getting ready? ${prepClassLink()}`,
      ].join(" "),
    ),
    sendBeforeExam(now, 3, "three_days_before", (name) =>
      [
        `It's 3 days to your ${name} examination.`,
        "Have you practiced the listening? In this window your ears adjusting to spoken German matters more than anything else you could cram.",
        `Need help? EasyWay can help. ${prepClassLink()}`,
      ].join(" "),
    ),
  ]);

  return { day2, weekBefore, threeDaysBefore };
}

/** +2 days after booking, educational, no pitch. */
async function sendDay2(now: Date): Promise<number> {
  const dayStart = schoolDayOffset(now, -2);
  const dayEnd = schoolDayOffset(now, -1);

  const registrations = await prisma.examRegistration.findMany({
    where: {
      createdAt: { gte: dayStart, lt: dayEnd },
      paymentStatus: CONFIRMED_PAYMENT,
      exam: { examBody: NOT_INTERNAL },
    },
    select: { id: true, userId: true, studentId: true, examName: true, candidateName: true },
  });

  let sent = 0;
  for (const registration of registrations) {
    const ok = await sendStage(
      registration,
      "day2",
      "A quick note about your ÖSD exam",
      `${registration.examName} is one of the more learnable exams once you know its format and marking rules — most candidates who fail lose marks to the exam's structure, not the language itself. Worth ten minutes reading up on how it's marked.`,
    );
    if (ok) sent += 1;
  }
  return sent;
}

/** A single calendar day, `daysOut` days before the sitting. */
async function sendBeforeExam(
  now: Date,
  daysOut: number,
  stage: "week_before" | "three_days_before",
  message: (examName: string) => string,
): Promise<number> {
  const dayStart = schoolDayOffset(now, daysOut);
  const dayEnd = schoolDayOffset(now, daysOut + 1);

  const registrations = await prisma.examRegistration.findMany({
    where: {
      examDate: { gte: dayStart, lt: dayEnd },
      paymentStatus: CONFIRMED_PAYMENT,
      status: { not: "cancelled" },
      exam: { examBody: NOT_INTERNAL },
    },
    select: { id: true, userId: true, studentId: true, examName: true, candidateName: true },
  });

  let sent = 0;
  for (const registration of registrations) {
    const ok = await sendStage(
      registration,
      stage,
      stage === "week_before" ? "One week to go" : "3 days to your exam",
      message(registration.examName),
    );
    if (ok) sent += 1;
  }
  return sent;
}
