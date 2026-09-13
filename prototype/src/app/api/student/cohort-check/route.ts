import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MONTH_NAMES, monthNameToIndex, batchFromAdmission } from "@/lib/batch";
import { readCurrentIntake, defaultBatchMonth } from "@/lib/intake-server";
import { readCohortOverride } from "@/lib/cohort-classify-server";
import { buildCountdown } from "@/lib/germany-journey";
import { recordEvent } from "@/lib/germany-journey-server";
import { sessionDurationMonths } from "@/lib/levels";

/**
 * "When did you start?" — a tick-box popup (CohortCheckMoment) for the mass
 * manual onboarding under way in September 2026. A student the office is
 * moving onto the LMS by hand has no batch month and no confirmed start date
 * until somebody tells the system — that gap is what left Oghenerukevwe
 * unsure whether her account was starting over or continuing her August
 * class, and it is also the one input the journey map's countdown
 * (germany-journey.ts) and the calendar's rotation (schedule-resolve.ts)
 * both need to draw the right picture. Ask once, in two taps, and both of
 * those already redraw themselves from `classesStartedAt` / `admission.batch`
 * — nothing downstream needed to change.
 *
 * The answer is stored exactly where the office's own /admin/cohorts
 * worklist would write one (`admission.cohortStatus`), just tagged
 * `cohortStatusBy: "student"` instead of an admin's name, so either side's
 * confirmation reads correctly (see cohort-classify.ts).
 *
 * Deliberately NOT routed through germany-journey-server's `confirmStart` —
 * that clamps the date to no earlier than the account's own `createdAt`,
 * which is exactly wrong here: the whole point is a student whose LMS
 * account is brand new even though they started classes months ago under
 * the old system.
 *
 *   GET  → { due, months } — is this worth asking (missing batch or start
 *          date, and nobody has answered yet), and which months to offer for
 *          "when did you start" (the last 12, so the tick-boxes never need
 *          free text and still reach a student well into a later level).
 *   POST { status: "new" | "ongoing", startedMonth? } → records the answer.
 *          "new" stamps the current intake batch if the student has none.
 *          "ongoing" stamps the chosen month as the batch (if none) and as
 *          classesStartedAt (only if that clock has never been set — an
 *          existing date is the real one, not this popup's approximation),
 *          and hands back the calculated finish estimate for that level so
 *          the popup can show it straight back — "you'll finish A1 around
 *          November" — the same calculation the journey map itself runs.
 */

export const dynamic = "force-dynamic";

/** The last N calendar months including this one, oldest first — the tick-box choices. */
function recentMonths(now: Date, count: number): string[] {
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(MONTH_NAMES[d.getMonth()]);
  }
  return months;
}

export async function GET() {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: {
      id: true,
      admission: true,
      classesStartedAt: true,
      user: { select: { name: true } },
    },
  });
  if (!student) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const now = new Date();
  const override = readCohortOverride(student.admission);
  const storedBatch = batchFromAdmission(student.admission);

  // Nothing to ask once a human (staff or the student) has already answered,
  // or once both anchors the rest of the system needs — the batch month and
  // the start date — are already on file. Asking again would be pure nag.
  const due = !override && (!student.classesStartedAt || !storedBatch);

  return NextResponse.json({
    due,
    months: recentMonths(now, 12),
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
    select: {
      id: true,
      level: true,
      sessionSlot: true,
      admission: true,
      classesStartedAt: true,
      user: { select: { tenantId: true } },
    },
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
      // last year — the 12-month tick-box list never offers one truly ahead
      // of now, but the wrap keeps this honest regardless.
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

  // The office's real confirmed start date always wins — this only fills in
  // a clock that has never been set, the same rule the /admin/cohorts
  // backfill script uses.
  const settingStartDate = status === "ongoing" && startedOn && !student.classesStartedAt;

  await prisma.student.update({
    where: { id: student.id },
    data: {
      admission,
      ...(settingStartDate
        ? {
            classesStartedAt: startedOn,
            startConfirmedAt: now,
            startConfirmedVia: "student",
            startPromptSnoozedUntil: null,
          }
        : {}),
    },
  });

  let finish: { level: string; endsOnLabel: string; daysLeft: number } | null = null;
  if (settingStartDate && startedOn) {
    const countdown = buildCountdown(student.level, startedOn, {
      now,
      months: sessionDurationMonths(student.sessionSlot),
    });
    finish = {
      level: student.level,
      endsOnLabel: new Date(countdown.endsOn).toLocaleString("en-US", { month: "long", year: "numeric" }),
      daysLeft: countdown.daysLeft,
    };

    await recordEvent(student.id, {
      type: "started",
      stage: "firstDay",
      label: "Told us their first day",
      detail: `${student.level} began ${startedOn.toDateString()} — self-reported during onboarding.`,
      source: "student",
      occurredAt: startedOn,
    });
  }

  return NextResponse.json({ ok: true, finish });
}
