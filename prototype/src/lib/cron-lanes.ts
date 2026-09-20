/**
 * THE DAILY TICK, SPLIT INTO COMPARTMENTS.
 *
 * Until this existed, /api/cron/tick ran all 36 periodic jobs one after another
 * inside a single function, once a day, with a 300-second ceiling. That is one
 * flooded compartment sinking the ship:
 *
 *   - a job that hangs (a partner's webhook endpoint that never answers, a
 *     LiveKit call with no timeout) stood between every later job and its turn;
 *   - a job that is merely SLOW spent time the jobs behind it needed;
 *   - and because it only runs once a day, whatever did not get its turn did not
 *     run until tomorrow — "your streak ends today" is worth nothing a day late.
 *
 * The fix is the BULKHEAD pattern (see lib/resilience.ts): give each kind of work
 * its own compartment with its own time budget, so a fault in one cannot spend
 * another's share. Here a compartment is a LANE.
 *
 *   prelude   payment-plans runs first, alone. Other jobs decide who is locked out
 *             (a "you can submit assignments now" nudge must not go to somebody
 *             whose plan lapsed this morning), so the sweep has to land before them.
 *   then, all at the same time:
 *   delivery       money and mail            (DB + mail)
 *   nudges         the cheap notifications   (DB)
 *   housekeeping   metering, backups, hooks  (DB + partner HTTP)
 *   ai             model-generated content   (LLM providers)
 *   media          recordings, transcripts   (LiveKit, storage, speech-to-text)
 *
 * Lanes are chosen by WHAT THE WORK DEPENDS ON, because that is what fails
 * together. A slow LLM provider should be able to hurt the "ai" lane and nothing
 * else; a dead LiveKit, only "media".
 *
 * WITHIN a lane, jobs still run one after another in their original order, so
 * every ordering the code relied on (meter usage, THEN roll it up; reconcile a
 * recording, THEN transcribe it) is preserved. Each job also has its own cap, so
 * one stuck job costs its lane at most that long and the lane carries on.
 *
 * The one thing this cannot do is kill a running job — see withTimeout. A job
 * that overruns is abandoned, reported as timed out, and left to finish or be
 * frozen with the function. That is enough: the point is that the others no
 * longer wait for it.
 */

import { withTimeout, TimeoutError } from "@/lib/resilience";

export type LaneSpec = {
  name: string;
  /** Total time this lane may spend, all its jobs together. */
  budgetMs: number;
  /** The most any single job in it may take. */
  jobBudgetMs: number;
  /** Job names, in the order they must run. */
  jobs: string[];
  /** Per-job overrides of `jobBudgetMs`. */
  caps?: Record<string, number>;
};

export type TickPlan = { prelude: string[]; preludeBudgetMs: number; lanes: LaneSpec[] };

/**
 * Sized so the whole tick finishes inside Vercel's 300s with room to send the
 * response and the failure alerts: prelude (≤30s) + the longest lane (≤200s) +
 * slack. Lanes run at the same time, so their budgets do not add up.
 */
export const TICK_BUDGET_MS = 270_000;

export const CRON_PLAN: TickPlan = {
  prelude: ["payment-plans"],
  preludeBudgetMs: 30_000,
  lanes: [
    {
      name: "delivery",
      budgetMs: 90_000,
      jobBudgetMs: 45_000,
      jobs: ["email-queue", "sms-queue", "accountant-digest", "admin-brief-digest", "payment-warnings", "fee-reminders"],
    },
    {
      name: "nudges",
      budgetMs: 150_000,
      jobBudgetMs: 45_000,
      jobs: [
        "seat-nudges",
        "exam-reminders",
        "exam-campaign-reminders",
        "pretest-reminders",
        "auto-release-results",
        "result-release-nudge",
        "churn-risk",
        "recording-expiry-nudge",
        "profile-photo-nudge",
        "profile-branch-nudge",
        "profile-details-nudge",
        "material-send-nudge",
        "assignment-availability-nudge",
        "streak-reminders",
        "satzkette-turns",
        "work-drive-event-reminders",
      ],
    },
    {
      name: "housekeeping",
      budgetMs: 120_000,
      jobBudgetMs: 40_000,
      jobs: [
        "student-code-backfill",
        "backup-health",
        "sign-in-anomaly",
        "meter-storage",
        "meter-active-students",
        "usage-rollup",
        "webhooks",
        "low-balance-warnings",
        "work-drive-retention",
      ],
      // Delivers to PARTNERS' servers, which we do not control and which are the
      // likeliest thing here to be slow. Give it less rope than the rest.
      caps: { webhooks: 30_000 },
    },
    {
      name: "ai",
      budgetMs: 150_000,
      jobBudgetMs: 100_000,
      jobs: ["daily-missions-push", "material-ai"],
    },
    {
      name: "media",
      budgetMs: 200_000,
      jobBudgetMs: 190_000,
      jobs: ["recording-reconcile", "class-transcription"],
      // Reconcile is a safety net that talks to LiveKit and storage; if they are sick
      // it must not eat the time transcription (the heavy job) needs.
      caps: { "recording-reconcile": 45_000 },
    },
  ],
};

export type JobStatus = "ok" | "failed" | "timed_out" | "skipped";

export type JobOutcome = {
  job: string;
  lane: string;
  ok: boolean;
  status: JobStatus;
  detail?: unknown;
  error?: string;
  ms: number;
};

export type LaneSummary = {
  name: string;
  ms: number;
  budgetMs: number;
  ran: number;
  failed: number;
  timedOut: number;
  skipped: number;
};

export type RunTickOptions = {
  /** Registered jobs, in the order the route declared them. */
  jobs: Map<string, () => Promise<unknown>>;
  plan?: TickPlan;
  /** Run only the prelude and this one lane (for triggering a lane on its own). */
  only?: string;
  budgetMs?: number;
  /** Called for every job that fails or times out. Must not throw. */
  onError?: (job: string, error: unknown) => void | Promise<void>;
  now?: () => number;
};

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function runOne(
  name: string,
  lane: string,
  work: (() => Promise<unknown>) | undefined,
  allowedMs: number,
  now: () => number,
  onError: RunTickOptions["onError"],
): Promise<JobOutcome> {
  const started = now();
  if (!work) return { job: name, lane, ok: false, status: "failed", error: "job is in the plan but was never registered", ms: 0 };
  // Less than a second of budget left is not a real chance to run anything.
  if (allowedMs < 1000) {
    return { job: name, lane, ok: false, status: "skipped", error: "skipped: the lane's time budget was already spent", ms: 0 };
  }
  try {
    const detail = await withTimeout(work, allowedMs, name);
    return { job: name, lane, ok: true, status: "ok", detail, ms: now() - started };
  } catch (error) {
    const timedOut = error instanceof TimeoutError;
    try {
      await onError?.(name, error);
    } catch {
      // The error sink is best-effort; the outcome below is the record that matters.
    }
    return { job: name, lane, ok: false, status: timedOut ? "timed_out" : "failed", error: errorText(error), ms: now() - started };
  }
}

async function runLane(
  spec: Pick<LaneSpec, "name" | "budgetMs" | "jobBudgetMs" | "caps">,
  names: string[],
  options: RunTickOptions,
  budgetMs: number,
): Promise<{ outcomes: JobOutcome[]; summary: LaneSummary }> {
  const now = options.now ?? Date.now;
  const started = now();
  const outcomes: JobOutcome[] = [];

  for (const name of names) {
    const remaining = budgetMs - (now() - started);
    const cap = spec.caps?.[name] ?? spec.jobBudgetMs;
    outcomes.push(await runOne(name, spec.name, options.jobs.get(name), Math.min(cap, remaining), now, options.onError));
  }

  return {
    outcomes,
    summary: {
      name: spec.name,
      ms: now() - started,
      budgetMs,
      ran: outcomes.filter((o) => o.status !== "skipped").length,
      failed: outcomes.filter((o) => o.status === "failed").length,
      timedOut: outcomes.filter((o) => o.status === "timed_out").length,
      skipped: outcomes.filter((o) => o.status === "skipped").length,
    },
  };
}

/**
 * Run the tick: the prelude, then every lane at the same time.
 *
 * Results come back in the ORDER THE ROUTE DECLARED THE JOBS, not the order they
 * finished, so the response reads the same as it always did and a person scanning
 * it is not confused by lanes finishing out of turn.
 */
export async function runTick(options: RunTickOptions): Promise<{ results: JobOutcome[]; lanes: LaneSummary[] }> {
  const plan = options.plan ?? CRON_PLAN;
  const now = options.now ?? Date.now;
  const tickStart = now();
  const totalBudget = options.budgetMs ?? TICK_BUDGET_MS;
  const remainingTotal = () => Math.max(0, totalBudget - (now() - tickStart));

  const planned = new Set<string>([...plan.prelude, ...plan.lanes.flatMap((lane) => lane.jobs)]);
  // A job somebody added to the route but not to the plan must not silently never
  // run. It gets a small lane of its own; a test fails the build so it is noticed.
  const unassigned = [...options.jobs.keys()].filter((name) => !planned.has(name));
  if (unassigned.length) console.warn("[cron] jobs missing from CRON_PLAN, running in a fallback lane:", unassigned.join(", "));

  const lanes: Array<Pick<LaneSpec, "name" | "budgetMs" | "jobBudgetMs" | "caps"> & { jobs: string[] }> = [
    ...plan.lanes.filter((lane) => !options.only || lane.name === options.only),
    ...(unassigned.length && !options.only ? [{ name: "unassigned", budgetMs: 60_000, jobBudgetMs: 30_000, jobs: unassigned }] : []),
  ];

  const outcomes: JobOutcome[] = [];

  // PRELUDE — alone, before everything, with its own small budget.
  const prelude = await runLane(
    { name: "prelude", budgetMs: plan.preludeBudgetMs, jobBudgetMs: plan.preludeBudgetMs },
    plan.prelude,
    options,
    Math.min(plan.preludeBudgetMs, remainingTotal()),
  );
  outcomes.push(...prelude.outcomes);
  const summaries: LaneSummary[] = [prelude.summary];

  // LANES — concurrently. No lane's budget can exceed what the whole tick has left.
  const settled = await Promise.all(
    lanes.map((lane) => runLane(lane, lane.jobs, options, Math.min(lane.budgetMs, remainingTotal()))),
  );
  for (const lane of settled) {
    outcomes.push(...lane.outcomes);
    summaries.push(lane.summary);
  }

  const declared = [...options.jobs.keys()];
  const rank = (job: string) => {
    const i = declared.indexOf(job);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  outcomes.sort((a, b) => rank(a.job) - rank(b.job));
  return { results: outcomes, lanes: summaries };
}
