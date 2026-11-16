/**
 * The one endpoint a scheduler calls. Everything periodic runs from here.
 *
 * ---------------------------------------------------------------------------
 * WHY A SINGLE DISPATCHER
 * ---------------------------------------------------------------------------
 * Two reasons, and both of them are Vercel's.
 *
 * First, Vercel Cron issues a **GET** and nothing else. The existing jobs do
 * their work on POST and keep GET as a read-only status view — a sensible
 * design, and one that means a cron pointed straight at them would have
 * returned 200, reported healthy, and sent no email for the rest of the year.
 * That is the worst kind of broken: silent, and indistinguishable from "there
 * was nothing to do".
 *
 * Second, the Hobby plan allows two cron jobs. There are five things to run.
 * One entry that runs all of them is not a workaround so much as the shape the
 * platform wants.
 *
 * Each job is isolated: one throwing does not stop the rest, and the response
 * says per job what happened. A cron whose failures are invisible is a cron
 * nobody trusts, so this reports rather than swallows.
 *
 * ---------------------------------------------------------------------------
 * LANES — ONE SLOW JOB MUST NOT COST THE OTHERS THEIR TURN
 * ---------------------------------------------------------------------------
 * This runs ONCE A DAY, so a job that does not get its turn does not run until
 * tomorrow. It used to run all the jobs one after another in this single
 * function, which meant one hung job (a partner's webhook endpoint, a LiveKit
 * call with no timeout) stood between every later job and its turn.
 *
 * Now the jobs are grouped into LANES by what they depend on — mail and money,
 * cheap notifications, metering and hooks, AI content, recordings and
 * transcripts — and the lanes run at the same time, each with its own time
 * budget and a cap per job. A stuck job is abandoned at its cap, reported as
 * timed out, and its lane carries on; a lane that spends its budget skips the
 * rest of ITS jobs and touches nobody else's. That is the bulkhead pattern; the
 * plan, the reasoning and the runner are in src/lib/cron-lanes.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { withUnscoped } from "@/lib/tenant/context";
import { CRON_PLAN, TICK_BUDGET_MS, runTick } from "@/lib/cron-lanes";
import { buildDailyCronJobs, notifyFailedCronJobs } from "@/lib/cron-jobs";

export const dynamic = "force-dynamic";
// The reconcile and retention passes talk to LiveKit and to the bucket, and
// the transcription pass streams a full class recording through ffmpeg — on a
// bad day none of that fits in 60s. 300s is the Pro plan's ceiling.
export const maxDuration = 300;

async function handleGET(request: NextRequest) {
  /**
   * Vercel signs its own cron requests with `Authorization: Bearer $CRON_SECRET`
   * as long as CRON_SECRET is set in the project's environment. Without a
   * secret set, this route refuses everybody — an open endpoint that drains a
   * mail queue is a way to get the school's domain blacklisted.
   */
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }


  /**
   * Jobs are REGISTERED here, in the order they must run relative to each other,
   * and EXECUTED below by runTick(), which groups them into lanes (see
   * src/lib/cron-lanes.ts). Registering costs nothing; nothing runs until the
   * last one is declared. The order matters only WITHIN a lane, so a job that
   * has to follow another (roll usage up AFTER metering it) goes after it here
   * AND is placed after it in CRON_PLAN — a test checks the two agree.
   */
  // Job registrations live in cron-jobs.ts, shared with the standalone
  // runner (scripts/standalone-cron.ts) so the two front doors can never
  // drift apart.
  const jobs = buildDailyCronJobs();

  /**
   * `?lane=<name>` runs the prelude plus that one lane and nothing else. Lanes
   * are independent compartments, so they can also be TRIGGERED independently:
   * point a second scheduler at `?lane=media` and the heavy transcription work
   * gets a whole function of its own instead of sharing this one's 300 seconds.
   */
  const onlyLane = new URL(request.url).searchParams.get("lane") ?? undefined;
  if (onlyLane && !CRON_PLAN.lanes.some((lane) => lane.name === onlyLane)) {
    return NextResponse.json(
      { error: `Unknown lane "${onlyLane}"`, lanes: CRON_PLAN.lanes.map((lane) => lane.name) },
      { status: 400 },
    );
  }

  const { results, lanes } = await runTick({
    jobs,
    only: onlyLane,
    budgetMs: TICK_BUDGET_MS,
    // Every failed or timed-out job is logged and recorded as an incident (route
    // "cron:<job>"), so it shows up in the developer console, not just a red line
    // in a log nobody reads.
    onError: async (job, error) => {
      console.error(`Cron job ${job} failed:`, error);
      try {
        const { captureError } = await import("@/lib/capture-error");
        await captureError("cron", error, { job });
      } catch {
        // The error sink is best-effort; the job result is the record that matters.
      }
    },
  });

  const failed = results.filter((result) => !result.ok);

  /**
   * The 500 below turns Vercel's cron log red — but nobody watches the cron
   * log, which is exactly the "a failure nobody sees" gap in docs/SECURITY.md
   * §8. So a failed job also raises an alert to whoever holds `security`,
   * deduped per job per day: one broken job is one message a morning, not a
   * red line in a dashboard no one opens and not fifteen pages an hour.
   */
  await notifyFailedCronJobs(failed);

  return NextResponse.json(
    // `results` keeps its old shape (job / ok / detail / error) and gains lane, status and ms;
    // `lanes` says how long each compartment took against its budget.
    { ok: failed.length === 0, ran: results.length, results, lanes },
    // A non-200 when something failed is what makes Vercel's cron log show a
    // red line instead of a green one.
    { status: failed.length ? 500 : 200 },
  );
}

/**
 * Wrapped rather than marked inside the body: the scope has to be
 * established before the handler runs, not on its first line. See
 * withUnscoped in src/lib/tenant/context.ts.
 */
export const GET = withUnscoped(
  "the platform cron dispatcher runs every periodic job for every tenant",
  handleGET,
);
