/**
 * "Your tutor did X" reads fine for a student with one tutor. A hybrid
 * student has two — a campus tutor and an online tutor — and every
 * notification, assignment and grade that says "your tutor" without saying
 * which one leaves them guessing. This is the one place that answers "which
 * of this student's two tutors did this?", so assignments, marking,
 * materials, session notes and attendance notifications all describe the
 * same acting tutor the same way instead of five slightly different guesses.
 *
 * Not needed for a physical or online-only student — they have exactly one
 * tutor, so `role` comes back null and callers fall back to plain "your
 * tutor" phrasing.
 */

import { prisma } from "@/lib/prisma";

export type TutorRole = "physical" | "online" | null;
export type TutorAttribution = { name: string; role: TutorRole };

/**
 * The pure half: given a student's own tutor data (already loaded by the
 * caller) decide whether `lecturerId` is their campus or online tutor. No
 * query, so a page that lists thirty grades doesn't run thirty lookups.
 */
export function roleForLecturer(
  student: {
    tutorId: string | null;
    deliveryMode: string;
    coTutors: Array<{ lecturerId: string; role: string | null }>;
  },
  lecturerId: string | null | undefined,
): TutorRole {
  if (!lecturerId || student.deliveryMode !== "hybrid") return null;
  if (student.tutorId === lecturerId) return "physical";
  const coTutor = student.coTutors.find((row) => row.lecturerId === lecturerId);
  return coTutor?.role === "online" ? "online" : null;
}

/**
 * Look up who this is and, for a hybrid student, which of their two tutors.
 * Safe to call with any lecturerId — a lecturer who is neither the primary
 * nor a co-tutor (shouldn't happen in practice, but a stale reference must
 * not crash a notification) still gets their name back with `role: null`.
 */
export async function attributeTutorAction(
  studentId: string,
  actingLecturerId: string | null | undefined,
): Promise<TutorAttribution | null> {
  if (!actingLecturerId) return null;

  const [student, lecturer] = await Promise.all([
    prisma.student.findUnique({
      where: { id: studentId },
      select: {
        tutorId: true,
        deliveryMode: true,
        coTutors: { select: { lecturerId: true, role: true } },
      },
    }),
    prisma.lecturer.findUnique({
      where: { id: actingLecturerId },
      select: { user: { select: { name: true, email: true } } },
    }),
  ]);

  if (!lecturer) return null;
  const name = lecturer.user.name || lecturer.user.email;

  if (!student || student.deliveryMode !== "hybrid") return { name, role: null };
  if (student.tutorId === actingLecturerId) return { name, role: "physical" };
  const coTutor = student.coTutors.find((row) => row.lecturerId === actingLecturerId);
  if (coTutor?.role === "online") return { name, role: "online" };
  return { name, role: null };
}

/** "Your tutor" / "Your campus tutor" / "Your online tutor" — for a notification's opening phrase. */
export function tutorPhrase(attribution: TutorAttribution | null): string {
  if (!attribution) return "Your tutor";
  if (attribution.role === "physical") return "Your campus tutor";
  if (attribution.role === "online") return "Your online tutor";
  return "Your tutor";
}

/**
 * The bulk-write version of `attributeTutorAction` — a tutor grading or
 * messaging a whole roster in one request can't send one shared "Your tutor"
 * line, because a hybrid student in that roster might resolve the same
 * lecturer as "campus" while another resolves them as "online". Groups
 * student ids by the phrase that's true for each of them, in one query
 * instead of N.
 */
export async function groupStudentsByTutorPhrase(
  studentIds: string[],
  actingLecturerId: string | null | undefined,
): Promise<Map<string, string[]>> {
  const groups = new Map<string, string[]>();
  if (!actingLecturerId || studentIds.length === 0) {
    groups.set("Your tutor", studentIds);
    return groups;
  }

  const [lecturer, students] = await Promise.all([
    prisma.lecturer.findUnique({
      where: { id: actingLecturerId },
      select: { user: { select: { name: true, email: true } } },
    }),
    prisma.student.findMany({
      where: { id: { in: studentIds } },
      select: { id: true, tutorId: true, deliveryMode: true, coTutors: { select: { lecturerId: true, role: true } } },
    }),
  ]);

  for (const student of students) {
    let role: TutorRole = null;
    if (student.deliveryMode === "hybrid") {
      if (student.tutorId === actingLecturerId) role = "physical";
      else if (student.coTutors.some((row) => row.lecturerId === actingLecturerId && row.role === "online")) role = "online";
    }
    const phrase = tutorPhrase(lecturer ? { name: lecturer.user.name || lecturer.user.email, role } : null);
    const list = groups.get(phrase) ?? [];
    list.push(student.id);
    groups.set(phrase, list);
  }

  return groups;
}
