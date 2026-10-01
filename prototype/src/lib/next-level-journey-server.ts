import { prisma } from "@/lib/prisma";
import { batchFromAdmission, monthNameToIndex } from "@/lib/batch";
import { nextPlacement } from "@/lib/graduation";
import { intakeMonthKey, startDayFor, type IntakeStartDayOverrides } from "@/lib/intake";
import { readIntakeStartDayOverrides } from "@/lib/intake-server";
import { SESSION_MONTHS, sessionDurationMonths, weeksOfTeachingFor } from "@/lib/levels";
import { DEPOSIT_RATE, isLevelSellable, requiredDepositFor, tuitionFeeFor } from "@/lib/payment";
import { loadStudentLedger } from "@/lib/tuition-charges";
import { getStudentAccess } from "@/lib/student-access";
import { zonedTimeToInstant } from "@/lib/school-time";
import { goalFor, isKnownGoal } from "@/lib/germany-goals";
import { KIND, notify } from "@/lib/notify";
import {
  buildRecap,
  cleanDetails,
  readIntent,
  resolveJourneyAudience,
  stageFor,
  type JourneyAudience,
  type NextLevelIntent,
  type Recap,
} from "@/lib/next-level-journey";

/**
 * Everything the journey needs about one student, in one place — the student's
 * page, the Becca pop and the admin pipeline all read it, so a student cannot
 * be "in the pipeline" on one screen and invisible on another.
 */

export type JourneyOffer = {
  tuitionFee: number;
  requiredDeposit: number;
  sellableOnline: boolean;
  branchName: string | null;
  weeksOfTeaching: number;
  sessionMonths: number;
  /** Still owed on a level they have ALREADY been in. Shown, never hidden. */
  priorOwed: number;
  seat: "none" | "deposit" | "full";
  /** The real opening day of the real next intake, or null when unknown. */
  opensOn: string | null;
  opensLabel: string | null;
  /** Where the pay button goes for this state. */
  payHref: string | null;
};

export type JourneyPayload = {
  audience: JourneyAudience;
  /**
   * Their portal is open right now — they have paid at least the deposit and are
   * not locked. The Becca pop, the bell and the email only go to these students;
   * a locked student is not pestered about the next level. Asked of the one
   * function that owns the paywall rule (getStudentAccess), never recomputed.
   */
  portalOpen: boolean;
  recap: Recap;
  offer: JourneyOffer;
  intent: NextLevelIntent | null;
  prefill: {
    name: string;
    phone: string;
    parentPhone: string;
    sessionSlot: string;
    deliveryMode: string;
  };
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

const studentSelect = {
  id: true,
  userId: true,
  level: true,
  levelCompletedFor: true,
  levelCompletedAt: true,
  admission: true,
  classesStartedAt: true,
  createdAt: true,
  sessionSlot: true,
  deliveryMode: true,
  pathway: true,
  germanyGoal: true,
  tenantId: true,
  branchId: true,
  branch: { select: { name: true } },
  user: { select: { name: true, email: true } },
} as const;

export type JourneyStudent = NonNullable<Awaited<ReturnType<typeof loadJourneyStudent>>>;

export async function loadJourneyStudent(where: { id?: string; userId?: string }) {
  return prisma.student.findUnique({ where: where as { id: string }, select: studentSelect });
}

/** The first date the next level can be taught, in the school's own calendar. */
function opensFor(
  student: JourneyStudent,
  audience: JourneyAudience,
  overrides: IntakeStartDayOverrides,
  now: Date,
): { opensOn: string | null; opensLabel: string | null } {
  const admission = asRecord(student.admission);

  if (audience.state === "promoted" && student.classesStartedAt) {
    return { opensOn: student.classesStartedAt.toISOString(), opensLabel: dayLabel(student.classesStartedAt) };
  }

  const place = nextPlacement({
    batch: batchFromAdmission(admission),
    sessionSlot: student.sessionSlot,
    registeredAt: student.createdAt,
    now,
    startDayOverrides: overrides,
  });
  if (!place) return { opensOn: null, opensLabel: null };

  // nextPlacement only knows the month's day; a level can open on its own day
  // (A1 Oct 5, A2–B2 Oct 12) — resolve that the same way the portal lock does.
  const monthIndex = monthNameToIndex(place.month);
  if (monthIndex === null) return { opensOn: place.startsOn.toISOString(), opensLabel: dayLabel(place.startsOn) };
  const key = intakeMonthKey(place.year, monthIndex);
  const day = startDayFor(overrides, key, audience.targetLevel);
  const startsOn = zonedTimeToInstant(`${key}-${String(day).padStart(2, "0")}`, "00:00");
  return { opensOn: startsOn.toISOString(), opensLabel: dayLabel(startsOn) };
}

function dayLabel(date: Date): string {
  return date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Lagos" });
}

/** Money state against the NEXT level's charge, from the ledger — the only source of truth. */
export async function seatAndOwed(studentId: string, targetLevel: string) {
  const ledger = await loadStudentLedger(studentId);
  const line = ledger.lines.find((l) => l.level === targetLevel) ?? null;
  const priorOwed = ledger.lines
    .filter((l) => !l.legacyArrears && l.level !== targetLevel)
    .reduce((sum, l) => sum + l.outstanding, 0);

  let seat: "none" | "deposit" | "full" = "none";
  if (line && line.net > 0 && line.allocated > 0) {
    if (line.allocated >= line.net) seat = "full";
    else if (line.allocated >= Math.round(line.net * DEPOSIT_RATE)) seat = "deposit";
  }
  return { seat, priorOwed };
}

export async function audienceFor(student: JourneyStudent, overrides: IntakeStartDayOverrides, now = new Date()) {
  const attended = await prisma.attendance.findFirst({
    where: { studentId: student.id, present: true },
    select: { id: true },
  });
  return resolveJourneyAudience({
    level: student.level,
    levelCompletedFor: student.levelCompletedFor,
    levelCompletedAt: student.levelCompletedAt,
    admission: student.admission,
    classesStartedAt: student.classesStartedAt,
    createdAt: student.createdAt,
    sessionSlot: student.sessionSlot,
    hasAttended: Boolean(attended),
    startDayOverrides: overrides,
    now,
  });
}

/** What the student actually did on the level they finished. */
export async function buildStudentRecap(student: JourneyStudent, audience: JourneyAudience): Promise<Recap> {
  const admission = asRecord(student.admission);
  const sinceRaw =
    typeof admission.classesStartedAtBeforePromotion === "string"
      ? new Date(admission.classesStartedAtBeforePromotion)
      : student.classesStartedAt ?? student.createdAt;
  const since = Number.isNaN(sinceRaw.getTime()) ? student.createdAt : sinceRaw;

  const [attendance, grades, videos, submissions, games, profile] = await Promise.all([
    prisma.attendance.findMany({
      where: { studentId: student.id, date: { gte: since } },
      select: { present: true, status: true },
    }),
    prisma.grade.findMany({
      where: { studentId: student.id, createdAt: { gte: since } },
      select: { type: true, score: true },
    }),
    prisma.videoProgress.count({ where: { studentId: student.id, completed: true } }),
    prisma.assignmentSubmission.count({
      where: { studentId: student.id, submittedAt: { gte: since } },
    }),
    prisma.quizGamePlayer.aggregate({
      where: { studentId: student.id },
      _count: { _all: true },
      _max: { bestStreak: true },
    }),
    prisma.learnerBehaviourProfile.findUnique({ where: { userId: student.userId } }),
  ]);

  const sums = new Map<string, { total: number; n: number }>();
  for (const g of grades) {
    const cur = sums.get(g.type) ?? { total: 0, n: 0 };
    cur.total += g.score;
    cur.n += 1;
    sums.set(g.type, cur);
  }
  const gradeAverages: Record<string, number> = {};
  for (const [type, { total, n }] of sums) gradeAverages[type] = total / n;

  const signals = asRecord(profile?.signals);
  const goal = isKnownGoal(student.germanyGoal) ? goalFor(student.germanyGoal) : null;
  const firstName = (student.user.name || "").trim().split(/\s+/)[0] || "";

  return buildRecap({
    state: audience.state,
    firstName,
    finishedLevel: audience.finishedLevel,
    targetLevel: audience.targetLevel,
    classesAttended: attendance.filter((a) => a.present).length,
    classesMarked: attendance.length,
    lateCount: attendance.filter((a) => a.status === "late").length,
    gradeAverages,
    gradesCount: grades.length,
    videosCompleted: videos,
    assignmentsSubmitted: submissions,
    gamesPlayed: games._count._all,
    bestGameStreak: games._max.bestStreak ?? 0,
    archetype: profile?.archetype ?? null,
    peakHour: profile?.peakHour ?? null,
    peakWeekday: profile?.peakWeekday ?? null,
    longestStreak: typeof signals.longestStreak === "number" ? signals.longestStreak : 0,
    totalMinutes: typeof signals.totalMinutes === "number" ? signals.totalMinutes : 0,
    activeDays: profile?.activeDays ?? 0,
    goalLabel: goal?.label ?? null,
    goalDestination: goal?.destination ?? null,
  });
}

export async function loadJourney(student: JourneyStudent, now = new Date()): Promise<JourneyPayload | null> {
  const overrides = await readIntakeStartDayOverrides(student.tenantId ?? null);
  const audience = await audienceFor(student, overrides, now);
  if (!audience) return null;

  const branchName = student.branch?.name ?? null;
  const target = audience.targetLevel;
  const fee = tuitionFeeFor({ level: target, branch: branchName, pathway: student.pathway });
  const [money, access] = await Promise.all([seatAndOwed(student.id, target), getStudentAccess(student.id)]);
  const opens = opensFor(student, audience, overrides, now);

  // Where "pay" goes. A signed-off student uses the next-level checkout; one the
  // graduation desk already moved up pays the ordinary checkout (their level IS
  // the target now); one whose batch just ended and has not been signed off
  // cannot pay yet — the office has to finish them first, so they hold a seat.
  // `ended` and `midway` cannot pay yet: the next-level checkout needs the
  // office's sign-off, so they keep a seat now and pay once it opens.
  const payHref =
    audience.state === "signed_off" ? "/programs?forNextLevel=1" : audience.state === "promoted" ? "/programs" : null;

  const admission = asRecord(student.admission);
  const intent = readIntent(admission, target);

  return {
    audience,
    portalOpen: access?.hasAccess === true,
    recap: await buildStudentRecap(student, audience),
    offer: {
      tuitionFee: fee,
      requiredDeposit: requiredDepositFor({ level: target, branch: branchName }),
      sellableOnline: isLevelSellable(target),
      branchName,
      weeksOfTeaching: weeksOfTeachingFor(student.sessionSlot),
      sessionMonths: sessionDurationMonths(student.sessionSlot) || SESSION_MONTHS,
      priorOwed: money.priorOwed,
      seat: money.seat,
      ...opens,
      payHref,
    },
    intent,
    prefill: {
      name: student.user.name || "",
      phone: intent?.details?.phone ?? (typeof admission.phone === "string" ? admission.phone : ""),
      parentPhone:
        intent?.details?.parentPhone ?? (typeof admission.parentPhone === "string" ? admission.parentPhone : ""),
      sessionSlot: intent?.details?.sessionSlot ?? student.sessionSlot ?? "morning",
      deliveryMode: intent?.details?.deliveryMode ?? student.deliveryMode ?? "physical",
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Their answer                                                                */
/* -------------------------------------------------------------------------- */

/** "I opened it." Idempotent, and never overwrites a later "held". */
export async function markSeen(student: JourneyStudent, targetLevel: string): Promise<void> {
  const admission = asRecord(student.admission);
  const existing = readIntent(admission, targetLevel);
  if (existing?.seenAt) return;
  const intent: NextLevelIntent = { ...(existing ?? { targetLevel }), targetLevel, seenAt: new Date().toISOString() };
  await prisma.student.update({
    where: { id: student.id },
    data: { admission: { ...admission, nextLevel: intent } as never },
  });
  await prisma.journeyEvent
    .create({
      data: {
        studentId: student.id,
        type: "registered",
        stage: targetLevel,
        label: `Opened the ${targetLevel} plan`,
        source: "student",
      },
    })
    .catch(() => undefined);
}

/**
 * "Keep my seat." Saves their details, mirrors the contact numbers onto the
 * admission record the office already reads, tells the office, and writes a
 * journey event. It does NOT change their sitting, level or timetable — a
 * requested sitting is a request the office applies, not a silent reshuffle.
 */
export async function holdSeat(
  student: JourneyStudent,
  targetLevel: string,
  rawDetails: unknown,
): Promise<NextLevelIntent> {
  const details = cleanDetails(rawDetails);
  const admission = asRecord(student.admission);
  const existing = readIntent(admission, targetLevel);
  const now = new Date().toISOString();

  const intent: NextLevelIntent = {
    ...(existing ?? { targetLevel }),
    targetLevel,
    seenAt: existing?.seenAt ?? now,
    heldAt: now,
    details: { ...(existing?.details ?? {}), ...Object.fromEntries(Object.entries(details).filter(([, v]) => v)) },
  };

  await prisma.student.update({
    where: { id: student.id },
    data: {
      admission: {
        ...admission,
        ...(intent.details?.phone ? { phone: intent.details.phone } : {}),
        ...(intent.details?.parentPhone ? { parentPhone: intent.details.parentPhone } : {}),
        nextLevel: intent,
      } as never,
    },
  });

  await prisma.journeyEvent
    .create({
      data: {
        studentId: student.id,
        type: "registered",
        stage: targetLevel,
        label: `Asked to keep a seat in ${targetLevel}`,
        detail: intent.details?.note ?? null,
        source: "student",
      },
    })
    .catch(() => undefined);

  const name = student.user.name || student.user.email;
  await notify({
    to: { audience: "admin", capability: "students" },
    kind: KIND.nextLevelHeld,
    severity: "success",
    title: `${name} wants to keep a seat in ${targetLevel}`,
    message: `${name} confirmed their details${
      intent.details?.sessionSlot ? ` and asked for the ${intent.details.sessionSlot} sitting` : ""
    }. Their contact info is updated on their record.`,
    link: "/admin/next-level",
    // One alert per student per day, however many times they re-save.
    dedupeKey: `next-level-held:${student.id}:${targetLevel}:${now.slice(0, 10)}`,
  }).catch((error) => console.error("next-level admin notify failed", error));

  return intent;
}

export { stageFor };
