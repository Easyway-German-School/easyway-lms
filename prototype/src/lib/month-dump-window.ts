import { SCHOOL_TIMEZONE } from "@/lib/school-time";

/**
 * Pure calendar helpers for Becca's month dump.
 * Kept free of prisma so client components (the soft popup) can share them.
 */

/** School-timezone calendar parts for "November", year, day-of-month. */
export function schoolCalendarParts(now = new Date()): {
  year: number;
  month: number;
  day: number;
  monthLabel: string;
} {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SCHOOL_TIMEZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value ?? now.getFullYear());
  const month = Number(parts.find((p) => p.type === "month")?.value ?? now.getMonth() + 1);
  const day = Number(parts.find((p) => p.type === "day")?.value ?? now.getDate());
  const monthLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: SCHOOL_TIMEZONE,
    month: "long",
  }).format(now);
  return { year, month, day, monthLabel };
}

/**
 * Soft window for the month-dump popup: last 5 days of the school calendar
 * month. November 26–30 (and every month's equivalent) get the invitation.
 */
export function isMonthDumpWindow(now = new Date()): boolean {
  const { year, month, day } = schoolCalendarParts(now);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day > daysInMonth - 5;
}
