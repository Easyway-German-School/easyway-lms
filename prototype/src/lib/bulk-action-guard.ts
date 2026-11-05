/**
 * The blast-radius guard — the thing that should have stopped the 2026-11-05 sweep
 * incident before it ever reached the database.
 *
 * A bulk admin action (move a swept batch, adopt stragglers into it, graduate a
 * finished cohort) is chunked ten-or-so at a time from the browser, so there is no
 * single request a size cap on `studentIds` can catch — a loop of small, legitimate
 * calls can still rewrite hundreds of learners in under a minute. The guard instead
 * looks at the TOTAL the server itself computed as eligible (the sweep's own count,
 * not whatever the browser sends), before a single row is written, and — above a
 * plain threshold — refuses to act until the caller echoes back that exact number.
 * That number can only come from a human who has actually read it, which is the
 * point: the admin who pressed "Move to November" never saw "201", because the
 * desk's own confirm() dialog never said so either.
 *
 * Deliberately NOT a hard cap. The office genuinely does move large cohorts (a
 * whole finished batch is often 50+ learners) — the guard asks for a second,
 * specific look, it never refuses outright.
 */

export const BULK_ACTION_WARN_THRESHOLD = 30;

export type ConfirmationCheck =
  | { needsConfirmation: false }
  | { needsConfirmation: true; total: number };

/**
 * `total` is the server's own count of everyone this action is ABOUT to touch —
 * never a count supplied by the browser. `confirmedTotal` is what the caller
 * echoed back; it must match exactly, so a stale confirmation from a different
 * (smaller, already-acted-on) sweep can never wave through a bigger one.
 */
export function checkBulkActionSize(total: number, confirmedTotal?: number | null): ConfirmationCheck {
  if (total <= BULK_ACTION_WARN_THRESHOLD) return { needsConfirmation: false };
  if (confirmedTotal === total) return { needsConfirmation: false };
  return { needsConfirmation: true, total };
}
