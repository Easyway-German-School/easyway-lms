/**
 * PLACING A STUDENT WHO HAS NO BATCH ON RECORD — the rule, and nothing else.
 *
 * A student with no `admission.batch` belongs to no batch's class, calendar, chat
 * or materials, and is shown as "not placed" everywhere. That is the one remaining
 * gap in the batch separation, and it is mostly old data (imports, students added
 * before the intake default existed). The system already holds the evidence to fix
 * most of them: the enrolment-history row, the month they first attended, the
 * intake they registered into.
 *
 * This decides, from the classifier's reading, whether that evidence is clear
 * enough to place someone WITHOUT a person looking. The bar is deliberately high,
 * because a wrong batch moves a student onto the wrong timetable:
 *
 *   - It only ever FILLS an empty batch. It never changes one that exists.
 *   - Conflicting evidence (the classifier's `mismatch`) means "a person decides".
 *   - A returning student is placed only from their open enrolment row. Their
 *     earliest activity may be from a PREVIOUS level, months ago, and would give
 *     them a batch they left long since.
 *   - An activity-derived batch must be recent: a level runs two months (three
 *     weekends), so a "start" more than 4 months back means the evidence is stale,
 *     not that the student is four months into a two-month level.
 *
 * Everything else is left for the office, with the reason.
 *
 * Pure — no database. `batch-placement-server.ts` does the reading and writing.
 */

import { MONTH_NAMES, monthNameToIndex } from "@/lib/batch";
import type { CohortClassification } from "@/lib/cohort-classify";

export type PlacementDecision =
  | { place: true; batch: string; reason: string; basis: "enrolment" | "first-attendance" | "new-intake" }
  | { place: false; reason: string };

/** A level runs two months; evidence older than this has outlived the batch it would point at. */
const MAX_MONTHS_BACK = 4;

/** Months from `batch` (its most recent occurrence at or before `now`) to `now`. */
export function monthsSinceBatchStart(batch: string, now: Date): number | null {
  const index = monthNameToIndex(batch);
  if (index === null) return null;
  const year = index <= now.getMonth() ? now.getFullYear() : now.getFullYear() - 1;
  return now.getFullYear() * 12 + now.getMonth() - (year * 12 + index);
}

export function decidePlacement(input: {
  classification: CohortClassification;
  /** The batch the open enrolment row names, if there is one (already read by the classifier). */
  enrolmentBatchMonth: string | null;
  /** The school's current intake month, e.g. "October". */
  currentIntakeMonth: string;
  now?: Date;
}): PlacementDecision {
  const now = input.now ?? new Date();
  const c = input.classification;

  if (c.mismatch) return { place: false, reason: `Evidence conflicts: ${c.mismatch}` };

  // 1. The enrolment history says which batch this level was started in. The strongest evidence there is.
  const enrolment = input.enrolmentBatchMonth ? MONTH_NAMES[monthNameToIndex(input.enrolmentBatchMonth) ?? -1] : undefined;
  if (enrolment) {
    return { place: true, batch: enrolment, basis: "enrolment", reason: `Their enrolment record for this level says the ${enrolment} batch` };
  }

  // 2. A brand-new student in the current intake window: the same default signup applies.
  if (c.status === "new" && c.confidence === "high") {
    const month = MONTH_NAMES[monthNameToIndex(input.currentIntakeMonth) ?? -1];
    if (month) return { place: true, batch: month, basis: "new-intake", reason: `Registered into the current ${month} intake and nothing has happened yet` };
    return { place: false, reason: "The current intake month is not set" };
  }

  // 3. Mid-course with hard evidence (attendance, a start date…): the month they started.
  if (c.status === "ongoing" && c.confidence === "high" && c.suggestedBatch) {
    const batch = MONTH_NAMES[monthNameToIndex(c.suggestedBatch) ?? -1];
    if (!batch) return { place: false, reason: "The evidence points at no recognisable month" };
    const back = monthsSinceBatchStart(batch, now);
    if (back === null || back > MAX_MONTHS_BACK) {
      return { place: false, reason: `Their activity starts in ${batch}, too long ago to be this level's batch` };
    }
    return { place: true, batch, basis: "first-attendance", reason: `First marked present / started in ${batch}` };
  }

  if (c.status === "returning") {
    return { place: false, reason: "Returning student with no enrolment record for this level — which batch they joined needs a person" };
  }
  return { place: false, reason: c.status === "unknown" ? "No attendance, classwork or start date on file — a person must say" : "Not enough evidence yet" };
}
