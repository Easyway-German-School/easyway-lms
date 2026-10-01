/**
 * How many classes will be live (and so need recording) at each moment: a forecast the recorder
 * fleet reads to decide how many servers to switch on, and when.
 *
 * WHY THE LMS ANSWERS THIS AND NOT A CONFIG FILE. The school's timetable changes: a tutor moves a class,
 * a holiday closes a day, an extra revision class is added, a cohort starts or finishes, a private lesson is
 * booked for 6 pm. All of that already lives in the LMS (the same schedule the admin calendar draws), so the
 * forecast is derived from it. Nobody has to edit anything on the server side when the timetable changes.
 *
 * This file is PURE (no database): it turns already-fetched sessions into counts, so every rule is testable.
 * `recording-forecast-server.ts` does the fetching.
 */

import { SCHOOL_TIMEZONE, zonedDateKey, zonedTimeToInstant } from "@/lib/school-time";

export type ForecastGroupSession = {
  /** ISO date of the class day (as the schedule stores it). */
  date: string;
  startTime: string; // "10:00", school time
  endTime: string; // "13:00"
  /** scheduled | held | postponed | cancelled (anything else is treated as not happening). */
  status: string;
  /** Where a postponed class moved to (ISO date), if it did. */
  postponedTo: string | null;
  /** Identifies the cohort (branch + level + sitting), so one cohort is never counted twice for one class. */
  cohortKey: string;
};

export type ForecastPrivateClass = {
  scheduledAt: Date;
  durationMinutes: number | null;
  status: string;
};

export type ForecastBucket = { start: string; end: string; classes: number };

export type ForecastInput = {
  groupSessions: ForecastGroupSession[];
  privateClasses: ForecastPrivateClass[];
  from: Date;
  to: Date;
  /** Resolution of the forecast. Classes start and end on 5-minute marks, so 15 loses nothing. Default 15. */
  bucketMinutes?: number;
  tz?: string;
};

const DEFAULT_PRIVATE_MINUTES = 60;
const MINUTE = 60_000;

/** The moment a group class starts and ends, or null when it is not going to happen. */
export function groupSessionWindow(session: ForecastGroupSession, tz: string = SCHOOL_TIMEZONE): { start: Date; end: Date } | null {
  if (session.status === "cancelled") return null;
  // A postponed class happens on its NEW day; a postponed one with no new day is not happening.
  const movedTo = session.postponedTo ? zonedDateKey(new Date(session.postponedTo), tz) : null;
  if (session.status === "postponed" && !movedTo) return null;
  if (!["scheduled", "held", "postponed"].includes(session.status)) return null;
  const day = movedTo ?? zonedDateKey(new Date(session.date), tz);
  if (!/^\d{1,2}:\d{2}$/.test(session.startTime) || !/^\d{1,2}:\d{2}$/.test(session.endTime)) return null;
  const start = zonedTimeToInstant(day, session.startTime, tz);
  const end = zonedTimeToInstant(day, session.endTime, tz);
  return end.getTime() > start.getTime() ? { start, end } : null;
}

export function privateClassWindow(item: ForecastPrivateClass): { start: Date; end: Date } | null {
  if (item.status !== "scheduled") return null;
  const minutes = item.durationMinutes && item.durationMinutes > 0 ? item.durationMinutes : DEFAULT_PRIVATE_MINUTES;
  return { start: item.scheduledAt, end: new Date(item.scheduledAt.getTime() + minutes * MINUTE) };
}

/**
 * Classes live at once, bucket by bucket, over [from, to). A bucket counts every class that overlaps ANY part of
 * it (the safe side: a server must exist for the whole of a class). Runs of equal counts are merged and zero
 * stretches are left out, so the answer stays small.
 */
export function buildForecast(input: ForecastInput): ForecastBucket[] {
  const tz = input.tz ?? SCHOOL_TIMEZONE;
  const step = (input.bucketMinutes ?? 15) * MINUTE;

  const windows: { start: number; end: number }[] = [];
  const seen = new Set<string>();
  for (const session of input.groupSessions) {
    const w = groupSessionWindow(session, tz);
    if (!w) continue;
    const key = `${session.cohortKey}|${w.start.getTime()}`;
    if (seen.has(key)) continue; // the same cohort listed twice is still one class
    seen.add(key);
    windows.push({ start: w.start.getTime(), end: w.end.getTime() });
  }
  for (const item of input.privateClasses) {
    const w = privateClassWindow(item);
    if (w) windows.push({ start: w.start.getTime(), end: w.end.getTime() });
  }

  const from = Math.floor(input.from.getTime() / step) * step;
  const to = input.to.getTime();
  const buckets: ForecastBucket[] = [];
  for (let t = from; t < to; t += step) {
    const classes = windows.reduce((n, w) => n + (w.start < t + step && w.end > t ? 1 : 0), 0);
    if (classes === 0) continue;
    const last = buckets[buckets.length - 1];
    if (last && last.classes === classes && new Date(last.end).getTime() === t) last.end = new Date(t + step).toISOString();
    else buckets.push({ start: new Date(t).toISOString(), end: new Date(t + step).toISOString(), classes });
  }
  return buckets;
}

export type RecordingForecast = {
  version: 1;
  generatedAt: string;
  from: string;
  to: string;
  bucketMinutes: number;
  buckets: ForecastBucket[];
  /** Classes live right now (an open room with a recent heartbeat), including ones nobody scheduled. */
  liveNow: number;
  /** How many cohorts the forecast was built from: a sudden 0 on a school day is a sign something is wrong. */
  cohorts: number;
};
