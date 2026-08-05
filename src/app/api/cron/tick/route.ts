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
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
// The reconcile and retention passes talk to LiveKit and to the bucket, which
// on a bad day is slower than the 10s default.
export const maxDuration = 60;

type JobResult = { job: string; ok: boolean; detail?: unknown; error?: string };

async function run(job: string, work: () => Promise<unknown>): Promise<JobResult> {
  try {
    return { job, ok: true, detail: await work() };
  } catch (error) {
    console.error(`Cron job ${job} failed:`, error);
    return { job, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function GET(request: NextRequest) {
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

  const results: JobResult[] = [];

  results.push(
    await run("email-queue", async () => {
      const { drainQueue } = await import("@/lib/email-queue");
      return drainQueue(50);
    }),
  );

  results.push(
    await run("payment-warnings", async () => {
      const { runPaymentWarnings } = await import("@/lib/payment-warnings");
      return runPaymentWarnings({ dryRun: false });
    }),
  );

  results.push(
    await run("fee-reminders", async () => {
      const { sendDueFeeReminders } = await import("@/lib/fee-reminders");
      return sendDueFeeReminders();
    }),
  );

  results.push(
    await run("recording-reconcile", async () => {
      const { reconcileRecordings } = await import("@/lib/class-recorder");
      return reconcileRecordings();
    }),
  );

  /**
   * Retention deletes lesson recordings, so it does not run itself on the
   * strength of a schedule existing.
   *
   * `RETENTION_AUTO=true` is the school saying it has read the policy and
   * wants it enforced. Until then this reports what it *would* reclaim, which
   * is the number worth looking at before handing a cron the power to delete a
   * term's teaching.
   */
  const retentionAuto = process.env.RETENTION_AUTO === "true";
  results.push(
    await run(retentionAuto ? "retention" : "retention-dry-run", async () => {
      const { applyRetention } = await import("@/lib/retention");
      return applyRetention({ dryRun: !retentionAuto });
    }),
  );

  /**
   * Ask, once a day, whether the backups are still happening.
   *
   * Deliberately runs here rather than as its own schedule. This tick is the
   * one job the school will notice breaking, because the mail queue and the
   * fee reminders ride on it — so if the health check ever stops running, the
   * silence gets noticed for other reasons within a day. A lone cron watching
   * the backups could itself fail silently, which would leave two things
   * broken and nothing left to report either of them.
   */
  results.push(
    await run("backup-health", async () => {
      const { checkBackupHealth } = await import("@/lib/backup-health");
      return checkBackupHealth();
    }),
  );

  /**
   * Summarise newly uploaded materials and turn them into quests.
   *
   * Last, and capped at three per tick, because it is the only job here that
   * competes for memory with the site itself — a language model and a Next
   * server on the same 7GB machine is a real constraint, not a theoretical
   * one. Tutors upload days before the class, so there is no hurry; what
   * matters is that it is done before students look, not that it is done now.
   *
   * Never fails the tick. A model being unreachable must not turn the mail
   * queue's cron into a red line.
   */
  results.push(
    await run("material-ai", async () => {
      try {
        const { processMaterialQueue } = await import("@/lib/material-ai");
        return await processMaterialQueue(3);
      } catch (error) {
        return { skipped: true, reason: error instanceof Error ? error.message : String(error) };
      }
    }),
  );

  const failed = results.filter((result) => !result.ok);
  return NextResponse.json(
    { ok: failed.length === 0, ran: results.length, results },
    // A non-200 when something failed is what makes Vercel's cron log show a
    // red line instead of a green one.
    { status: failed.length ? 500 : 200 },
  );
}
