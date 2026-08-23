/**
 * Shape of a private student's "when am I free" answer, and reading it back.
 *
 * Deliberately has no import on `@/lib/prisma` — this is used from the
 * client-side picker (`PrivateScheduleSetup.tsx`) as well as server routes,
 * and pulling Prisma into a "use client" bundle is the kind of mistake that
 * only shows up at build time.
 *
 * Students are free different hours on different days ("6-10pm Monday, but
 * only 12-6pm Tuesday"), so preferences are per-day time ranges rather than a
 * single days[] + a coarse morning/afternoon/evening windows[] that could not
 * express that. Older submissions were saved in that coarser shape —
 * `normalizeSchedulePreferences` reads either shape and returns the current
 * one, so nothing needs a backfill migration.
 */

export const SCHEDULE_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type ScheduleDay = (typeof SCHEDULE_DAYS)[number];

export type TimeRange = { start: string; end: string };

export type DayScheduleEntry = { day: ScheduleDay; ranges: TimeRange[] };

export type NormalizedSchedulePreferences = {
  dayRanges: DayScheduleEntry[];
  preferredTimes: string[];
  examTimes: string[];
  frequency: string;
  timezone: string;
  notes: string;
};

export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const SCHEDULE_FREQUENCIES = ["weekly", "twice-weekly", "flexible"] as const;

/**
 * Validates a POSTed/PATCHed preferences body into the canonical shape, or
 * returns an error string. Shared by the student route (submitting their own
 * preferences) and the admin override route, so the two can never drift into
 * accepting different inputs for the same field.
 */
export function parseSchedulePreferencesInput(body: Record<string, unknown> | null):
  | { error: string }
  | { preferences: Omit<NormalizedSchedulePreferences, "timezone"> & { timezone: string } } {
  const dayRangesInput = Array.isArray(body?.dayRanges) ? body!.dayRanges : [];
  const dayRanges = dayRangesInput
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    .map((entry) => ({
      day: entry.day,
      ranges: Array.isArray(entry.ranges)
        ? entry.ranges
            .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
            .map((r) => ({ start: String(r.start), end: String(r.end) }))
            .filter((r) => TIME_PATTERN.test(r.start) && TIME_PATTERN.test(r.end) && r.start < r.end)
        : [],
    }))
    .filter((entry): entry is DayScheduleEntry => isScheduleDay(entry.day) && entry.ranges.length > 0);

  const readTimes = (value: unknown) =>
    Array.isArray(value) ? [...new Set(value.filter((time): time is string => typeof time === "string" && TIME_PATTERN.test(time)))].sort() : [];
  const preferredTimes = readTimes(body?.preferredTimes);
  const examTimes = readTimes(body?.examTimes);
  const frequency = typeof body?.frequency === "string" && (SCHEDULE_FREQUENCIES as readonly string[]).includes(body.frequency) ? body.frequency : "weekly";
  const timezone = typeof body?.timezone === "string" && body.timezone.trim() ? body.timezone.trim().slice(0, 80) : "UTC";
  const notes = typeof body?.notes === "string" ? body.notes.trim().slice(0, 1000) : "";

  if (dayRanges.length === 0) {
    return { error: "Mark at least one day and a time range that's free on it" };
  }
  return { preferences: { dayRanges, preferredTimes, examTimes, frequency, timezone, notes } };
}

const LEGACY_WINDOW_RANGE: Record<string, TimeRange> = {
  morning: { start: "06:00", end: "12:00" },
  afternoon: { start: "12:00", end: "17:00" },
  evening: { start: "17:00", end: "22:00" },
};

function isScheduleDay(value: unknown): value is ScheduleDay {
  return typeof value === "string" && (SCHEDULE_DAYS as readonly string[]).includes(value);
}

function readTimeRange(value: unknown): TimeRange | null {
  if (!value || typeof value !== "object") return null;
  const { start, end } = value as Record<string, unknown>;
  if (typeof start !== "string" || typeof end !== "string") return null;
  if (!TIME_PATTERN.test(start) || !TIME_PATTERN.test(end)) return null;
  return { start, end };
}

/** Accepts either the current `dayRanges` shape or the legacy `days`+`windows` shape. */
export function normalizeSchedulePreferences(raw: unknown): NormalizedSchedulePreferences {
  const empty: NormalizedSchedulePreferences = {
    dayRanges: [],
    preferredTimes: [],
    examTimes: [],
    frequency: "weekly",
    timezone: "UTC",
    notes: "",
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return empty;
  const value = raw as Record<string, unknown>;

  const preferredTimes = Array.isArray(value.preferredTimes)
    ? value.preferredTimes.filter((t): t is string => typeof t === "string" && TIME_PATTERN.test(t))
    : [];
  const examTimes = Array.isArray(value.examTimes)
    ? value.examTimes.filter((t): t is string => typeof t === "string" && TIME_PATTERN.test(t))
    : [];
  const frequency = typeof value.frequency === "string" && value.frequency ? value.frequency : "weekly";
  const timezone = typeof value.timezone === "string" && value.timezone ? value.timezone : "UTC";
  const notes = typeof value.notes === "string" ? value.notes : "";

  if (Array.isArray(value.dayRanges)) {
    const dayRanges: DayScheduleEntry[] = value.dayRanges
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
      .map((entry) => ({
        day: entry.day,
        ranges: Array.isArray(entry.ranges) ? entry.ranges.map(readTimeRange).filter((r): r is TimeRange => r !== null) : [],
      }))
      .filter((entry): entry is { day: ScheduleDay; ranges: TimeRange[] } => isScheduleDay(entry.day) && entry.ranges.length > 0);
    return { dayRanges, preferredTimes, examTimes, frequency, timezone, notes };
  }

  // Legacy: days[] (e.g. "monday") + windows[] ("morning"|"afternoon"|"evening").
  const days = Array.isArray(value.days) ? value.days.filter(isScheduleDay) : [];
  const windows = Array.isArray(value.windows)
    ? value.windows.filter((w): w is string => typeof w === "string" && w in LEGACY_WINDOW_RANGE)
    : [];
  if (days.length === 0 || windows.length === 0) return { ...empty, preferredTimes, examTimes, frequency, timezone, notes };
  const ranges = windows.map((w) => LEGACY_WINDOW_RANGE[w]);
  const dayRanges = days.map((day) => ({ day, ranges }));
  return { dayRanges, preferredTimes, examTimes, frequency, timezone, notes };
}

/** Sunday-indexed `Date.getDay()` → our Monday-first `SCHEDULE_DAYS` index. */
function scheduleDayFor(date: Date): ScheduleDay {
  return SCHEDULE_DAYS[(date.getDay() + 6) % 7];
}

/**
 * Does a candidate booking time land inside what the student said works?
 *
 * "match" = right day, right time. "day" = right day, but outside every
 * range they gave for it (still worth a soft warning, not a hard block —
 * these are preferences, not a locked timetable). "mismatch" = wrong day
 * entirely. "unknown" = the student has not shared preferences yet.
 */
export function scheduleMatchFor(date: Date, dayRanges: DayScheduleEntry[]): "match" | "day" | "mismatch" | "unknown" {
  if (!dayRanges.length) return "unknown";
  const entry = dayRanges.find((e) => e.day === scheduleDayFor(date));
  if (!entry) return "mismatch";
  const minutes = date.getHours() * 60 + date.getMinutes();
  const inRange = entry.ranges.some((range) => {
    const [startHour, startMinute] = range.start.split(":").map(Number);
    const [endHour, endMinute] = range.end.split(":").map(Number);
    return minutes >= startHour * 60 + startMinute && minutes <= endHour * 60 + endMinute;
  });
  return inRange ? "match" : "day";
}

/**
 * Renders an instant in a NAMED zone, not the viewer's own — the one place a
 * cross-timezone booking screen actually needs to say "6pm for them", not
 * "6pm here". Goes through `Intl.DateTimeFormat`'s `timeZone` option rather
 * than manual offset math, which is what makes it DST-safe for free: the
 * IANA database, not this file, is what knows when Lagos or London's offset
 * changes.
 *
 * Returns null for an unrecognised zone name (a legacy row, or "UTC" as a
 * placeholder default) rather than throwing — callers treat null as "don't
 * show a second time".
 */
export function formatInTimezone(date: Date, timezone: string | null | undefined): string | null {
  if (!timezone || timezone === "UTC") return null;
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return null;
  }
}

export function formatDayRanges(dayRanges: DayScheduleEntry[]): string {
  if (dayRanges.length === 0) return "No days shared yet";
  return dayRanges
    .map((entry) => {
      const label = entry.day.charAt(0).toUpperCase() + entry.day.slice(1);
      const isAllDay = entry.ranges.length === 1 && entry.ranges[0].start === "00:00" && entry.ranges[0].end === "23:59";
      const ranges = isAllDay ? "all day" : entry.ranges.map((r) => `${r.start}–${r.end}`).join(", ");
      return `${label} ${ranges}`;
    })
    .join(" · ");
}
