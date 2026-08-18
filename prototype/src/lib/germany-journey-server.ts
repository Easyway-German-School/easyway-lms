/**
 * The database half of the road to Germany.
 *
 * `germany-journey.ts` next door is pure and renders in the browser. This file
 * is the only place that knows what a Prisma row looks like, and it exists so
 * that the map, the start prompt, the admin console and the level-advance offer
 * all read the SAME student state. Three components each deciding for
 * themselves whether a student has "started" is how a portal ends up
 * congratulating somebody on a level they are still sitting in — which is
 * precisely the bug this whole feature was built to end.
 */

import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";
import { LEVELS, nextLevelAfter } from "@/lib/levels";
import { goalFor, isKnownGoal } from "@/lib/germany-goals";
import { derivePaymentStatus, requiredDepositFor, tuitionFeeFor } from "@/lib/payment";
import {
  buildCountdown,
  buildJourney,
  buildStartPrompt,
  journeyMomentDue,
  normaliseMomentPreference,
  nextAskAfter,
  targetLevelFor,
  NOT_STARTED_ESCALATION_THRESHOLD,
  NOT_STARTED_REASONS,
  type Journey,
  type StartPrompt,
} from "@/lib/germany-journey";

/* -------------------------------------------------------------------------- */
/* Reading a student's journey                                                */
/* -------------------------------------------------------------------------- */

export type JourneyPayload = Journey & {
  /** The floor for the "which day did you start?" picker. */
  registeredAt: string;
  startPrompt: StartPrompt;
  /** Open the map by itself today? */
  momentDue: boolean;
  /** How often they have asked for it: daily, less (every 3rd day), never. */
  momentPreference: "daily" | "less" | "never";
  /**
   * Nobody has asked them why yet.
   *
   * Deliberately NOT gated on payment, unlike the once-a-day moment. The
   * question costs one tap, it is the cheapest commitment the portal ever asks
   * for, and a registrant who has just told us they are going for an
   * Ausbildung is a warmer lead than one who has only been shown a fee.
   */
  goalAskDue: boolean;
  /** How many people are standing where this student is standing. Real counts. */
  tribeStanding: TribeStanding | null;
  /** Stamps in the order they were earned — the passport page. */
  stamps: Stamp[];
};

export type Stamp = {
  id: string;
  label: string;
  detail: string | null;
  at: string;
  source: string;
};

export type TribeStanding = {
  tribe: string;
  /** Everybody who ever registered at this branch. The denominator. */
  cohortSize: number;
  /** How many are at this student's stage or beyond. */
  atOrBeyond: number;
  /** The sentence, pre-written so the client cannot spin it. */
  line: string;
};

/**
 * What the journey needs off the Student row. Kept as one select so the shape
 * is declared once and every caller gets the same fields.
 */
const JOURNEY_SELECT = {
  id: true,
  userId: true,
  level: true,
  branchId: true,
  classType: true,
  outcome: true,
  pathway: true,
  admission: true,
  createdAt: true,
  classesStartedAt: true,
  startConfirmedAt: true,
  startConfirmedVia: true,
  startPromptSnoozedUntil: true,
  notStartedCount: true,
  notStartedReason: true,
  levelCompletedAt: true,
  levelCompletedFor: true,
  journeyStages: true,
  journeySeenAt: true,
  journeyMomentPreference: true,
  germanyGoal: true,
  germanyGoalNote: true,
  germanyGoalSetAt: true,
  user: { select: { name: true } },
  branch: { select: { name: true } },
  payments: { select: { amount: true, status: true } },
} as const;

function readJson(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

/**
 * Which levels this student has finished.
 *
 * Derived from `levelCompletedFor` — the level the OFFICE signed off — plus
 * every level below it. A student sitting B1 whose file says A2 was completed
 * has plainly finished A1 too, and asking the office to tick six boxes to say
 * so would guarantee the map disagrees with reality within a week.
 */
function completedLevelsFor(levelCompletedFor: string | null, currentLevel: string): string[] {
  const levels = LEVELS as readonly string[];
  const signedOff = levels.indexOf(String(levelCompletedFor ?? "").toUpperCase());
  const current = levels.indexOf(String(currentLevel ?? "A1").toUpperCase());

  // A student promoted to B1 has, by the act of being promoted, finished A2.
  const impliedByPromotion = current - 1;
  const highest = Math.max(signedOff, impliedByPromotion);
  return highest < 0 ? [] : levels.slice(0, highest + 1);
}

export async function loadJourney(
  userId: string,
  { now = new Date() }: { now?: Date } = {},
): Promise<JourneyPayload | null> {
  const student = await prisma.student.findUnique({ where: { userId }, select: JOURNEY_SELECT });
  if (!student) return null;

  const admission = readJson(student.admission);
  const branchName = student.branch?.name ?? null;

  const totalPaid = student.payments
    .filter((payment) => payment.status === "completed")
    .reduce((sum, payment) => sum + payment.amount, 0);

  const feeLookup = { level: student.level, branch: branchName, classType: student.classType };
  const money = derivePaymentStatus({
    totalPaid,
    tuitionFee: tuitionFeeFor(feeLookup),
    requiredDeposit: requiredDepositFor(feeLookup),
  });

  // A seat is secured by the deposit, not the full fee. The school lets people
  // start on the deposit, so a map that withheld the road until the balance
  // cleared would be stricter than the school itself.
  const seatSecured = money.depositPaid;

  // If they never pressed the button but the register says they were in class,
  // the register wins and we stop asking. Nobody should have to confirm a fact
  // their own tutor already recorded.
  let classesStartedAt = student.classesStartedAt;
  if (!classesStartedAt) {
    const firstAttendance = await prisma.attendance.findFirst({
      where: { studentId: student.id, status: { in: ["present", "late"] } },
      orderBy: { date: "asc" },
      select: { date: true },
    });
    if (firstAttendance) {
      classesStartedAt = firstAttendance.date;
      await prisma.student
        .update({
          where: { id: student.id },
          data: {
            classesStartedAt: firstAttendance.date,
            startConfirmedAt: now,
            startConfirmedVia: "attendance",
            startPromptSnoozedUntil: null,
          },
        })
        .catch(() => {
          // A failed write here costs one repeated prompt, not correctness —
          // the next load recomputes it from the same register row.
        });
      await recordEvent(student.id, {
        type: "started",
        stage: "firstDay",
        label: "Marked present in class",
        detail: "Confirmed from the attendance register rather than by the student.",
        source: "attendance",
        occurredAt: firstAttendance.date,
      });
    }
  }

  const claimedStages = readJson(student.journeyStages) as Record<string, { at?: string; note?: string }>;
  const levelsCompleted = completedLevelsFor(student.levelCompletedFor, student.level);

  // Levels the office signed off get their sign-off date, so the stamp on the
  // map carries a real day rather than "at some point".
  if (student.levelCompletedFor && student.levelCompletedAt) {
    claimedStages[`level:${student.levelCompletedFor.toUpperCase()}`] = {
      at: student.levelCompletedAt.toISOString(),
    };
  }

  const targetLevel = targetLevelFor({
    outcome: student.outcome,
    pathway: student.pathway,
    admissionTarget: typeof admission.targetLevel === "string" ? admission.targetLevel : null,
    currentLevel: student.level,
    goalId: student.germanyGoal,
  });

  const journey = buildJourney({
    studentName: student.user?.name ?? "",
    branchName,
    currentLevel: student.level,
    targetLevel,
    registeredAt: student.createdAt,
    registrationPaid: totalPaid > 0,
    seatSecured,
    classesStartedAt,
    levelsCompleted,
    claimedStages,
    goalId: student.germanyGoal,
    goalNote: student.germanyGoalNote,
    now,
  });

  const startPrompt = buildStartPrompt({
    seatSecured,
    classesStartedAt,
    registeredAt: student.createdAt,
    snoozedUntil: student.startPromptSnoozedUntil,
    notStartedCount: student.notStartedCount,
    now,
  });

  const [tribeStanding, stamps] = await Promise.all([
    buildTribeStanding(journey, student.branchId),
    loadStamps(student.id),
  ]);

  return {
    ...journey,
    registeredAt: student.createdAt.toISOString(),
    startPrompt,
    momentDue: journeyMomentDue(student.journeySeenAt, student.journeyMomentPreference, now),
    momentPreference: normaliseMomentPreference(student.journeyMomentPreference),
    goalAskDue: !student.germanyGoal,
    tribeStanding,
    stamps,
  };
}

/* -------------------------------------------------------------------------- */
/* The tribe                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * "Of the 214 people who registered at Lagos, 61 have sat in a classroom."
 *
 * Real counts, always. The temptation here is to invent a flattering ratio —
 * "only 3% make it this far!" — and it would work, once. It would also be the
 * one falsifiable claim on a screen that also carries the fee table, and a
 * student who catches it stops believing the fees. Every number below is a
 * count of rows.
 */
async function buildTribeStanding(journey: Journey, branchId: string | null): Promise<TribeStanding | null> {
  if (!journey.tribe) return null;

  try {
    const where = branchId ? { branchId } : {};
    const [cohortSize, started] = await Promise.all([
      prisma.student.count({ where }),
      prisma.student.count({ where: { ...where, classesStartedAt: { not: null } } }),
    ]);

    if (cohortSize < 8) {
      // A ratio out of five people is not social proof, it is a fact about five
      // people. Below that we say nothing rather than something thin.
      return null;
    }

    const atOrBeyond = journey.awaitingStart ? cohortSize : started;
    const place = journey.branchName ?? "EasyWay";

    const line = journey.awaitingStart
      ? `${started} of the ${cohortSize} students at ${place} have already sat in their first class. The seat is the easy part.`
      : `You are one of ${started} students at ${place} who actually walked in — out of ${cohortSize} who registered.`;

    return { tribe: journey.tribe, cohortSize, atOrBeyond, line };
  } catch {
    // A count that fails must not take the map down with it.
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Stamps — the passport page                                                 */
/* -------------------------------------------------------------------------- */

async function loadStamps(studentId: string): Promise<Stamp[]> {
  try {
    const events = await prisma.journeyEvent.findMany({
      where: { studentId, type: { in: ["started", "stage-claimed", "level-completed", "level-advanced"] } },
      orderBy: { occurredAt: "asc" },
      take: 40,
      select: { id: true, label: true, detail: true, occurredAt: true, source: true },
    });
    return events.map((event) => ({
      id: event.id,
      label: event.label,
      detail: event.detail,
      at: event.occurredAt.toISOString(),
      source: event.source,
    }));
  } catch {
    return [];
  }
}

export async function recordEvent(
  studentId: string,
  event: {
    type: string;
    stage?: string | null;
    label: string;
    detail?: string | null;
    source?: string;
    occurredAt?: Date;
  },
): Promise<void> {
  try {
    await prisma.journeyEvent.create({
      data: {
        studentId,
        type: event.type,
        stage: event.stage ?? null,
        label: event.label,
        detail: event.detail ?? null,
        source: event.source ?? "student",
        occurredAt: event.occurredAt ?? new Date(),
      },
    });
  } catch (error) {
    // The log is a nice-to-have. Losing a stamp must never fail the action
    // that earned it.
    console.error("Journey event write failed", error);
  }
}

/* -------------------------------------------------------------------------- */
/* Confirming the first day                                                   */
/* -------------------------------------------------------------------------- */

export type ConfirmResult =
  | { ok: true; startedOn: string; message: string }
  | { ok: false; error: string };

/**
 * "2026-07-28" → local midnight on the 28th.
 *
 * `new Date("2026-07-28")` is parsed as UTC midnight by spec, so anywhere west
 * of Greenwich it lands on the EVENING OF THE 27TH in local time — and the
 * countdown, which works in local days, then tells a student their level
 * started the day before the one they picked and ends a day early. An `<input
 * type="date">` means a calendar day, not an instant, so it has to be read as
 * one.
 */
function parseCalendarDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (match) {
    const [, year, month, day] = match;
    const date = new Date(Number(year), Number(month) - 1, Number(day), 12, 0, 0, 0);
    // Midday, not midnight: a value stored at local midnight can slide across a
    // date boundary under a daylight-saving shift or a server on a different
    // offset, and midday survives both.
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * "Yes, I have started."
 *
 * The date is theirs to give, because a student confirming on Thursday may
 * have started on Monday, and starting their two months three days late is a
 * small unfairness they would be right to resent. It is clamped between the day
 * they registered and today: a start date before registration is a typo, and
 * one in the future is a countdown that has not begun.
 */
export async function confirmStart(
  userId: string,
  input: { startedOn?: string | null; now?: Date } = {},
): Promise<ConfirmResult> {
  const now = input.now ?? new Date();
  const student = await prisma.student.findUnique({
    where: { userId },
    select: { id: true, level: true, createdAt: true, classesStartedAt: true, branchId: true },
  });
  if (!student) return { ok: false, error: "Student not found" };

  if (student.classesStartedAt) {
    return {
      ok: true,
      startedOn: student.classesStartedAt.toISOString(),
      message: "Your start date is already recorded.",
    };
  }

  let startedOn = now;
  if (input.startedOn) {
    const parsed = parseCalendarDay(input.startedOn);
    if (!parsed) return { ok: false, error: "That date could not be read" };
    startedOn = parsed;
  }

  const floor = student.createdAt;
  if (startedOn < floor) startedOn = floor;
  if (startedOn > now) startedOn = now;

  await prisma.student.update({
    where: { id: student.id },
    data: {
      classesStartedAt: startedOn,
      startConfirmedAt: now,
      startConfirmedVia: "student",
      startPromptSnoozedUntil: null,
    },
  });

  await recordEvent(student.id, {
    type: "started",
    stage: "firstDay",
    label: "Walked into the first class",
    detail: `${student.level} began on ${startedOn.toDateString()}.`,
    source: "student",
    occurredAt: startedOn,
  });

  return {
    ok: true,
    startedOn: startedOn.toISOString(),
    message: "Your clock has started. Welcome to the Doers.",
  };
}

/**
 * "Not yet."
 *
 * Pushes the question to tomorrow and counts the answer. Crossing the
 * escalation threshold on a reason the office can act on raises it to the
 * branch ONCE — the dedupe key is what stops a student who says "not yet"
 * eleven times generating eleven identical alerts nobody then reads.
 */
export async function deferStart(
  userId: string,
  input: { reason?: string | null; now?: Date } = {},
): Promise<{ ok: boolean; askAgainOn: string; reply: string }> {
  const now = input.now ?? new Date();
  const student = await prisma.student.findUnique({
    where: { userId },
    select: { id: true, level: true, branchId: true, notStartedCount: true, user: { select: { name: true } } },
  });
  if (!student) return { ok: false, askAgainOn: nextAskAfter(now).toISOString(), reply: "" };

  const reason = NOT_STARTED_REASONS.find((item) => item.id === input.reason) ?? null;
  const askAgainOn = nextAskAfter(now);
  const count = (student.notStartedCount || 0) + 1;

  await prisma.student.update({
    where: { id: student.id },
    data: {
      startPromptSnoozedUntil: askAgainOn,
      notStartedCount: count,
      notStartedReason: reason?.id ?? input.reason ?? null,
    },
  });

  await recordEvent(student.id, {
    type: "not-yet",
    stage: "firstDay",
    label: "Not started yet",
    detail: reason?.detail ?? null,
    source: "student",
    occurredAt: now,
  });

  if (reason?.escalate && count >= NOT_STARTED_ESCALATION_THRESHOLD) {
    await notify({
      to: { audience: "admin", capability: "students" },
      title: `${student.user?.name ?? "A student"} has not started ${student.level}`,
      message: `They have told us "${reason.label}" ${count} times. Their seat is paid for and they have never sat in a class. This is a phone call, not a report.`,
      kind: "journey-stalled",
      severity: "warning",
      link: "/admin/journey",
      // Once per student per level. Eleven copies of this teaches the office to
      // scroll past the tenth.
      dedupeKey: `journey-stalled:${student.id}:${student.level}`,
    }).catch(() => {});
  }

  return { ok: true, askAgainOn: askAgainOn.toISOString(), reply: reason?.reply ?? "No problem. We will ask again tomorrow." };
}

/* -------------------------------------------------------------------------- */
/* Self-reported stages                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Which stage ids a student is allowed to stamp.
 *
 * Derived from THEIR OWN goal, not from a fixed list of four. When the roads
 * became personal this was `new Set(["exam","documents","visa","arrival"])`,
 * which would have refused a nurse's "my licence is recognised" and a student's
 * "my blocked account is funded" — the two stages those people care about most
 * — with "that stage is not yours to mark".
 */
function claimableStagesFor(goalId: string | null | undefined): Set<string> {
  return new Set(goalFor(goalId).stages.map((stage) => stage.id));
}

/**
 * The student telling us they got their visa.
 *
 * We cannot verify it and we do not pretend to. It is stored as a claim, the
 * office can see it, and the map shows it as theirs. The alternative — leaving
 * the road ending at a certificate — makes the school look like it stops caring
 * at the exam hall, which is the opposite of what it sells.
 */
export async function claimStage(
  userId: string,
  input: { stage: string; note?: string | null; undo?: boolean; now?: Date },
): Promise<{ ok: boolean; error?: string }> {
  const now = input.now ?? new Date();

  const student = await prisma.student.findUnique({
    where: { userId },
    select: {
      id: true,
      journeyStages: true,
      branchId: true,
      level: true,
      germanyGoal: true,
      user: { select: { name: true } },
    },
  });
  if (!student) return { ok: false, error: "Student not found" };

  const goal = goalFor(student.germanyGoal);
  if (!claimableStagesFor(student.germanyGoal).has(input.stage)) {
    return { ok: false, error: "That stage is not yours to mark" };
  }

  const stages = readJson(student.journeyStages);

  if (input.undo) {
    delete stages[input.stage];
  } else {
    stages[input.stage] = { at: now.toISOString(), note: input.note ?? null, status: "claimed" };
  }

  await prisma.student.update({
    where: { id: student.id },
    data: { journeyStages: stages as any },
  });

  if (!input.undo) {
    await recordEvent(student.id, {
      type: "stage-claimed",
      stage: input.stage,
      label: goal.stages.find((stage) => stage.id === input.stage)?.label ?? input.stage,
      detail: input.note ?? null,
      source: "student",
      occurredAt: now,
    });

    // Somebody landing in Germany is the single best thing that happens at this
    // school and the office should hear about it the same day.
    if (input.stage === "arrival") {
      await notify({
        to: { audience: "admin", capability: "students" },
        title: `${student.user?.name ?? "A student"} has arrived in Germany`,
        message: "They marked the last stage of their journey map. Worth a call, a photo and a post.",
        kind: "journey-arrival",
        severity: "success",
        link: "/admin/journey",
        dedupeKey: `journey-arrival:${student.id}`,
      }).catch(() => {});
    }
  }

  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Why they are learning German                                               */
/* -------------------------------------------------------------------------- */

/**
 * The answer to the one question, saved.
 *
 * Validated against the catalogue rather than trusted: an unrecognised id would
 * fall silently back to the generic road, and a student who had just told us
 * they are going into nursing would open their map to somebody else's steps and
 * conclude the portal does not listen.
 *
 * Changing a goal does NOT erase stamps. Their ids overlap across roads —
 * "exam" and "visa" mean the same thing on all of them — and a student who
 * switches from au pair to Ausbildung after passing B1 should keep the exam
 * stamp they earned. The stages that no longer exist simply stop being drawn,
 * and come back if they switch back.
 */
export async function setGermanyGoal(
  userId: string,
  input: { goalId: string; note?: string | null; now?: Date },
): Promise<{ ok: boolean; error?: string }> {
  const now = input.now ?? new Date();
  if (!isKnownGoal(input.goalId)) return { ok: false, error: "We do not know that goal" };

  const goal = goalFor(input.goalId);
  const note = input.note?.trim() ? input.note.trim().slice(0, 400) : null;

  const student = await prisma.student.findUnique({
    where: { userId },
    select: { id: true, germanyGoal: true },
  });
  if (!student) return { ok: false, error: "Student not found" };

  const changed = student.germanyGoal !== goal.id;

  await prisma.student.update({
    where: { id: student.id },
    data: { germanyGoal: goal.id, germanyGoalNote: note, germanyGoalSetAt: now },
  });

  // Worth a line in their story: the day they said out loud what this is for.
  // Not on every save, though — re-confirming the same goal is not an event.
  if (changed) {
    await recordEvent(student.id, {
      type: "goal-set",
      stage: null,
      label: goal.label,
      detail: note,
      source: "student",
      occurredAt: now,
    });
  }

  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* The once-a-day moment                                                      */
/* -------------------------------------------------------------------------- */

export async function markMomentSeen(
  userId: string,
  preference?: unknown,
  now = new Date(),
): Promise<void> {
  // The stamp and the preference are written together, because they are set by
  // the same tap: closing the map IS the answer to "how often should this
  // open?". Two round trips would let a student pick "show less" and still
  // meet it tomorrow if the second one failed.
  await prisma.student.updateMany({
    where: { userId },
    data: {
      journeySeenAt: now,
      ...(preference === undefined
        ? {}
        : { journeyMomentPreference: normaliseMomentPreference(preference) }),
    },
  });
}

/* -------------------------------------------------------------------------- */
/* The office's mass trigger                                                  */
/* -------------------------------------------------------------------------- */

export type CohortFilter = {
  branchId?: string | null;
  level?: string | null;
  batch?: string | null;
  sessionSlot?: string | null;
};

export type CohortMember = {
  studentId: string;
  name: string;
  email: string;
  studentCode: string | null;
  level: string;
  batch: string | null;
  sessionSlot: string;
  branchName: string | null;
  /** ISO, or null where they never confirmed. */
  classesStartedAt: string | null;
  startConfirmedVia: string | null;
  notStartedCount: number;
  notStartedReason: string | null;
  /** Days into their two months. Null before they start. */
  daysElapsed: number | null;
  percent: number | null;
  levelCompletedFor: string | null;
  paymentStatus: string;
  outstanding: number;
};

/**
 * Who is in a batch, and where each of them has got to.
 *
 * This is the screen the office works from when a batch finishes. It carries
 * the two facts that decide whether somebody can be moved up — did they ever
 * start, and do they still owe — because those are the two the branch would
 * otherwise have to look up one student at a time.
 */
export async function listCohort(filter: CohortFilter, now = new Date()): Promise<CohortMember[]> {
  const students = await prisma.student.findMany({
    where: {
      status: "active",
      ...(filter.branchId ? { branchId: filter.branchId } : {}),
      ...(filter.level ? { level: filter.level.toUpperCase() } : {}),
      ...(filter.sessionSlot ? { sessionSlot: filter.sessionSlot } : {}),
    },
    select: {
      id: true,
      level: true,
      sessionSlot: true,
      classType: true,
      admission: true,
      classesStartedAt: true,
      startConfirmedVia: true,
      notStartedCount: true,
      notStartedReason: true,
      levelCompletedFor: true,
      studentCode: true,
      user: { select: { name: true, email: true } },
      branch: { select: { name: true } },
      payments: { select: { amount: true, status: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const wantedBatch = filter.batch ? filter.batch.trim().toLowerCase() : null;
  const rows: CohortMember[] = [];

  for (const student of students) {
    const admission = readJson(student.admission);
    const batch = typeof admission.batch === "string" && admission.batch.trim() ? admission.batch.trim() : null;
    if (wantedBatch && (batch ?? "").toLowerCase() !== wantedBatch) continue;

    const branchName = student.branch?.name ?? null;
    const totalPaid = student.payments
      .filter((payment) => payment.status === "completed")
      .reduce((sum, payment) => sum + payment.amount, 0);
    const feeLookup = { level: student.level, branch: branchName, classType: student.classType };
    const tuitionFee = tuitionFeeFor(feeLookup);
    const money = derivePaymentStatus({ totalPaid, tuitionFee, requiredDeposit: requiredDepositFor(feeLookup) });

    let daysElapsed: number | null = null;
    let percent: number | null = null;
    if (student.classesStartedAt) {
      const countdown = buildCountdown(student.level, student.classesStartedAt, { now });
      daysElapsed = countdown.daysElapsed;
      percent = countdown.percent;
    }

    rows.push({
      studentId: student.id,
      name: student.user?.name ?? "Unknown",
      email: student.user?.email ?? "",
      studentCode: student.studentCode,
      level: student.level,
      batch,
      sessionSlot: student.sessionSlot,
      branchName,
      classesStartedAt: student.classesStartedAt?.toISOString() ?? null,
      startConfirmedVia: student.startConfirmedVia,
      notStartedCount: student.notStartedCount,
      notStartedReason: student.notStartedReason,
      daysElapsed,
      percent,
      levelCompletedFor: student.levelCompletedFor,
      paymentStatus: money.status,
      outstanding: Math.max(0, tuitionFee - totalPaid),
    });
  }

  // Furthest through first — that is the order somebody signing off a batch
  // wants to read it in.
  return rows.sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1));
}

export type CompleteResult = {
  completed: string[];
  skipped: Array<{ studentId: string; reason: string }>;
};

/**
 * "This batch has finished."
 *
 * THE ONLY THING that makes the "your level is complete, here is the next one"
 * offer appear. It used to be derived from the batch month, which fired at a
 * student who had signed up eleven days earlier and never attended — the
 * portal congratulating somebody on a level they had not started is worse than
 * saying nothing at all, because it proves the portal is not watching.
 *
 * So the school says when a level is finished. A human being who was in the
 * room. That is the whole point of the super admin holding this.
 */
export async function completeLevelForStudents(
  studentIds: string[],
  opts: { now?: Date; announce?: boolean } = {},
): Promise<CompleteResult> {
  const now = opts.now ?? new Date();
  const result: CompleteResult = { completed: [], skipped: [] };

  const students = await prisma.student.findMany({
    where: { id: { in: studentIds } },
    select: { id: true, level: true, levelCompletedFor: true, classesStartedAt: true },
  });
  const byId = new Map(students.map((student) => [student.id, student]));

  for (const studentId of studentIds) {
    const student = byId.get(studentId);
    if (!student) {
      result.skipped.push({ studentId, reason: "Student not found" });
      continue;
    }
    if (student.levelCompletedFor === student.level) {
      result.skipped.push({ studentId, reason: `${student.level} is already signed off` });
      continue;
    }

    await prisma.student.update({
      where: { id: studentId },
      data: {
        levelCompletedAt: now,
        levelCompletedFor: student.level,
        // A student who never confirmed a start date but whose level the office
        // has just signed off plainly did attend. Backfilling it keeps their map
        // honest instead of showing a road that stops at "first day".
        ...(student.classesStartedAt
          ? {}
          : {
              classesStartedAt: new Date(now.getFullYear(), now.getMonth() - 2, now.getDate()),
              startConfirmedAt: now,
              startConfirmedVia: "admin",
              startPromptSnoozedUntil: null,
            }),
      },
    });

    await recordEvent(studentId, {
      type: "level-completed",
      stage: `level:${student.level}`,
      label: `Finished ${student.level}`,
      detail: "Signed off by the school.",
      source: "admin",
      occurredAt: now,
    });

    result.completed.push(studentId);
  }

  if (opts.announce !== false && result.completed.length > 0) {
    await notify({
      to: { studentIds: result.completed },
      title: "Your level is complete",
      message:
        "Your school has signed off this level. Open your journey map to see your stamp and what comes next.",
      kind: "level-complete",
      severity: "success",
      link: "/dashboard",
      push: true,
      dedupeKey: `level-complete:${now.toISOString().slice(0, 10)}`,
    }).catch((error) => {
      console.error("Level-complete announcement failed", error);
    });
  }

  return result;
}

export { nextLevelAfter };
