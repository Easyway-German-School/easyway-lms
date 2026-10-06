import { prisma } from "@/lib/prisma";
import { assignStudentCode, realignStudentCode } from "@/lib/student-code";

/**
 * Self-heals any student who slipped through signup or the admin add form
 * without a student code.
 *
 * Code assignment at signup and on manual add is deliberately best-effort —
 * see the try/catch around `assignStudentCode` in both routes — because a
 * transient failure there (a dropped connection, a `findUnique` racing the
 * write it just made) must never cost someone their account. The trade-off is
 * that a failure was previously silent forever: nothing ever looked again, so
 * "NO STUDENT ID ISSUED" stuck to a student until an admin noticed the gap and
 * someone ran `scripts/backfill-student-codes.mjs` by hand.
 *
 * Wired into the cron dispatcher (`/api/cron/tick`) so the gap closes itself
 * within the hour instead of waiting on a person to notice and run a script.
 */
export async function backfillMissingStudentCodes(limit = 100) {
  const students = await prisma.student.findMany({
    where: { studentCode: null },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true,
      level: true,
      classType: true,
      admission: true,
      branch: { select: { name: true, mode: true } },
    },
  });

  let assigned = 0;
  const failed: string[] = [];

  for (const student of students) {
    const batch = (student.admission as { batch?: unknown } | null)?.batch;
    const code = await assignStudentCode(student.id, {
      level: student.level,
      batch,
      branch: student.branch,
      classType: student.classType,
    });
    if (code) assigned += 1;
    else failed.push(student.id);
  }

  return { checked: students.length, assigned, failed: failed.length };
}

/**
 * Keeps the month in every not-yet-started student's code equal to their
 * intake — the "signed up in September for October but the ID says SEP" case.
 * Only students registered in the last 120 days can still be waiting on an
 * intake, so the sweep stays small. Frozen once the batch begins.
 */
export async function realignUpcomingIntakeCodes() {
  const since = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);
  const students = await prisma.student.findMany({
    where: { studentCode: { not: null }, createdAt: { gte: since } },
    select: { id: true, studentCode: true, admission: true, createdAt: true },
  });

  let realigned = 0;
  for (const student of students) {
    try {
      if (await realignStudentCode(student)) realigned += 1;
    } catch (error) {
      console.error("Student code realign failed", student.id, error);
    }
  }
  return { checked: students.length, realigned };
}
