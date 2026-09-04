/**
 * The school's class hours — one table, read by everything that quotes them.
 *
 * These were written down twice: here (for the timetable engine) and again as
 * a hardcoded list in the signup form. Two copies of the same fact drift, and
 * this pair had: the form was quoting students hours to turn up at that the
 * generated timetable then contradicted.
 *
 * Deliberately in its own file with no prisma import, because the signup form
 * is a client component and anything server-only would stop it crossing into
 * the browser.
 *
 * ---------------------------------------------------------------------------
 * THESE ARE THE HOURS THE APP BELIEVES. If the school teaches different ones,
 * change them HERE and every quote follows — signup, the calendar, the tutor's
 * editor, the live room.
 * ---------------------------------------------------------------------------
 */

export const TIME_SLOTS = ["morning", "afternoon", "evening", "weekend"] as const;
export type TimeSlot = (typeof TIME_SLOTS)[number];

/**
 * Weekday sittings meet Mon–Fri; the weekend sitting meets once, on Saturday,
 * which is why `WEEKEND_SLOTS` exists at all — most callers that iterate
 * "every sitting today" need to skip it on a weekday and are the only reason
 * it isn't just folded into `TIME_SLOTS` unremarked.
 */
export const WEEKDAY_SLOTS = ["morning", "afternoon", "evening"] as const;
export function isWeekendSlot(slot: unknown): boolean {
  return String(slot ?? "").toLowerCase() === "weekend";
}

export const SLOT_DEFAULTS: Record<TimeSlot, { startTime: string; endTime: string; label: string }> = {
  morning: { startTime: "10:00", endTime: "13:00", label: "Morning" },
  afternoon: { startTime: "13:00", endTime: "15:00", label: "Afternoon" },
  evening: { startTime: "17:00", endTime: "19:00", label: "Evening" },
  // One sitting, Saturdays only — see class-sessions.ts for how the rotation
  // generator turns this into "which days a cohort meets" differently from
  // the Mon–Fri slots above.
  weekend: { startTime: "10:00", endTime: "14:00", label: "Weekend (Saturdays)" },
};

export function normalizeSlot(value: unknown): TimeSlot {
  const slot = String(value ?? "").toLowerCase();
  return (TIME_SLOTS as readonly string[]).includes(slot) ? (slot as TimeSlot) : "morning";
}

/** "Morning — 9:00 to 11:00", for a dropdown a student is choosing from. */
export function slotLabel(slot: TimeSlot): string {
  const times = SLOT_DEFAULTS[slot];
  return `${times.label} — ${times.startTime} to ${times.endTime}`;
}
