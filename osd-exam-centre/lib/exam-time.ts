/**
 * Date/time helpers for anything a candidate reads. Everything is Lagos wall
 * clock (Africa/Lagos, UTC+1, no DST): the exam is in Lagos, and the cron runs
 * on UTC servers, where "today" is a different calendar day for an hour every
 * morning — counting days in UTC would fire the 24-hour reminder a day late.
 */

const LAGOS = "Africa/Lagos";

/** 2026-10-29 in Lagos for the given instant. */
export function lagosDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: LAGOS }).format(date);
  return parts; // en-CA is already YYYY-MM-DD
}

/** Whole calendar days from `from` to `to`, counted on Lagos dates (negative once `to` has passed). */
export function calendarDaysBetween(from: Date, to: Date): number {
  const a = Date.parse(`${lagosDateKey(from)}T00:00:00Z`);
  const b = Date.parse(`${lagosDateKey(to)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Thursday, 29 October 2026 */
export function formatLongDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: LAGOS }).format(date);
}

/** 29 October 2026 */
export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: LAGOS }).format(date);
}

/** "09:00" → "9:00 AM"; null for anything that isn't a clean HH:MM. */
export function formatClock(hhmm: string | null | undefined): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(min).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** Start "09:00" minus 60 → "8:00 AM". Null when there is no usable start time. */
export function arrivalClock(startHhmm: string | null | undefined, minutesBefore: number): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(startHhmm ?? "");
  if (!m || !formatClock(startHhmm)) return null;
  const total = ((Number(m[1]) * 60 + Number(m[2]) - minutesBefore) % 1440 + 1440) % 1440;
  return formatClock(`${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`);
}
