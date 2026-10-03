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
  /** Lets a no-show private lesson be matched against an actual session by its booking, not just its time. */
  id?: string;
  scheduledAt: Date;
  durationMinutes: number | null;
  status: string;
};

/**
 * A class that actually happened: a `LiveClassSession` row, reduced to just enough to match it back to the
 * scheduled window it belongs to. `cohortKey` for a group class (same shape as `ForecastGroupSession.cohortKey`),
 * `privateClassId` for a one-to-one lesson — whichever applies is set, the other is null.
 */
export type ActualSession = {
  cohortKey: string | null;
  privateClassId: string | null;
  startedAt: Date;
  endedAt: Date | null;
};

export type ForecastBucket = { start: string; end: string; classes: number };

export type ForecastInput = {
  groupSessions: ForecastGroupSession[];
  privateClasses: ForecastPrivateClass[];
  /** Classes that actually started, used to tell a real class from a no-show (see `CONFIRM_GRACE_MINUTES`). */
  actualSessions?: ActualSession[];
  from: Date;
  to: Date;
  /** The moment "has this started yet" is judged against. Defaults to `from` (the server always passes "now"). */
  now?: Date;
  /** Resolution of the forecast. Classes start and end on 5-minute marks, so 15 loses nothing. Default 15. */
  bucketMinutes?: number;
  tz?: string;
};

const DEFAULT_PRIVATE_MINUTES = 60;
const MINUTE = 60_000;

/**
 * A scheduled class gets this long, past its start time, to actually open a room before the forecast gives up
 * on it. Tutors run late; this is the benefit of the doubt. Past this, an unconfirmed class stops costing money
 * — a no-show (sickness, a forgotten class, a tutor who never logs on) no longer keeps a server paid for.
 * If a tutor really is just running later than this, the room still opens: `liveNow` on the forecast (and the
 * recorder fleet's own "live now" allowance) picks up any room opened after the fact, booting a fresh server a
 * few minutes late rather than one sitting idle and billed for the whole class.
 */
export const CONFIRM_GRACE_MINUTES = 15;
const CONFIRM_GRACE_MS = CONFIRM_GRACE_MINUTES * MINUTE;

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
  const now = (input.now ?? input.from).getTime();
  const actual = input.actualSessions ?? [];

  // Did something matching `matches` actually run during (or just before, within the grace window) `w`?
  const confirmed = (w: { start: number; end: number }, matches: (s: ActualSession) => boolean) =>
    actual.some((s) => matches(s) && s.startedAt.getTime() < w.end && (s.endedAt ? s.endedAt.getTime() : Infinity) > w.start - CONFIRM_GRACE_MS);

  // Once the grace deadline has passed with nothing confirmed, the window stops counting from there on. Still in
  // the future, or already confirmed: counts in full (pre-warm, and a late-but-real start keeps its server).
  const clipNoShow = (w: { start: number; end: number }, matches: (s: ActualSession) => boolean) => {
    const deadline = w.start + CONFIRM_GRACE_MS;
    if (now < deadline || confirmed(w, matches)) return w;
    return { start: w.start, end: Math.min(w.end, deadline) };
  };

  const windows: { start: number; end: number }[] = [];
  const seen = new Set<string>();
  for (const session of input.groupSessions) {
    const w = groupSessionWindow(session, tz);
    if (!w) continue;
    const key = `${session.cohortKey}|${w.start.getTime()}`;
    if (seen.has(key)) continue; // the same cohort listed twice is still one class
    seen.add(key);
    const clipped = clipNoShow({ start: w.start.getTime(), end: w.end.getTime() }, (s) => s.cohortKey === session.cohortKey);
    if (clipped.end > clipped.start) windows.push(clipped);
  }
  for (const item of input.privateClasses) {
    const w = privateClassWindow(item);
    if (!w) continue;
    const clipped = item.id ? clipNoShow({ start: w.start.getTime(), end: w.end.getTime() }, (s) => s.privateClassId === item.id) : { start: w.start.getTime(), end: w.end.getTime() };
    if (clipped.end > clipped.start) windows.push(clipped);
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
