import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MONTH_NAMES, monthNameToIndex, batchFromAdmission } from "@/lib/batch";
import { readCurrentIntake, defaultBatchMonth } from "@/lib/intake-server";
import { classifyCohortStatus } from "@/lib/cohort-classify";
import { readCohortOverride } from "@/lib/cohort-classify-server";

/**
 * "Which one are you?" — a tick-box popup (CohortCheckMoment) for the mass
 * manual onboarding under way in September 2026. The office is moving
 * students onto the LMS in bulk, and a new signup and a returning student
 * finishing their level look identical to the system unless somebody says
 * which they are — that gap is what left Oghenerukevwe unsure whether her
 * account was starting over or continuing her August class.
 *
 * This reuses the same read-only classifier the /admin/cohorts worklist is
 * built on (see cohort-classify.ts / cohort-classify-server.ts) so the popup
 * only bothers a student whose account is genuinely ambiguous or contradicts
 * itself — a confidently "new" or "ongoing" account with no mismatch is left
 * alone. The answer is stored exactly where the office's own worklist writes
 * one (`admission.cohortStatus`), just tagged `cohortStatusBy: "student"`
 * instead of an admin's name, so either side can confirm it and the other
 * reads it straight.
 *
 *   GET  → { due, months } — is this worth asking, and which months to offer
 *          for "when did you start" (always the last 4 including this one, so
 *          the tick-boxes never need free text).
 *   POST { status: "new" | "ongoing", startedMonth? } → records the answer.
 *          "new" stamps the current intake batch if the student has none.
 *          "ongoing" stamps the chosen month as the batch (if none) and as
 *          classesStartedAt (only if that clock has never been set — an
 *          existing date is the real one, not the office's fallback).
 */

export const dynamic = "force-dynamic";

async function currentStudent(userId: string | undefined) {
  if (!userId) return null;
  return prisma.student.findUnique({
    where: { userId },
    select: {
      id: true,
      level: true,
      admission: true,
      createdAt: true,
      classesStartedAt: true,
      levelCompletedFor: true,
      user: { select: { tenantId: true, name: true } },
    },
  });
}

/** The last 4 calendar months including this one, oldest first — the tick-box choices. */
function recentMonths(now: Date): string[] {
  const months: string[] = [];
  for (let i = 3; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(MONTH_NAMES[d.getMonth()]);
  }
  return months;
}

export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await currentStudent(session.user.id);
  if (!student) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const now = new Date();
  const override = readCohortOverride(student.admission);

  if (override) {
    return NextResponse.json({ due: false, months: recentMonths(now) });
  }

  const currentIntake = await readCurrentIntake(student.user?.tenantId ?? null);

  const [attendance, grade, submission, quest, enrolments, started] = await Promise.all([
    prisma.attendance.aggregate({
      where: { studentId: student.id, status: { in: ["present", "late"] } },
      _min: { date: true },
      _count: { _all: true },
    }),
    prisma.grade.aggregate({ where: { studentId: student.id }, _min: { createdAt: true }, _count: { _all: true } }),
    prisma.assignmentSubmission.aggregate({
      where: { studentId: student.id, submittedAt: { not: null } },
      _min: { submittedAt: true },
      _count: { _all: true },
    }),
    prisma.materialQuestAttempt.aggregate({
      where: { studentId: student.id },
      _min: { createdAt: true },
      _count: { _all: true },
    }),
    prisma.studentEnrolment.findMany({
      where: { studentId: student.id, deletedAt: null },
      select: { outcome: true, startedAt: true, batchMonth: true },
    }),
    prisma.journeyEvent.aggregate({
      where: { studentId: student.id, type: "started" },
      _min: { occurredAt: true },
    }),
  ]);

  const priorEnrolmentsCompleted = enrolments.filter(
    (e) => e.outcome === "completed" || e.outcome === "transferred",
  ).length;
  const openEnrolment = enrolments.find((e) => e.outcome === "ongoing") ?? null;
  const classworkCount =
    (grade._count._all ?? 0) + (submission._count._all ?? 0) + (quest._count._all ?? 0);

  const classification = classifyCohortStatus({
    registeredAt: student.createdAt,
    storedBatch: batchFromAdmission(student.admission),
    level: student.level,
    classesStartedAt: student.classesStartedAt,
    levelCompletedFor: student.levelCompletedFor,
    firstAttendanceAt: attendance._min.date ?? null,
    attendanceCount: attendance._count._all ?? 0,
    firstGradeAt: grade._min.createdAt ?? null,
    firstSubmissionAt: submission._min.submittedAt ?? null,
    firstQuestAt: quest._min.createdAt ?? null,
    classworkCount,
    priorEnrolmentsCompleted,
    currentEnrolmentStartedAt: openEnrolment?.startedAt ?? null,
    currentEnrolmentBatchMonth: openEnrolment?.batchMonth ?? null,
    journeyStartedAt: started._min.occurredAt ?? null,
    currentIntake,
    now,
    officeOverride: null,
  });

  // A confidently-known, consistent account has nothing to ask about — this
  // is for the ambiguous or self-contradicting ones, exactly the population
  // the manual onboarding push is creating.
  const due = classification.confidence !== "high" || Boolean(classification.mismatch);

  return NextResponse.json({
    due,
    months: recentMonths(now),
    firstName: (student.user?.name ?? "").trim().split(/\s+/)[0] || null,
  });
}

export async function POST(req: NextRequest) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const status = body?.status === "ongoing" ? "ongoing" : body?.status === "new" ? "new" : null;
  const startedMonthRaw = typeof body?.startedMonth === "string" ? body.startedMonth : "";

  if (!status) {
    return NextResponse.json({ error: "Choose which one describes you." }, { status: 400 });
  }

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: { id: true, admission: true, classesStartedAt: true, user: { select: { tenantId: true } } },
  });
  if (!student) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const admission: Record<string, unknown> =
    student.admission && typeof student.admission === "object"
      ? { ...(student.admission as Record<string, unknown>) }
      : {};

  const now = new Date();
  admission.cohortStatus = status;
  admission.cohortStatusAt = now.toISOString();
  admission.cohortStatusBy = "student";

  let monthName: string | null = null;
  let startedOn: Date | null = null;

  if (status === "ongoing") {
    const monthIndex = monthNameToIndex(startedMonthRaw);
    if (monthIndex !== null) {
      monthName = MONTH_NAMES[monthIndex];
      // A picked month that reads as "in the future" this year actually means
      // last year — nobody is offered a month ahead of the current one, but
      // the wrap keeps this honest if the clock ever disagrees with the tick-box list.
      let year = now.getFullYear();
      if (monthIndex > now.getMonth()) year -= 1;
      startedOn = new Date(year, monthIndex, 1);
      admission.cohortStatusStartedOn = startedOn.toISOString();
    }
  }

  if (!admission.batch) {
    if (status === "new") {
      admission.batch = await defaultBatchMonth(student.user?.tenantId ?? null);
    } else if (monthName) {
      admission.batch = monthName;
    }
  }

  await prisma.student.update({
    where: { id: student.id },
    data: {
      admission,
      // The office's real confirmed start date always wins — this only fills
      // in a clock that has never been set, the same rule the /admin/cohorts
      // backfill uses.
      ...(status === "ongoing" && startedOn && !student.classesStartedAt
        ? { classesStartedAt: startedOn }
        : {}),
    },
  });

  return NextResponse.json({ ok: true });
}
