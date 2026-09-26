/**
 * WHICH OF A TUTOR'S CLASSES IS THE ONE IN FRONT OF THEM RIGHT NOW.
 *
 * The tutor portal asked this question nowhere, which is why every task on it
 * started with the tutor re-telling the app something it already knew: pick the
 * class, pick the date, then finally see a student's name. A tutor who teaches
 * one cohort should never be asked which cohort, and a tutor who teaches three
 * should be shown the one that is actually sitting in front of them.
 *
 * The hours come from `SLOT_DEFAULTS` (lib/class-times.ts) — the one table the
 * timetable, signup and the live room all quote — so "on now" here cannot
 * disagree with the calendar the students read.
 *
 * Deliberately pure and clock-injected: no `new Date()`, no prisma, no tz
 * lookup. The caller resolves the school's wall clock once (school-time.ts) and
 * passes it in, which is also the only way this is testable at 6pm on a
 * Saturday.
 */

import { isWeekendSlot, normalizeSlot, SLOT_DEFAULTS } from "@/lib/class-times";

/**
 * Where a sitting stands against the school's wall clock.
 *
 * `soon` exists because it changes what the tutor is about to do: a class
 * starting in twenty minutes is the one to open the register for, a class that
 * starts at five is not. `done` and `not-today` are kept apart for the same
 * reason — "you already taught this one" and "this one doesn't meet today" lead
 * to different next actions.
 */
export type SittingState = "now" | "soon" | "done" | "later" | "not-today";

/** How long before the hour a class counts as the next thing happening. */
export const SOON_MINUTES = 90;

/** "13:45" → 825. Anything unparseable comes back null rather than 0, which
 *  would silently read as midnight and make every class look finished. */
export function clockToMinutes(clock: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** The 24h window a sitting meets in, as the school's own table defines it. */
export function sittingWindow(slot: string): { startTime: string; endTime: string } {
  const row = SLOT_DEFAULTS[normalizeSlot(slot)];
  return { startTime: row.startTime, endTime: row.endTime };
}

/**
 * Does this sitting meet on this day at all?
 *
 * The weekend sitting meets on Saturdays only; the weekday sittings meet
 * Mon–Fri. Sunday is nobody's class day.
 */
export function sittingMeetsOn(slot: string, weekday: number): boolean {
  return isWeekendSlot(slot) ? weekday === 6 : weekday >= 1 && weekday <= 5;
}

/**
 * @param slot      morning | afternoon | evening | weekend
 * @param nowClock  the school's wall clock, "HH:MM" (see zonedClock())
 * @param weekday   the school's own day, 0=Sun (see instantToZonedParts())
 */
export function sittingStateAt(slot: string, nowClock: string, weekday: number): SittingState {
  if (!sittingMeetsOn(slot, weekday)) return "not-today";

  const now = clockToMinutes(nowClock);
  const window = sittingWindow(slot);
  const start = clockToMinutes(window.startTime);
  const end = clockToMinutes(window.endTime);
  // An unreadable clock must not invent a state. "later" is the honest,
  // harmless answer: it puts the class on the card without claiming it is on.
  if (now === null || start === null || end === null) return "later";

  if (now >= start && now < end) return "now";
  if (now >= end) return "done";
  return start - now <= SOON_MINUTES ? "soon" : "later";
}

/** Most-urgent-first, so the tutor's card opens on the class they are teaching. */
const FOCUS_ORDER: Record<SittingState, number> = {
  now: 0,
  soon: 1,
  later: 2,
  done: 3,
  "not-today": 4,
};

export function compareByFocus(a: SittingState, b: SittingState): number {
  return FOCUS_ORDER[a] - FOCUS_ORDER[b];
}

/**
 * The one class the dashboard should open on.
 *
 * Ties keep the caller's order (the assignment's own order), so a tutor with
 * two morning cohorts sees the same one each day rather than a random pick.
 */
export function pickFocusIndex(states: SittingState[]): number {
  if (states.length === 0) return -1;
  let best = 0;
  for (let i = 1; i < states.length; i += 1) {
    if (compareByFocus(states[i], states[best]) < 0) best = i;
  }
  return best;
}

/** "10:00 – 13:00", for the one line under the class name. */
export function sittingHours(slot: string): string {
  const window = sittingWindow(slot);
  return `${window.startTime} – ${window.endTime}`;
}

/** What the card says about a sitting, in the tutor's words rather than a state name. */
export function sittingNote(state: SittingState, slot: string): string {
  const hours = sittingHours(slot);
  switch (state) {
    case "now":
      return `On now · ${hours}`;
    case "soon":
      return `Starts soon · ${hours}`;
    case "done":
      return `Finished today · ${hours}`;
    case "not-today":
      return isWeekendSlot(slot) ? "Saturdays only" : "Not today";
    default:
      return `Today · ${hours}`;
  }
}
