import { prisma } from "@/lib/prisma";
import { KIND, notify } from "@/lib/notify";

/**
 * Putting a named student on a named tutor.
 *
 * WHY THIS IS ONE FUNCTION AND NOT THREE WRITES.
 *
 * `Student.tutorId` is now settable from three screens — the tutor's own edit
 * panel, the student roster, and the student's file — and every one of them
 * has to do the same three things: move the column, tell the student who
 * teaches them, and tell the tutor they have somebody new. Three copies of
 * that is three chances to write the column and tell nobody, which is the
 * quiet failure here: the pairing works, the register updates, and neither
 * person finds out until somebody does not turn up.
 *
 * Passing `lecturerId: null` clears the pairing. That is a real operation
 * rather than an oversight — a student named onto a tutor for cover goes back
 * to their ordinary class afterwards — so it notifies too, in its own words.
 */

export type TutorPairingResult =
  | { ok: true; tutorName: string | null; studentName: string; changed: boolean }
  | { ok: false; error: string; status: number };

export async function setStudentTutor(input: {
  studentId: string;
  lecturerId: string | null;
  /** Skip the notifications — used by bulk paths that send their own summary. */
  quiet?: boolean;
}): Promise<TutorPairingResult> {
  const { studentId, lecturerId, quiet = false } = input;

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      tutorId: true,
      classType: true,
      user: { select: { name: true, email: true } },
    },
  });
  if (!student) return { ok: false, error: "Student not found", status: 404 };

  const lecturer = lecturerId
    ? await prisma.lecturer.findUnique({
        where: { id: lecturerId },
        select: { id: true, status: true, user: { select: { id: true, name: true, email: true } } },
      })
    : null;

  if (lecturerId && !lecturer) return { ok: false, error: "Tutor not found", status: 404 };

  const studentName = student.user.name || student.user.email;
  const tutorName = lecturer ? lecturer.user.name || lecturer.user.email : null;

  // Nothing to do, and nothing to announce. Saving a form that happens to
  // contain the tutor it already had must not buzz two people about it.
  if ((student.tutorId ?? null) === (lecturerId ?? null)) {
    return { ok: true, tutorName, studentName, changed: false };
  }

  await prisma.student.update({ where: { id: studentId }, data: { tutorId: lecturerId } });

  if (quiet) return { ok: true, tutorName, studentName, changed: true };

  if (lecturer) {
    await notify({
      to: { studentIds: [studentId] },
      kind: KIND.announcement,
      severity: "success",
      title: "Your tutor has been assigned",
      // The name is the entire point of the message. A student told only that
      // "a tutor was assigned" has to ring the office to find out who.
      message:
        student.classType === "private"
          ? `${tutorName} will be taking your private classes. They will be in touch to agree your times, and your sessions will appear on your calendar once booked.`
          : `${tutorName} is now your tutor. They can see your progress and will be marking your work.`,
      link: student.classType === "private" ? "/calendar" : "/classes",
      push: true,
    }).catch((error) => console.error("Tutor pairing notification failed", error));

    await notify({
      to: { userIds: [lecturer.user.id] },
      kind: KIND.announcement,
      severity: "info",
      title: "A student was added to your class",
      message: `The office assigned ${studentName} to you. They are on your roster, your register and your gradebook from now.`,
      link: "/lecturer/students",
      push: true,
    }).catch((error) => console.error("Tutor pairing notification failed", error));
  } else if (student.tutorId) {
    const previous = await prisma.lecturer.findUnique({
      where: { id: student.tutorId },
      select: { user: { select: { id: true } } },
    });
    if (previous) {
      await notify({
        to: { userIds: [previous.user.id] },
        kind: KIND.announcement,
        severity: "info",
        title: "A student was removed from your class",
        message: `The office moved ${studentName} off your roster. They no longer appear on your register or gradebook.`,
        link: "/lecturer/students",
        push: true,
      }).catch((error) => console.error("Tutor pairing notification failed", error));
    }
  }

  return { ok: true, tutorName, studentName, changed: true };
}
