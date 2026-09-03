/**
 * Releasing an exam sitting's results — the shared core, plus the two cron
 * passes that mean a tutor no longer has to remember to do it.
 *
 * The complaint this answers: parents wait days for results because releasing
 * them is a manual toggle in the gradebook and nothing chases the tutor.
 *
 *   setExamResultsReleased()  — the one place that flips the flag and tells
 *                               students, THEIR PARENTS, and the office. Both
 *                               the manual gradebook toggle and the auto sweep
 *                               call it, so the two can never notify differently.
 *   autoReleaseDueResults()   — mock sittings that are fully marked and past
 *                               their tenant's delay release themselves.
 *   nudgeUnreleasedResults()  — the fallback: a sitting with marks in it but
 *                               nothing released gets the tutor (and, if it
 *                               drags, the office) a poke, at most once a day.
 */

import { prisma } from "@/lib/prisma";
import { KIND, notify } from "@/lib/notify";
import { resultAutoReleaseConfig } from "@/lib/result-settings";

const DAY = 86_400_000;

type ExamForRelease = {
  id: string;
  name: string;
  level: string | null;
  branchId: string | null;
  resultsReleased: boolean;
  lecturer: { userId: string; user: { name: string | null } | null } | null;
};

/**
 * The students this sitting is FOR: whoever has an explicit registration, or —
 * a mock has none — the whole active class at that level and branch.
 */
async function classStudentIds(exam: {
  id: string;
  level: string | null;
  branchId: string | null;
}): Promise<string[]> {
  const registered = await prisma.examRegistration.findMany({
    where: { examId: exam.id, status: "registered", studentId: { not: null } },
    select: { studentId: true },
  });
  if (registered.length) {
    return [...new Set(registered.map((r) => r.studentId).filter((id): id is string => Boolean(id)))];
  }
  if (!exam.level) return [];
  const students = await prisma.student.findMany({
    where: {
      status: "active",
      level: exam.level,
      ...(exam.branchId ? { branchId: exam.branchId } : {}),
    },
    select: { id: true },
  });
  return students.map((s) => s.id);
}

export type ReleaseResult = {
  released: boolean;
  studentsNotified: number;
  parentsNotified: number;
};

/**
 * Set (or clear) a sitting's released flag and, on release, notify everyone who
 * should know. A no-op notification-wise when `released` is false — hiding
 * results back is a quiet correction, not an announcement.
 */
export async function setExamResultsReleased(
  examId: string,
  released: boolean,
  { auto = false }: { auto?: boolean } = {},
): Promise<ReleaseResult> {
  const exam = (await prisma.exam.findUnique({
    where: { id: examId },
    select: {
      id: true,
      name: true,
      level: true,
      branchId: true,
      resultsReleased: true,
      lecturer: { select: { userId: true, user: { select: { name: true } } } },
    },
  })) as ExamForRelease | null;
  if (!exam) return { released: false, studentsNotified: 0, parentsNotified: 0 };

  await prisma.exam.update({
    where: { id: exam.id },
    data: {
      resultsReleased: released,
      resultsReleasedAt: released ? new Date() : null,
    },
  });

  if (!released) return { released: false, studentsNotified: 0, parentsNotified: 0 };

  const graded = await prisma.grade.findMany({
    where: { examId: exam.id },
    select: { studentId: true },
  });
  const studentIds = [...new Set(graded.map((row) => row.studentId))];
  if (studentIds.length === 0) {
    return { released: true, studentsNotified: 0, parentsNotified: 0 };
  }

  const opener = auto
    ? "Your results have been released."
    : "Your tutor has released this exam's results.";

  const studentResult = await notify({
    to: { studentIds },
    kind: KIND.resultPublished,
    severity: "info",
    title: `${exam.name} results are out`,
    message: `${opener} Open your results to see your score.`,
    link: "/results",
    push: true,
    dedupeKey: `result-release:${exam.id}`,
  }).catch((error) => {
    console.error("result release: student notify failed", error);
    return null;
  });

  // NEW: the guardians. A student with two linked parents reaches both; one
  // nobody has linked reaches no one, silently — that is correct.
  const parentResult = await notify({
    to: { parentsOfStudentIds: studentIds },
    kind: KIND.resultPublished,
    severity: "info",
    title: `${exam.name} results are out`,
    message: `Results for ${exam.name} have been released. Your child can see the full breakdown in their portal.`,
    link: "/parent",
    push: true,
    dedupeKey: `result-release-parent:${exam.id}`,
  }).catch((error) => {
    console.error("result release: parent notify failed", error);
    return null;
  });

  const tutorName = exam.lecturer?.user?.name;
  await notify({
    to: { audience: "admin", capability: "exams" },
    kind: KIND.resultPublished,
    severity: "info",
    title: `${exam.name} results released`,
    message:
      `${auto ? "Released automatically" : tutorName ? `${tutorName} released` : "Released"} ${exam.name}` +
      `${exam.level ? ` (${exam.level})` : ""} — ${studentIds.length} student${studentIds.length === 1 ? "" : "s"} graded.`,
    link: "/admin/gradebook",
    dedupeKey: `result-release-office:${exam.id}`,
  }).catch((error) => console.error("result release: office notify failed", error));

  return {
    released: true,
    studentsNotified: studentResult?.created ?? 0,
    parentsNotified: parentResult?.created ?? 0,
  };
}

export type AutoReleaseResult = { considered: number; released: string[] };

/**
 * Mock sittings that are past their tenant's delay AND fully marked release
 * themselves. Restricted to `kind: "mock"` on purpose — a formal ÖSD/telc
 * sitting's visibility is a decision staff make deliberately, not one a cron
 * should make for them.
 */
export async function autoReleaseDueResults(): Promise<AutoReleaseResult> {
  const candidates = await prisma.exam.findMany({
    where: {
      kind: "mock",
      resultsReleased: false,
      examDate: { lt: new Date() },
      grades: { some: {} },
    },
    select: { id: true, level: true, branchId: true, examDate: true, tenantId: true },
  });

  const released: string[] = [];
  const configByTenant = new Map<string, Awaited<ReturnType<typeof resultAutoReleaseConfig>>>();

  for (const exam of candidates) {
    const tenantKey = exam.tenantId ?? "__none__";
    let config = configByTenant.get(tenantKey);
    if (!config) {
      config = await resultAutoReleaseConfig(exam.tenantId);
      configByTenant.set(tenantKey, config);
    }
    if (!config.enabled) continue;
    if (exam.examDate.getTime() > Date.now() - config.delayDays * DAY) continue;

    const expected = await classStudentIds(exam);
    if (expected.length === 0) continue;
    const gradedRows = await prisma.grade.findMany({
      where: { examId: exam.id, studentId: { in: expected } },
      select: { studentId: true },
    });
    const gradedSet = new Set(gradedRows.map((row) => row.studentId));
    if (!expected.every((id) => gradedSet.has(id))) continue; // not fully marked

    const result = await setExamResultsReleased(exam.id, true, { auto: true });
    if (result.released) released.push(exam.id);
  }

  return { considered: candidates.length, released };
}

export type UnreleasedSitting = {
  id: string;
  name: string;
  level: string | null;
  tutorUserId: string | null;
  expected: number;
  graded: number;
  fullyGraded: boolean;
  daysSinceExam: number;
};

/**
 * Every mock sitting in the last two weeks that has marks in it but has not
 * been released — the set `nudgeUnreleasedResults` acts on, exposed so the
 * admin assistant can preview it before proposing to chase the tutors.
 */
export async function findUnreleasedSittings(): Promise<UnreleasedSitting[]> {
  const now = Date.now();
  const exams = await prisma.exam.findMany({
    where: {
      kind: "mock",
      resultsReleased: false,
      examDate: { gte: new Date(now - 14 * DAY), lte: new Date() },
      grades: { some: {} },
    },
    select: {
      id: true,
      name: true,
      level: true,
      branchId: true,
      examDate: true,
      lecturer: { select: { userId: true } },
    },
  });

  const out: UnreleasedSitting[] = [];
  for (const exam of exams) {
    const expected = await classStudentIds(exam);
    if (expected.length === 0) continue;
    const gradedRows = await prisma.grade.findMany({
      where: { examId: exam.id, studentId: { in: expected } },
      select: { studentId: true },
    });
    const gradedSet = new Set(gradedRows.map((r) => r.studentId));
    out.push({
      id: exam.id,
      name: exam.name,
      level: exam.level,
      tutorUserId: exam.lecturer?.userId ?? null,
      expected: expected.length,
      graded: gradedSet.size,
      fullyGraded: expected.every((id) => gradedSet.has(id)),
      daysSinceExam: Math.floor((now - exam.examDate.getTime()) / DAY),
    });
  }
  return out;
}

export type NudgeResult = { nudged: number };

/**
 * The fallback. A mock in the last two weeks with at least one mark but nothing
 * released gets the tutor a poke — "finish marking" if it is partial, "results
 * go out in N days, or release now" if it is complete but still inside the
 * delay. If it has been graded and sitting for over five days, the office is
 * copied. Deduped per exam per day. `only` limits it to a chosen set of exam
 * ids (the assistant action passes the ids it previewed).
 */
export async function nudgeUnreleasedResults(only?: string[]): Promise<NudgeResult> {
  const today = new Date().toISOString().slice(0, 10);
  const wanted = only && only.length ? new Set(only) : null;
  const sittings = (await findUnreleasedSittings()).filter((s) => !wanted || wanted.has(s.id));

  let nudged = 0;

  for (const exam of sittings) {
    if (!exam.tutorUserId) continue;

    const { expected, graded, fullyGraded, daysSinceExam } = exam;

    const message = fullyGraded
      ? `Every student in your ${exam.level ?? ""} ${exam.name} is marked. Results release to them automatically soon — or open the gradebook to release now, or hold them back.`
          .replace(/\s+/g, " ")
          .trim()
      : `${graded} of ${expected} students marked for ${exam.name}. Finish the gradebook and results go out on their own.`;

    const result = await notify({
      to: { userIds: [exam.tutorUserId] },
      kind: KIND.resultReleaseNudge,
      severity: "info",
      title: `Results waiting: ${exam.name}`,
      message,
      link: "/lecturer/gradebook",
      push: true,
      dedupeKey: `release-nudge:${exam.id}:${today}`,
    }).catch((error) => {
      console.error(`result release nudge failed for exam ${exam.id}`, error);
      return null;
    });
    nudged += result?.created ?? 0;

    if (daysSinceExam >= 5) {
      await notify({
        to: { audience: "admin", capability: "exams" },
        kind: KIND.resultReleaseNudge,
        severity: "warning",
        title: `${exam.name} results still not out`,
        message:
          `${exam.name}${exam.level ? ` (${exam.level})` : ""} sat ${daysSinceExam} days ago and results are ` +
          `${fullyGraded ? "marked but unreleased" : `only ${graded}/${expected} marked`}.`,
        link: "/admin/gradebook",
        dedupeKey: `release-nudge-office:${exam.id}:${today}`,
      }).catch((error) => console.error(`result release office nudge failed for exam ${exam.id}`, error));
    }
  }

  return { nudged };
}
