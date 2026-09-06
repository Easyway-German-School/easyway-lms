/**
 * The school's clock — one place wall-clock time is converted to and from an
 * absolute instant.
 *
 * Every "18:00" a tutor types, every recurring series' start time, every typed
 * reschedule is a WALL-CLOCK time in a particular zone. The bug this file fixes:
 * that conversion used to happen in whatever zone the code ran in — the tutor's
 * browser (WAT), or the server (UTC on Vercel) — so a class set for 18:00 could
 * be stored as 17:00 or 19:00 and shown back an hour off.
 *
 * Conversions go through `Intl.DateTimeFormat`'s `timeZone` option, never manual
 * offset arithmetic, so the IANA database is what knows when a zone's offset
 * changes. `Africa/Lagos` has no DST, but the diaspora zones an online student
 * can pick (`Europe/Berlin`, `Europe/London`, US) do, and this handles them.
 *
 * No `@/lib/prisma` import: the booking form and the calendars are client
 * components and pull this in directly.
 *
 * ---------------------------------------------------------------------------
 * THIS IS THE TIMEZONE THE APP BELIEVES. If the school ever runs from another
 * country, change it HERE (or lift it to a SchoolSetting) and every conversion
 * follows.
 * ---------------------------------------------------------------------------
 */

export const SCHOOL_TIMEZONE = "Africa/Lagos";

/**
 * Friendly zone abbreviations for the zones the school actually sees. Node's
 * ICU returns "GMT+1" for most of these, so we keep our own — DST-aware where
 * the zone shifts.
 */
const ZONE_ABBR: Record<string, { std: string; dst?: string }> = {
  "Africa/Lagos": { std: "WAT" },
  "Africa/Accra": { std: "GMT" },
  "Africa/Nairobi": { std: "EAT" },
  "Asia/Dubai": { std: "GST" },
  "Europe/Berlin": { std: "CET", dst: "CEST" },
  "Europe/London": { std: "GMT", dst: "BST" },
  "America/New_York": { std: "EST", dst: "EDT" },
  "America/Chicago": { std: "CST", dst: "CDT" },
  "America/Los_Angeles": { std: "PST", dst: "PDT" },
};

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * How far ahead of UTC `tz` is at `instant`, in milliseconds. Derived by
 * reading the instant back through the zone and comparing — no offset tables.
 */
function zoneOffsetMs(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const hour = Number(map.hour) % 24; // some engines emit "24" for midnight
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second),
  );
  return asUTC - instant.getTime();
}

/**
 * A wall-clock day + time in `tz` → the exact UTC instant.
 * `zonedTimeToInstant("2026-09-10", "18:00", "Africa/Lagos")` → 2026-09-10T17:00:00.000Z.
 */
export function zonedTimeToInstant(dateKey: string, clock: string, tz: string = SCHOOL_TIMEZONE): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [hh, mm] = clock.split(":").map(Number);
  const guess = Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
  // One correction settles a normal zone; a second nails a DST-transition edge.
  let instant = guess - zoneOffsetMs(new Date(guess), tz);
  instant = guess - zoneOffsetMs(new Date(instant), tz);
  return new Date(instant);
}

export type ZonedParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  weekday: number; // 0=Sun
  dateKey: string; // "2026-09-10"
  clock: string; // "18:00"
};

/** An absolute instant → its wall-clock parts in `tz`. */
export function instantToZonedParts(date: Date, tz: string = SCHOOL_TIMEZONE): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  const hour = Number(map.hour) % 24;
  const minute = Number(map.minute);
  return {
    year,
    month,
    day,
    hour,
    minute,
    // Locale-independent: the weekday of that calendar date.
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    dateKey: `${map.year}-${map.month}-${map.day}`,
    clock: `${pad(hour)}:${pad(minute)}`,
  };
}

/** "18:00" — the wall-clock time of `date` in `tz`. */
export function zonedClock(date: Date, tz: string = SCHOOL_TIMEZONE): string {
  return instantToZonedParts(date, tz).clock;
}

/** "2026-09-10" — the calendar day `date` falls on in `tz`. */
export function zonedDateKey(date: Date, tz: string = SCHOOL_TIMEZONE): string {
  return instantToZonedParts(date, tz).dateKey;
}

/** True when `tz` is observing daylight saving at `date`. */
function isDaylightSaving(date: Date, tz: string): boolean {
  const year = date.getUTCFullYear();
  const jan = zoneOffsetMs(new Date(Date.UTC(year, 0, 15)), tz);
  const jul = zoneOffsetMs(new Date(Date.UTC(year, 6, 15)), tz);
  if (jan === jul) return false; // zone has no DST
  const standard = Math.min(jan, jul); // standard time = the smaller (winter) offset
  return zoneOffsetMs(date, tz) !== standard;
}

/** A short zone label for display: "WAT", "CEST", "BST", or "GMT+3". */
export function zoneLabel(date: Date, tz: string = SCHOOL_TIMEZONE): string {
  const entry = ZONE_ABBR[tz];
  if (entry) return entry.dst && isDaylightSaving(date, tz) ? entry.dst : entry.std;
  try {
    const value = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
      .formatToParts(date)
      .find((p) => p.type === "timeZoneName")?.value;
    if (value && !/^GMT$/.test(value)) return value;
  } catch {
    /* fall through to the offset form */
  }
  const minutes = Math.round(zoneOffsetMs(date, tz) / 60000);
  const sign = minutes >= 0 ? "+" : "-";
  const hours = Math.floor(Math.abs(minutes) / 60);
  const rem = Math.abs(minutes) % 60;
  return `GMT${sign}${hours}${rem ? `:${pad(rem)}` : ""}`;
}

/** The zone to show a viewer their times in: their own if set, else the school's. */
export function viewerTimezone(ownTimezone?: string | null): string {
  const tz = (ownTimezone ?? "").trim();
  return tz ? tz : SCHOOL_TIMEZONE;
}

/**
 * Parse a client-supplied instant. An ISO string carrying a `Z` or a numeric
 * offset is an absolute instant — take it as-is. A bare `YYYY-MM-DDTHH:mm`
 * (no zone) is a wall-clock time and is read in `tz` (the school's, by
 * default) instead of the server's own zone.
 */
export function parseTimeInput(raw: string, tz: string = SCHOOL_TIMEZONE): Date {
  if (/[zZ]$/.test(raw) || /[+-]\d{2}:?\d{2}$/.test(raw)) return new Date(raw);
  const [d, t = "00:00"] = raw.split("T");
  return zonedTimeToInstant(d, t.slice(0, 5), tz);
}

/** "Wed 10 Sep, 06:00 PM WAT" — an instant rendered for a person to read. */
export function formatWhen(date: Date, tz: string = SCHOOL_TIMEZONE): string {
  const stamp = date.toLocaleString("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const label = zoneLabel(date, tz);
  return label ? `${stamp} ${label}` : stamp;
}
