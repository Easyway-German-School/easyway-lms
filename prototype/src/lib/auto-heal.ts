/**
 * Auto-resync: the one fully-automatic repair in Mission Control, and the
 * only one allowed to be.
 *
 * Every repair in diagnose-server.ts needs a human to click, because it can
 * mutate money or identity and a wrong guess there is expensive — see that
 * file's "five rules" for why. This pattern is different: it can never
 * mutate a student's actual access state, because there is nothing to fix.
 * When Mission Control's "lock on screen, database says open" count ticks
 * up, the database is already correct — a locked student's own browser
 * already re-checks every 30 seconds until it agrees (useStudentAccess.ts),
 * so almost every one of these clears itself within half a minute on its
 * own. What is left after that window is a screen that has stopped
 * checking in at all — the tab was closed or backgrounded — and the only
 * thing worth doing about that is nudging the student to reopen the app, so
 * their own next page load does the actual correcting.
 *
 * THE RULES, same spirit as diagnose-server.ts's five:
 *
 *   1. RE-DERIVE BEFORE ACTING. Every run reads AccessSnapshot fresh; a row
 *      that healed itself between one run and the next is simply not a
 *      candidate any more — nothing to undo, nothing stale to clean up.
 *   2. NEVER TOUCHES THE VERDICT. Read-only against AccessSnapshot, Student,
 *      Payment — not even the witness fields get written. The factual
 *      record of "what did their screen last say" stays exactly as the
 *      browser reported it.
 *   3. ONE NUDGE PER STUDENT PER COOLDOWN. A stuck screen gets one
 *      notification, not one every fifteen minutes until somebody notices.
 *   4. RATE-CAPPED. A pattern matching far more than usual stops itself for
 *      the rest of the hour rather than run away.
 *   5. LOGGED. Every decision, acted on or not, goes to AutoHealLog — that
 *      is what makes "learns from patterns" real: the Patterns tab reads
 *      live counts off this table, not a guess.
 */

import { prisma } from "@/lib/prisma";
import { KIND, notify } from "@/lib/notify";

export const PORTAL_RESYNC_PATTERN = "portal-witness-resync";

/** Still inside the locked student's own 30s-poll self-heal window — see useStudentAccess.ts. */
const FRESH_MS = 5 * 60_000;
/** The tab has been gone long enough that this is an abandoned session, not a live problem. */
const EXPIRED_MS = 24 * 60 * 60_000;
/** At most one nudge per student in a day, however many runs find them still stale. */
const NUDGE_COOLDOWN_MS = 24 * 60 * 60_000;
const RATE_WINDOW_MS = 60 * 60_000;
const CANDIDATE_LIMIT = 200;

type Action = "skipped_fresh" | "expired" | "rate_limited" | "cooldown" | "nudged" | "dry_run_nudge";

export type AutoHealRunResult = {
  ran: boolean;
  reason?: "disabled" | "no_pattern";
  evaluated: number;
  decisions: Partial<Record<Action, number>>;
};

/** Finds every student currently showing a lock while the database says open, and decides what (if anything) to do about each one. */
export async function runPortalResync(now = Date.now()): Promise<AutoHealRunResult> {
  const pattern = await prisma.autoHealPattern.findUnique({ where: { key: PORTAL_RESYNC_PATTERN } });
  if (!pattern) return { ran: false, reason: "no_pattern", evaluated: 0, decisions: {} };
  if (!pattern.enabled) return { ran: false, reason: "disabled", evaluated: 0, decisions: {} };

  const candidates = await prisma.accessSnapshot.findMany({
    where: { open: true, lastWitnessRendered: { in: ["payment", "batch", "photo"] } },
    select: { studentId: true, tenantId: true, lastWitnessAt: true, lastWitnessRendered: true },
    take: CANDIDATE_LIMIT,
  });
  if (candidates.length === 0) return { ran: true, evaluated: 0, decisions: {} };

  const students = await prisma.student.findMany({
    where: { id: { in: candidates.map((c) => c.studentId) } },
    select: { id: true, userId: true },
  });
  const userIdOf = new Map(students.map((s) => [s.id, s.userId]));

  let nudgedThisHour = await prisma.autoHealLog.count({
    where: { pattern: pattern.key, action: { in: ["nudged", "dry_run_nudge"] }, createdAt: { gt: new Date(now - RATE_WINDOW_MS) } },
  });

  const decisions: Partial<Record<Action, number>> = {};
  const bump = (action: Action) => { decisions[action] = (decisions[action] ?? 0) + 1; };

  for (const row of candidates) {
    const ageMs = row.lastWitnessAt ? now - row.lastWitnessAt.getTime() : Number.POSITIVE_INFINITY;
    let action: Action;

    if (ageMs < FRESH_MS) {
      action = "skipped_fresh";
    } else if (ageMs >= EXPIRED_MS) {
      action = "expired";
    } else if (nudgedThisHour >= pattern.maxPerHour) {
      action = "rate_limited";
    } else {
      const cooledDown = await prisma.autoHealLog.findFirst({
        where: {
          pattern: pattern.key,
          studentId: row.studentId,
          action: { in: ["nudged", "dry_run_nudge"] },
          createdAt: { gt: new Date(now - NUDGE_COOLDOWN_MS) },
        },
        select: { id: true },
      });
      if (cooledDown) {
        action = "cooldown";
      } else if (pattern.dryRun) {
        action = "dry_run_nudge";
        nudgedThisHour++;
      } else {
        const userId = userIdOf.get(row.studentId);
        if (userId) {
          await notify({
            to: { userIds: [userId] },
            kind: KIND.portalResync,
            severity: "info",
            title: "Your Easyway status was just updated",
            message: "Reopen the app to see your current dashboard.",
            link: "/dashboard",
            push: true,
            email: false,
            sms: false,
            dedupeKey: `${pattern.key}:${row.studentId}:${Math.floor(now / NUDGE_COOLDOWN_MS)}`,
          }).catch(() => {});
        }
        action = "nudged";
        nudgedThisHour++;
      }
    }

    bump(action);
    await prisma.autoHealLog
      .create({
        data: {
          pattern: pattern.key,
          action,
          studentId: row.studentId,
          tenantId: row.tenantId,
          detail: { lastWitnessRendered: row.lastWitnessRendered, ageMs: Number.isFinite(ageMs) ? Math.round(ageMs) : null } as never,
        },
      })
      .catch(() => {});
  }

  return { ran: true, evaluated: candidates.length, decisions };
}

export type AutoHealStats = {
  pattern: { key: string; enabled: boolean; dryRun: boolean; maxPerHour: number; updatedAt: string };
  last24h: Partial<Record<Action, number>>;
  last7d: Partial<Record<Action, number>>;
  lastRunAt: string | null;
};

/** What the Patterns tab shows: real counts off AutoHealLog, not a stored model. */
export async function autoHealStats(now = Date.now()): Promise<AutoHealStats | null> {
  const pattern = await prisma.autoHealPattern.findUnique({ where: { key: PORTAL_RESYNC_PATTERN } });
  if (!pattern) return null;

  const [rows24h, rows7d, last] = await Promise.all([
    prisma.autoHealLog.groupBy({
      by: ["action"],
      where: { pattern: pattern.key, createdAt: { gt: new Date(now - 24 * 60 * 60_000) } },
      _count: { _all: true },
    }),
    prisma.autoHealLog.groupBy({
      by: ["action"],
      where: { pattern: pattern.key, createdAt: { gt: new Date(now - 7 * 24 * 60 * 60_000) } },
      _count: { _all: true },
    }),
    prisma.autoHealLog.findFirst({ where: { pattern: pattern.key }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);

  const fold = (rows: { action: string; _count: { _all: number } }[]) => {
    const out: Partial<Record<Action, number>> = {};
    for (const row of rows) out[row.action as Action] = row._count._all;
    return out;
  };

  return {
    pattern: { key: pattern.key, enabled: pattern.enabled, dryRun: pattern.dryRun, maxPerHour: pattern.maxPerHour, updatedAt: pattern.updatedAt.toISOString() },
    last24h: fold(rows24h),
    last7d: fold(rows7d),
    lastRunAt: last?.createdAt.toISOString() ?? null,
  };
}

/** Flip the kill switch, or toggle dry-run, from the Patterns tab. */
export async function setAutoHealPattern(key: string, patch: { enabled?: boolean; dryRun?: boolean }, updatedById: string): Promise<boolean> {
  if (key !== PORTAL_RESYNC_PATTERN) return false;
  await prisma.autoHealPattern.update({
    where: { key },
    data: { ...patch, updatedById },
  });
  return true;
}
