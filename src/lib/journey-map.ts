/**
 * The German Journey Map — the printed poster, one per level.
 *
 * This is the artwork Josh made: a single picture of the road from A1 to
 * fluency, marked up for the level the student is currently sitting. It is a
 * different thing from the generated journey on /calendar, which draws THIS
 * student's actual class days; the poster is the school's story of the whole
 * course and the same picture for everybody at that level.
 *
 * ---------------------------------------------------------------------------
 * TO SWITCH THIS ON: drop the artwork into `public/journey/` named by level —
 *
 *     public/journey/A1.png   public/journey/B1.png
 *     public/journey/A2.png   public/journey/B2.png
 *
 * C1 and C2 are not drawn — see JOURNEY_LEVELS in src/lib/levels.ts. Artwork
 * for them is ignored rather than missing.
 *
 * and nothing else needs changing. Any format the browser renders works; only
 * the basename matters. A level with no file simply shows nothing rather than
 * a broken image — a missing poster must not put a torn-picture icon on the
 * dashboard of every student at that level.
 * ---------------------------------------------------------------------------
 */

/**
 * Re-exported from src/lib/levels.ts so the poster, the Germany road and the
 * gamified ladder cannot drift apart about where the journey ends.
 */
export { JOURNEY_LEVELS } from "@/lib/levels";
import { JOURNEY_LEVELS } from "@/lib/levels";

/**
 * Where a level's poster lives. Returns a path, not a promise that the file is
 * there — the component probes it and hides itself if it is not.
 */
export function journeyMapSrc(level: string | null | undefined): string {
  const normalised = String(level ?? "A1").trim().toUpperCase();
  const known = JOURNEY_LEVELS.find((item) => item === normalised) ?? "A1";
  return `/journey/${known}.png`;
}

/** localStorage key for "already shown today", per level. */
export function journeySeenKey(level: string | null | undefined): string {
  return `easyway:journey-seen:${String(level ?? "A1").toUpperCase()}`;
}

/**
 * Whether the daily reminder is due.
 *
 * DAILY, not per-session: a student who opens the portal four times between
 * lessons should see it once. Keyed by local calendar date rather than a
 * 24-hour timer, so "today" means what the reader means by it, and stored per
 * level so moving up to A2 shows the new map straight away instead of waiting
 * out yesterday's stamp.
 */
export function journeyReminderDue(level: string | null | undefined, now = new Date()): boolean {
  if (typeof window === "undefined") return false;
  try {
    const today = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    return window.localStorage.getItem(journeySeenKey(level)) !== today;
  } catch {
    // Private browsing can throw on localStorage. A reminder that cannot
    // remember it was shown is better suppressed than shown on every load.
    return false;
  }
}

export function markJourneyReminderSeen(level: string | null | undefined, now = new Date()): void {
  if (typeof window === "undefined") return;
  try {
    const today = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    window.localStorage.setItem(journeySeenKey(level), today);
  } catch {
    // Nothing to do; the reminder simply will not persist.
  }
}
