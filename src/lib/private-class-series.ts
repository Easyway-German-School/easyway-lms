import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { SCHEDULE_DAYS, type ScheduleDay } from "@/lib/private-schedule-preferences";

/**
 * The recurring-booking engine for private classes.
 *
 * A `PrivateClassSeries` is the recipe ("Monday and Thursday, 18:00, 60
 * minutes"), never the calendar itself. The calendar is real `PrivateClass`
 * rows with `seriesId` set, generated a rolling window ahead — the same shape
 * as a one-off booking, so every existing reader (the student's calendar, the
 * tutor's booking list, the admin review page) shows a series occurrence
 * without knowing it came from one.
 *
 * Materialising real rows, rather than computing the pattern on the fly the
 * way the GROUP timetable does, is deliberate: a series occurrence has to be
 * individually cancellable, reschedulable and skippable for a holiday without
 * touching the pattern everyone else still meets on, and only a real row can
 * carry a status.
 *
 * TIMEZONE NOTE: like every other booking path in this app today (see
 * `choosePreferredTime` in the tutor's booking page), this treats the
 * series' `startTime` as wall-clock time applied directly via `setHours()`
 * — it does not yet convert through the series' IANA `timezone` field.
 * Genuine timezone/DST-safe conversion is a deliberately separate, later
 * pass (it touches every booking path at once, not just this one) — see the
 * scheduling-platform roadmap. `timezone` is stored now so that pass has
 * something to read.
 */

const WINDOW_WEEKS = 8;
const MAX_GENERATE_PER_RUN = 60; // safety cap — a runaway loop stops here, not at "out of memory".

export type SeriesInput = {
  studentId: string;
  lecturerId?: string | null;
  weekdays: ScheduleDay[];
  startTime: string; // "HH:mm"
  durationMinutes: number;
  deliveryMode?: string | null;
  location?: string | null;
  topic?: string | null;
  materialId?: string | null;
  timezone: string;
  startDate: Date;
  endDate?: Date | null;
  createdBy: "admin" | "tutor";
  tenantId?: string | null;
};

function isoDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function weekdayNameFor(date: Date): ScheduleDay {
  return SCHEDULE_DAYS[(date.getDay() + 6) % 7];
}

function atStartTime(date: Date, startTime: string): Date {
  const [hours, minutes] = startTime.split(":").map(Number);
  const next = new Date(date);
  next.setHours(hours, minutes, 0, 0);
  return next;
}

/** Creates the series and immediately fills its first window of occurrences. */
export async function createSeries(input: SeriesInput) {
  const series = await prisma.privateClassSeries.create({
    data: {
      studentId: input.studentId,
      lecturerId: input.lecturerId ?? null,
      weekdays: input.weekdays,
      startTime: input.startTime,
      durationMinutes: input.durationMinutes,
      deliveryMode: input.deliveryMode ?? null,
      location: input.location ?? null,
      topic: input.topic ?? null,
      materialId: input.materialId ?? null,
      timezone: input.timezone,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      createdBy: input.createdBy,
      tenantId: input.tenantId ?? null,
    },
  });
  const created = await generateOccurrences(series.id);
  return { series, created };
}

/**
 * Tops up ONE series' materialised occurrences to `WINDOW_WEEKS` ahead of
 * now (or the series' own end date, whichever is sooner). Safe to call
 * repeatedly — every write is guarded by an occupancy check first and the
 * database's own `(seriesId, scheduledAt)` unique index second, so two
 * overlapping calls (two tabs loading the same calendar at once) can never
 * double-book a date.
 */
export async function generateOccurrences(seriesId: string, now: Date = new Date()): Promise<number> {
  const series = await prisma.privateClassSeries.findUnique({
    where: { id: seriesId },
    include: { student: { select: { branchId: true } } },
  });
  if (!series || series.status !== "active") return 0;

  const weekdays = Array.isArray(series.weekdays)
    ? (series.weekdays as unknown[]).filter((d): d is ScheduleDay => typeof d === "string" && (SCHEDULE_DAYS as readonly string[]).includes(d))
    : [];
  if (weekdays.length === 0) return 0;

  const windowStart = new Date(Math.max(now.getTime(), series.startDate.getTime()));
  windowStart.setHours(0, 0, 0, 0);
  const windowEndByPolicy = new Date(now);
  windowEndByPolicy.setDate(windowEndByPolicy.getDate() + WINDOW_WEEKS * 7);
  const windowEnd = series.endDate && series.endDate.getTime() < windowEndByPolicy.getTime() ? series.endDate : windowEndByPolicy;
  if (windowEnd.getTime() <= windowStart.getTime()) return 0;

  // Every date already spoken for — by this series, another series, or a
  // one-off booking. One decision per calendar day is the rule: if the office
  // already cancelled or moved this date, generation must not silently refill
  // it out from under them.
  const existingForStudent = await prisma.privateClass.findMany({
    where: { studentId: series.studentId, scheduledAt: { gte: windowStart, lt: windowEnd } },
    select: { scheduledAt: true },
  });
  const occupiedDates = new Set(existingForStudent.map((row) => isoDateKey(row.scheduledAt)));

  const holidays = await prisma.schoolHoliday.findMany({
    where: {
      date: { gte: windowStart, lt: windowEnd },
      // `branchId: undefined` in a Prisma where clause means "no filter on
      // this field" — NOT "match null" — so when the student has no branch
      // this must drop the second clause entirely rather than pass it
      // through, or it would silently match every branch's holidays too.
      OR: series.student.branchId ? [{ branchId: null }, { branchId: series.student.branchId }] : [{ branchId: null }],
    },
    select: { date: true, label: true },
  });
  const holidayByDate = new Map(holidays.map((h) => [isoDateKey(h.date), h.label]));

  const toCreate: Prisma.PrivateClassCreateManyInput[] = [];
  for (const cursor = new Date(windowStart); cursor.getTime() < windowEnd.getTime() && toCreate.length < MAX_GENERATE_PER_RUN; cursor.setDate(cursor.getDate() + 1)) {
    if (!weekdays.includes(weekdayNameFor(cursor))) continue;
    const dateKey = isoDateKey(cursor);
    if (occupiedDates.has(dateKey)) continue;

    const scheduledAt = atStartTime(cursor, series.startTime);
    const holidayLabel = holidayByDate.get(dateKey);

    toCreate.push({
      studentId: series.studentId,
      lecturerId: series.lecturerId,
      scheduledAt,
      durationMinutes: series.durationMinutes,
      topic: holidayLabel ? null : series.topic,
      status: holidayLabel ? "skipped" : "scheduled",
      notes: holidayLabel ? `Skipped — ${holidayLabel}` : null,
      deliveryMode: series.deliveryMode,
      location: series.location,
      materialId: series.materialId,
      seriesId: series.id,
      isException: false,
    });
  }

  if (toCreate.length === 0) return 0;

  // One round trip for the whole batch, not one per occurrence — the
  // earlier per-row `create()` loop measured 45s for four rows against the
  // real database (each INSERT is its own network round trip to Neon).
  // `skipDuplicates` leans on the same `(seriesId, scheduledAt)` unique
  // index for the race case (two overlapping generation runs): Postgres
  // silently skips the row instead of erroring, so nothing here needs a
  // try/catch.
  const result = await prisma.privateClass.createMany({ data: toCreate, skipDuplicates: true });
  return result.count;
}

/**
 * Tops up every active series a student has. This is the entry point the
 * read paths call — the student's own calendar, the tutor's booking screen,
 * the admin review page — so a series never needs an explicit "generate now"
 * button; opening any calendar that would show the result is what generates
 * it.
 */
export async function topUpSeriesForStudent(studentId: string, now: Date = new Date()): Promise<void> {
  const activeSeries = await prisma.privateClassSeries.findMany({
    where: { studentId, status: "active" },
    select: { id: true },
  });
  for (const series of activeSeries) {
    await generateOccurrences(series.id, now);
  }
}

/** Stops future generation. Occurrences already materialised are untouched — cancel them individually if needed. */
export async function endSeries(seriesId: string) {
  return prisma.privateClassSeries.update({ where: { id: seriesId }, data: { status: "ended" } });
}
