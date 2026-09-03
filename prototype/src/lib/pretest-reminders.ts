/**
 * Pre-test (mock exam) reminders — the daily sweep the cron dispatcher calls.
 *
 * A mock is `Exam.kind = "mock"`. Unlike a real ÖSD/telc sitting nobody
 * registers for a mock individually — it is the whole class sitting a practice
 * paper — so the audience is resolved the way an announcement is: every active
 * student at that level (and branch, if the sitting names one), plus anyone who
 * *did* get an explicit `ExamRegistration` row, and the assigned tutor.
 *
 * Like `sendDueExamReminders`, this fires on ONE calendar day — exactly
 * `daysBefore` days before the sitting — so a once-a-day tick sends each class
 * exactly one reminder. `notify()`'s `dedupeKey` is the backstop: two ticks on
 * the same day send nothing twice.
 */

import { prisma } from "@/lib/prisma";
import { KIND, notify } from "@/lib/notify";
import { pretestReminderEmailTemplate } from "@/lib/email-templates";

export type PretestReminderResult = {
  sittings: number;
  studentsNotified: number;
  tutorsNotified: number;
};

export async function sendDuePretestReminders(daysBefore = 3): Promise<PretestReminderResult> {
  const dayStart = new Date();
  dayStart.setDate(dayStart.getDate() + daysBefore);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const exams = await prisma.exam.findMany({
    where: { kind: "mock", examDate: { gte: dayStart, lt: dayEnd } },
    select: {
      id: true,
      name: true,
      level: true,
      branchId: true,
      examDate: true,
      lecturer: { select: { userId: true, user: { select: { name: true } } } },
      registrations: { where: { status: "registered" }, select: { studentId: true } },
    },
  });

  let studentsNotified = 0;
  let tutorsNotified = 0;

  for (const exam of exams) {
    const level = exam.level ?? undefined;
    const tutorName = exam.lecturer?.user?.name ?? undefined;
    const subject = `Mock exam reminder: your ${exam.level ?? ""} pretest`.replace(/\s+/g, " ").trim();

    // Explicit registrations win; otherwise fall back to the whole class.
    const registeredIds = exam.registrations
      .map((r) => r.studentId)
      .filter((id): id is string => Boolean(id));

    const target = registeredIds.length
      ? { studentIds: registeredIds }
      : { students: { level: exam.level ?? null, branchId: exam.branchId ?? null } };

    const result = await notify({
      to: target,
      kind: KIND.examPretest,
      severity: "info",
      title: subject || "Mock exam reminder",
      message:
        `Your ${exam.level ? `${exam.level} ` : ""}class sits a mock exam on ` +
        `${exam.examDate.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}. ` +
        `It is practice — the score does not go on your certificate — but sit it like the real thing.`,
      link: "/calendar",
      push: true,
      dedupeKey: `pretest:${exam.id}`,
      emailHtmlFor: (recipient) =>
        pretestReminderEmailTemplate(recipient.name ?? "", exam.level ?? "your", exam.examDate, tutorName).html,
    }).catch((error) => {
      console.error(`pretest reminder failed for exam ${exam.id}`, error);
      return null;
    });
    studentsNotified += result?.created ?? 0;

    // The tutor, once — a different message: prepare the paper, mark everyone,
    // results release themselves.
    if (exam.lecturer?.userId) {
      const tutorResult = await notify({
        to: { userIds: [exam.lecturer.userId] },
        kind: KIND.examPretest,
        severity: "info",
        title: `Mock exam for your ${exam.level ?? ""} class`.replace(/\s+/g, " ").trim(),
        message:
          `A mock / pretest for your ${exam.level ? `${exam.level} ` : ""}class is on ` +
          `${exam.examDate.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}. ` +
          `Run it under real conditions and enter every mark in the gradebook — results release to students automatically once the class is marked.`,
        link: "/lecturer/gradebook",
        push: true,
        dedupeKey: `pretest-tutor:${exam.id}`,
      }).catch((error) => {
        console.error(`pretest tutor reminder failed for exam ${exam.id}`, error);
        return null;
      });
      tutorsNotified += tutorResult?.created ?? 0;
    }
  }

  return { sittings: exams.length, studentsNotified, tutorsNotified };
}
