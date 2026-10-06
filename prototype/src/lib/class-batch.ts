/**
 * WHICH BATCH A CLASS ROOM BELONGS TO.
 *
 * Branch + level + sitting was never a class either. The September A1 morning
 * group and the October A1 morning group are two different sets of people on
 * two different timetables — an October batch starts while September is still
 * mid-course, so for a month both are teaching at once — yet every room in the
 * app (the live classroom, the community chat) was keyed on branch + level +
 * sitting alone. They landed in one video room and one chat, and a tutor who
 * taught both saw a single merged "class".
 *
 * The batch is the intake month a student chose at signup, stored as a bare
 * month name on `admission.batch`. This file is the one place that reads it,
 * so a room, a roster and a push notification can never disagree about what
 * "the September batch" means.
 *
 * Pure on purpose (no prisma, no clock but the one injected): browser-safe, and
 * testable at any date.
 */

import { MONTH_NAMES, monthNameToIndex } from "@/lib/batch";

/**
 * "september " / "SEPTEMBER" → "September". Anything that is not a month
 * comes back as "", which is how a room says "no batch" — never null, so it can
 * sit in a unique key.
 */
export function canonicalBatch(raw: unknown): string {
  const index = monthNameToIndex(raw);
  return index === null ? "" : MONTH_NAMES[index];
}

/** The batch off a student's admission JSON, or "" when they have none. */
export function batchOfAdmission(admission: unknown): string {
  if (!admission || typeof admission !== "object") return "";
  return canonicalBatch((admission as Record<string, unknown>).batch);
}

/** "September" → "september". Safe inside a room name or a URL. */
export function batchSlug(batch: unknown): string {
  return canonicalBatch(batch).toLowerCase();
}

/** "September batch", or "" when there is no batch to name. */
export function batchTitle(batch: unknown): string {
  const name = canonicalBatch(batch);
  return name ? `${name} batch` : "";
}

/**
 * May this student walk into a LIVE room pinned to `roomBatch`?
 *
 * A room with no batch is the old cohort-wide room and takes everyone, which is
 * also what keeps a class that was already running at deploy time joinable.
 *
 * A student whose own batch is unknown is let in: that is a hole in our data,
 * not a reason to lock a paying student out of the class their tutor is
 * teaching right now. They show up as "(no batch)" on /admin/cohorts, where the
 * office fixes it. Pushes are stricter (see `studentIsInBatch`) so an unplaced
 * student is not buzzed for every batch's class.
 */
export function studentMayJoinBatch(roomBatch: unknown, admission: unknown): boolean {
  const room = canonicalBatch(roomBatch);
  if (!room) return true;
  const own = batchOfAdmission(admission);
  return !own || own === room;
}

/**
 * Is this student a member of the batch — exactly, no benefit of the doubt?
 * "" means "the students with no batch", which is the membership of an unplaced
 * community room. Used for who gets a push and who is in a chat.
 */
export function studentIsInBatch(roomBatch: unknown, admission: unknown): boolean {
  return canonicalBatch(roomBatch) === batchOfAdmission(admission);
}

/**
 * Where a batch month falls on the calendar relative to today, as a month
 * count (year * 12 + month): the occurrence NEAREST to now, in either direction.
 *
 * Not "the most recent one at or before now" (what `resolveBatchAbsolute`
 * does for a student looking back at a batch they sat). Two batches are being
 * ordered against each other here, and during September the October batch is
 * next month's, not last year's — reading it backwards would put it first.
 */
function nearestOccurrence(batch: string, now: Date): number | null {
  const index = monthNameToIndex(batch);
  if (index === null) return null;
  const nowAbsolute = now.getFullYear() * 12 + now.getMonth();
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const year of [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]) {
    const absolute = year * 12 + index;
    const distance = Math.abs(absolute - nowAbsolute);
    if (distance < bestDistance) {
      best = absolute;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Chronological order for batches: the one that started first comes first, and
 * "no batch" comes last. September before October, whatever month it is today.
 */
export function compareBatches(a: unknown, b: unknown, now: Date = new Date()): number {
  const left = nearestOccurrence(canonicalBatch(a), now);
  const right = nearestOccurrence(canonicalBatch(b), now);
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

/**
 * The batch a live room was opened for, read off its NAME — `ew-lagos-a1-morning-b-september-t-<tutor>`.
 *
 * A class recording remembers its room, not its batch, and the room name is the
 * one place the batch is guaranteed to survive (see `cohortRoomName`). Returns ""
 * for a room with no batch (an older class, a private room), which is "no batch
 * restriction" everywhere a recording is shared.
 */
export function batchOfRoomName(roomName: unknown): string {
  const match = /-b-([a-z]+)(?:-t-|$)/.exec(String(roomName ?? "").toLowerCase());
  return match ? canonicalBatch(match[1]) : "";
}

/**
 * May a student see something aimed at one batch? Something with no batch is for
 * everyone; something with one is for that batch's students only. A student with
 * no batch on record sees only the unrestricted things — content targeted at a
 * batch is never guessed onto someone who may belong to another.
 */
export function studentSeesBatch(contentBatch: unknown, admission: unknown): boolean {
  const wanted = canonicalBatch(contentBatch);
  return !wanted || wanted === batchOfAdmission(admission);
}
