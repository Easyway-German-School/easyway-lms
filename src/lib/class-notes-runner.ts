import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runUnscoped } from "@/lib/tenant/context";
import { MIN_RECORDING_START_MS, processTranscriptionQueue, transcriptionBacklogWhere } from "@/lib/class-transcription";
import { processMaterialQueue } from "@/lib/material-ai";

/**
 * THE CLASS-NOTES QUEUE, RUNNING ITSELF.
 *
 * Until this existed the only things that ever worked the backlog were the daily
 * cron (two recordings a day) and an admin pressing "Drain the backlog" and
 * keeping the tab open — the loop lived in the browser, so closing the page
 * stopped it, and a press that tried too much per request came back as a 504.
 *
 * Now the work happens on the server, in its own function invocation, and keeps
 * itself going:
 *
 *   1. A run works for at most `budgetMs`, one item at a time, and never starts
 *      an item it cannot finish (so it can never be cut off by the platform's
 *      time limit mid-recording).
 *   2. If it made progress and work remains, it KICKS the next run — one short
 *      HTTP request to /api/cron/class-notes, which answers immediately and
 *      does its work after the response. Each link in the chain is a fresh
 *      function with a full time budget.
 *   3. If it made NO progress (a rate limit, a model outage, the speech-to-text
 *      allowance used up) the chain stops rather than hammering. The next
 *      trigger restarts it: the daily tick, the end of the next recorded class,
 *      or the admin button.
 *
 * Only one run works the queue at a time (a lease, below): the free AI tier's
 * per-minute budget is shared, so two runners would just starve each other.
 */

const LEASE_KEY = "lock:class-notes-runner";
const BACKLOG_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** Two rounds in a row that produced nothing means "stuck", not "slow". */
const STALL_LIMIT = 2;

export type RunSummary = {
  ran: boolean;
  /** Why it did not run, when it did not. */
  reason?: string;
  recordings: { attempted: number; created: number; failed: number };
  documents: { attempted: number; ready: number; skipped: number };
  /** Recordings and handouts still waiting after this run. */
  remaining: number;
  /** Did this run finish anything — i.e. is kicking another one worth it. */
  progressed: boolean;
  ms: number;
};

/**
 * A lease in the shared AiCache table: one row, taken by creating it or by
 * stealing it once it is older than the run could possibly last. Released by
 * back-dating it. No advisory locks — those do not survive a pooled connection.
 */
async function acquireLease(ttlMs: number): Promise<boolean> {
  const now = Date.now();
  try {
    await prisma.aiCache.create({ data: { key: LEASE_KEY, task: "lock", value: { at: now }, status: "ready" } });
    return true;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
  }
  const stolen = await prisma.aiCache.updateMany({
    where: { key: LEASE_KEY, updatedAt: { lt: new Date(now - ttlMs) } },
    data: { value: { at: now } },
  });
  return stolen.count === 1;
}

async function releaseLease(): Promise<void> {
  await prisma.aiCache.updateMany({ where: { key: LEASE_KEY }, data: { updatedAt: new Date(0) } }).catch(() => {});
}

/** How much is still waiting: recordings the queue would pick up, plus handouts not yet written up. */
export async function countBacklog(): Promise<{ recordings: number; documents: number }> {
  const since = new Date(Date.now() - BACKLOG_WINDOW_MS);
  const [recordings, documents] = await Promise.all([
    prisma.classRecording.count({ where: transcriptionBacklogWhere(since) }),
    prisma.material.count({
      where: {
        kind: { notIn: ["recording", "audio", "video"] },
        createdAt: { gte: since },
        aiState: { in: ["none", "pending"] },
      },
    }),
  ]);
  return { recordings, documents };
}

export async function runClassNotes(options: { budgetMs: number }): Promise<RunSummary> {
  const started = Date.now();
  const deadlineAt = started + options.budgetMs;
  const empty: RunSummary = {
    ran: false,
    recordings: { attempted: 0, created: 0, failed: 0 },
    documents: { attempted: 0, ready: 0, skipped: 0 },
    remaining: 0,
    progressed: false,
    ms: 0,
  };

  // Every tenant's recordings, not one school's: this is the platform's queue.
  return runUnscoped("the class-notes runner works every tenant's recordings and handouts", async () => {
    if (!(await acquireLease(options.budgetMs + 60_000))) {
      return { ...empty, reason: "another run is already working the queue", ms: Date.now() - started };
    }

    const summary: RunSummary = { ...empty, ran: true };
    try {
      // RECORDINGS FIRST — a class recap is what students are waiting for, and it
      // is the heavy, slow job. One at a time, so the deadline is checked between each.
      let stalls = 0;
      while (deadlineAt - Date.now() >= MIN_RECORDING_START_MS) {
        const round = await processTranscriptionQueue(1, { deadlineAt });
        summary.recordings.attempted += round.attempted;
        summary.recordings.created += round.created;
        summary.recordings.failed += round.failed;
        if (round.attempted === 0) break;
        stalls = round.created > 0 ? 0 : stalls + 1;
        if (stalls >= STALL_LIMIT) break;
      }

      // HANDOUTS with whatever time is left. (They still wait for a tutor's sign-off
      // before a student sees anything.)
      stalls = 0;
      while (deadlineAt - Date.now() >= 45_000) {
        const round = await processMaterialQueue(1, undefined, { deadlineAt });
        summary.documents.attempted += round.attempted;
        summary.documents.ready += round.ready;
        summary.documents.skipped += round.skipped;
        if (round.attempted === 0) break;
        stalls = round.ready > 0 ? 0 : stalls + 1;
        if (stalls >= STALL_LIMIT) break;
      }

      const left = await countBacklog();
      summary.remaining = left.recordings + left.documents;
      summary.progressed = summary.recordings.created > 0 || summary.documents.ready > 0;
    } finally {
      await releaseLease();
    }

    summary.ms = Date.now() - started;
    return summary;
  });
}

/** The site's own public address, for the runner to call itself on. */
export function appOrigin(): string | null {
  const explicit = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "").trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(explicit) && !/localhost|127\.0\.0\.1/i.test(explicit)) return explicit;
  const vercel = (process.env.VERCEL_PROJECT_PRODUCTION_URL || "").trim();
  return vercel ? `https://${vercel}` : null;
}

/**
 * Start (or continue) the background run. Returns as soon as the run has been
 * ACCEPTED — the route answers 202 and does its work after the response — so
 * callers (a webhook, the admin button, the previous link in the chain) are
 * never held up by it. False when it could not be started, so the caller can
 * fall back to doing a little inline.
 */
export async function kickClassNotes(origin?: string | null): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  const base = (origin ?? appOrigin())?.replace(/\/+$/, "");
  if (!secret || !base) return false;
  try {
    const response = await fetch(`${base}/api/cron/class-notes`, {
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(15_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
