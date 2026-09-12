/**
 * Is this student STARTING a batch, or already MID-COURSE?
 *
 * The office needs to know, because the two get different treatment: a new
 * student's `admission.batch` should be the current intake and their journey
 * clock has not started; an ongoing student's batch is whatever month they
 * actually walked in, months ago, and stamping the current intake onto them
 * resets their timetable rotation and their countdown. Getting that wrong in
 * bulk is how the roster data broke before.
 *
 * "new vs ongoing" is not a field anyone types. It is a reading of signals the
 * school already has — an attendance row, a marked essay, a completed level,
 * an enrolment-history row. This module is the reading. It writes NOTHING; it
 * hands the office a status, the evidence behind it, and a flag when the
 * stored batch month disagrees with the evidence. A human still decides.
 *
 * Pure — no prisma, no dates fetched here. `cohort-classify-server.ts` next
 * door does the database half and feeds this the primitives, exactly the way
 * germany-journey.ts / germany-journey-server.ts are split.
 */

import { MONTH_NAMES, monthNameToIndex, resolveBatchWindow } from "@/lib/batch";
import { LEVELS } from "@/lib/levels";

export type CohortStatus =
  /** Fresh account this intake, nothing done yet — the current-intake default is right. */
  | "new"
  /** Mid-course: has attended, been marked, or otherwise has classwork behind them. */
  | "ongoing"
  /** Ongoing AND has finished at least one level with us before — continuing, not starting. */
  | "returning"
  /** No signal either way. Could be a pre-attendance ongoing student, could be a no-show. */
  | "unknown";

export type CohortConfidence = "high" | "medium" | "low";

/** Everything the classifier needs, all primitives — the server half fills these in. */
export type CohortSignals = {
  /** Student.createdAt. */
  registeredAt: Date | string | null;
  /** admission.batch — the stored month name, or null. */
  storedBatch: string | null;
  /** Student.level. */
  level: string;
  /** Student.classesStartedAt — the journey clock anchor, null until confirmed. */
  classesStartedAt: Date | string | null;
  /** Student.levelCompletedFor — the level the office has signed off, or null. */
  levelCompletedFor: string | null;

  /** Earliest present/late attendance date, or null. */
  firstAttendanceAt: Date | string | null;
  attendanceCount: number;

  /** Earliest of each kind of classwork, or null. */
  firstGradeAt: Date | string | null;
  firstSubmissionAt: Date | string | null;
  firstQuestAt: Date | string | null;
  /** grades + submitted assignments + material quest attempts. */
  classworkCount: number;

  /** StudentEnrolment rows with outcome completed|transferred. */
  priorEnrolmentsCompleted: number;
  /** The open enrolment's startedAt / batchMonth, when the history table has a row. */
  currentEnrolmentStartedAt: Date | string | null;
  currentEnrolmentBatchMonth: string | null;

  /** Earliest JourneyEvent of type "started", or null. */
  journeyStartedAt: Date | string | null;

  /** The school's current intake — a new student registered into this. */
  currentIntake: { month: string; year: number };
  now?: Date;

  /**
   * An office decision that beats the evidence — set from the /admin/cohorts
   * worklist when a human confirms what a quiet, ambiguous account actually is.
   * Stored on `admission.cohortStatus`. Once set, this IS the answer; the
   * signals above are still read only so the mismatch flag can catch a stored
   * batch month that contradicts the confirmed start.
   */
  officeOverride?: {
    status: "new" | "ongoing" | "returning";
    /** The month the office says they started, for an "ongoing" confirmation. */
    startedOn?: Date | string | null;
    setAt?: Date | string | null;
    /** Who set it — a student's own tick-box answer reads differently to the office's. Defaults to "office" wording. */
    by?: "student" | "admin" | string | null;
  } | null;
};

export type CohortClassification = {
  status: CohortStatus;
  confidence: CohortConfidence;
  /** Short human-readable lines, most telling first. Shown on hover in the console. */
  evidence: string[];
  /**
   * The day the classifier believes this level's clock should run from — for a
   * later `classesStartedAt` backfill. Null when there is nothing honest to
   * anchor on. NEVER applied here.
   */
  suggestedStartedAt: string | null;
  /**
   * The batch month the evidence points at, when it points anywhere. Advisory
   * only — the office still picks the month in the UI. Null unless we are
   * fairly sure.
   */
  suggestedBatch: string | null;
  /**
   * Set when the STORED batch month contradicts the evidence — "sits in the
   * September batch but first attended in June", "still in a batch that ended
   * months ago but looks brand new". The one line the office acts on.
   */
  mismatch: string | null;
  /** True when a human confirmed this from the worklist, not the signals. */
  officeConfirmed: boolean;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function earliest(dates: Array<Date | string | null | undefined>): Date | null {
  let best: Date | null = null;
  for (const raw of dates) {
    const date = toDate(raw);
    if (date && (!best || date < best)) best = date;
  }
  return best;
}

function daysAgo(date: Date, now: Date): number {
  return Math.floor((now.getTime() - date.getTime()) / MS_PER_DAY);
}

function monthLabel(date: Date): string {
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

/** year*12 + monthIndex, so month arithmetic wraps years for free. */
function absoluteMonth(year: number, monthIndex: number): number {
  return year * 12 + monthIndex;
}

const OVERRIDE_STATUSES = new Set(["new", "ongoing", "returning"]);

export function classifyCohortStatus(signals: CohortSignals): CohortClassification {
  const now = signals.now ?? new Date();
  const registeredAt = toDate(signals.registeredAt);

  // An office decision beats the evidence. Everything below is skipped — but
  // the mismatch check still runs, so a stored batch that contradicts the
  // confirmed start still surfaces.
  const override = signals.officeOverride;
  if (override && OVERRIDE_STATUSES.has(override.status)) {
    const midCourse = override.status === "ongoing" || override.status === "returning";
    const startedOn = midCourse
      ? toDate(override.startedOn) ?? toDate(signals.classesStartedAt)
      : null;
    const setAt = toDate(override.setAt);
    const suggestedStartedAt = startedOn ? startedOn.toISOString() : null;
    const confirmedBy = override.by === "student" ? "Confirmed by you" : "Confirmed by the office";

    const suggestedBatch = midCourse
      ? signals.currentEnrolmentBatchMonth ??
        (!signals.storedBatch && startedOn ? MONTH_NAMES[startedOn.getMonth()] : null)
      : null;

    return {
      status: override.status,
      confidence: "high",
      evidence: [`${confirmedBy}${setAt ? ` ${monthLabel(setAt)}` : ""}`],
      suggestedStartedAt,
      suggestedBatch,
      mismatch: detectMismatch({
        signals,
        status: override.status,
        suggestedStartedAt,
        hasAttendance: toDate(signals.firstAttendanceAt) !== null || signals.attendanceCount > 0,
        classwork: Math.max(0, signals.classworkCount || 0),
        now,
        registeredAt,
      }),
      officeConfirmed: true,
    };
  }

  const firstAttendanceAt = toDate(signals.firstAttendanceAt);
  const classesStartedAt = toDate(signals.classesStartedAt);
  const hasAttendance = firstAttendanceAt !== null || signals.attendanceCount > 0;

  const levelIndex = Math.max(0, (LEVELS as readonly string[]).indexOf(String(signals.level ?? "A1").toUpperCase()));
  const placedAboveA1 = levelIndex > 0;
  const hasLevelSignoff = Boolean(
    signals.levelCompletedFor && (LEVELS as readonly string[]).includes(String(signals.levelCompletedFor).toUpperCase()),
  );

  const classwork = Math.max(0, signals.classworkCount || 0);
  const activityDate = earliest([
    classesStartedAt,
    firstAttendanceAt,
    signals.currentEnrolmentStartedAt,
    signals.journeyStartedAt,
    signals.firstGradeAt,
    signals.firstSubmissionAt,
    signals.firstQuestAt,
  ]);

  // "Returning" needs positive proof of a finished level with us — not just a
  // level above A1, which a placement test can grant a brand-new student.
  const isReturning = signals.priorEnrolmentsCompleted > 0 || hasLevelSignoff;

  const evidence: string[] = [];
  let status: CohortStatus;
  let confidence: CohortConfidence;
  let suggestedStartedAt: string | null = null;

  if (hasAttendance || classesStartedAt || hasLevelSignoff || classwork >= 3) {
    // Hard evidence of being mid-course.
    status = isReturning ? "returning" : "ongoing";
    confidence = "high";
    suggestedStartedAt = (activityDate ?? classesStartedAt)?.toISOString() ?? null;

    if (firstAttendanceAt) {
      evidence.push(
        `First marked present ${monthLabel(firstAttendanceAt)}` +
          (signals.attendanceCount > 1 ? ` · ${signals.attendanceCount} attendance records` : ""),
      );
    }
    if (classesStartedAt) evidence.push(`Start date on file: ${monthLabel(classesStartedAt)}`);
    if (hasLevelSignoff) evidence.push(`Office signed off ${String(signals.levelCompletedFor).toUpperCase()}`);
    if (classwork > 0) evidence.push(`${classwork} piece${classwork === 1 ? "" : "s"} of classwork`);
    if (signals.priorEnrolmentsCompleted > 0) {
      evidence.push(`${signals.priorEnrolmentsCompleted} completed level${signals.priorEnrolmentsCompleted === 1 ? "" : "s"} in enrolment history`);
    }
  } else if (classwork >= 1 && activityDate && daysAgo(activityDate, now) >= 3) {
    // Some classwork, no attendance and no start date — softer, but they have
    // been doing something for more than a couple of days.
    status = isReturning ? "returning" : "ongoing";
    confidence = "medium";
    suggestedStartedAt = activityDate.toISOString();
    evidence.push(`${classwork} piece${classwork === 1 ? "" : "s"} of classwork since ${monthLabel(activityDate)}`);
    evidence.push("No attendance register or confirmed start date yet");
  } else if (placedAboveA1) {
    // Sitting A2+ with nothing else on file. They did A1 somewhere; whether
    // that was here or a placement test, they are not a blank-slate beginner.
    status = "returning";
    confidence = "medium";
    suggestedStartedAt = (activityDate ?? toDate(signals.currentEnrolmentStartedAt))?.toISOString() ?? null;
    evidence.push(`Placed at ${String(signals.level).toUpperCase()} — has prior German study`);
    evidence.push("But no attendance or classwork recorded at this level");
  } else if (
    registeredAt &&
    classwork === 0 &&
    !hasAttendance &&
    signals.priorEnrolmentsCompleted === 0 &&
    registeredInIntake(registeredAt, signals.currentIntake)
  ) {
    // Fresh account, in the current intake window, nothing done.
    status = "new";
    confidence = "high";
    evidence.push(`Registered ${monthLabel(registeredAt)} — the current ${signals.currentIntake.month} ${signals.currentIntake.year} intake`);
    evidence.push("No attendance, classwork or completed levels");
  } else if (registeredAt && classwork === 0 && !hasAttendance && daysAgo(registeredAt, now) <= 35) {
    // Recent account, nothing done, but the intake month does not line up —
    // still most likely new, less certain.
    status = "new";
    confidence = "medium";
    evidence.push(`Registered ${daysAgo(registeredAt, now)} days ago`);
    evidence.push("Nothing recorded yet, and outside the current intake month");
  } else {
    // Old-ish account, no signal either way. The residual the office must eyeball.
    status = "unknown";
    confidence = "low";
    if (registeredAt) evidence.push(`Registered ${monthLabel(registeredAt)} — ${daysAgo(registeredAt, now)} days ago`);
    evidence.push("No attendance, classwork, start date or completed level on file");
    evidence.push("Either a pre-attendance ongoing student or a no-show — needs a human");
  }

  const mismatch = detectMismatch({ signals, status, suggestedStartedAt, hasAttendance, classwork, now, registeredAt });

  const suggestedBatch =
    signals.currentEnrolmentBatchMonth ??
    ((status === "ongoing" || status === "returning") && !signals.storedBatch && activityDate
      ? MONTH_NAMES[activityDate.getMonth()]
      : null);

  return { status, confidence, evidence, suggestedStartedAt, suggestedBatch, mismatch, officeConfirmed: false };
}

/** Registered in, or in the month just before, the current intake. */
function registeredInIntake(registeredAt: Date, intake: { month: string; year: number }): boolean {
  const intakeMonth = monthNameToIndex(intake.month);
  if (intakeMonth === null) return false;
  const intakeAbs = absoluteMonth(intake.year, intakeMonth);
  const regAbs = absoluteMonth(registeredAt.getFullYear(), registeredAt.getMonth());
  return regAbs >= intakeAbs - 1;
}

function detectMismatch(args: {
  signals: CohortSignals;
  status: CohortStatus;
  suggestedStartedAt: string | null;
  hasAttendance: boolean;
  classwork: number;
  now: Date;
  registeredAt: Date | null;
}): string | null {
  const { signals, status, suggestedStartedAt, hasAttendance, classwork, now, registeredAt } = args;

  const window = signals.storedBatch
    ? resolveBatchWindow(signals.storedBatch, { registeredAt: registeredAt ?? undefined, now })
    : null;

  if ((status === "ongoing" || status === "returning") && !signals.storedBatch) {
    return "In classes but sits in no cohort — no batch month, so no timetable end date and no intake message reaches them.";
  }

  if (!window) return null;

  const started = toDate(suggestedStartedAt);
  if (started && started < window.startsOn) {
    const daysBefore = Math.round((window.startsOn.getTime() - started.getTime()) / MS_PER_DAY);
    if (daysBefore > 40) {
      return `First activity ${monthLabel(started)} is ${daysBefore} days before the ${signals.storedBatch} batch (${window.label}) — the batch month looks wrong.`;
    }
  }

  if (!window.hasBegun && (hasAttendance || classwork > 0)) {
    return `Sits in the ${signals.storedBatch} batch, which has not started yet (${window.label}), but already has ${hasAttendance ? "attendance" : "classwork"}.`;
  }

  return null;
}
