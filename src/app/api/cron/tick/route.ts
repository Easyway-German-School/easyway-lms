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
import { withUnscoped } from "@/lib/tenant/context";

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


  const results: JobResult[] = [];

  results.push(
    await run("email-queue", async () => {
      const { drainQueue } = await import("@/lib/email-queue");
      return drainQueue(50);
    }),
  );

  results.push(
    await run("payment-plans", async () => {
      // Move plans to completed/defaulted BEFORE the reminder jobs, so a plan
      // that lapsed today is no longer holding the lock back when they run.
      const { sweepPaymentPlans } = await import("@/lib/payment-plans");
      return sweepPaymentPlans();
    }),
  );

  results.push(
    await run("accountant-digest", async () => {
      // Self-gated: idempotent per ISO week via the notification dedupeKey.
      const { sendAccountantDigest } = await import("@/lib/accountant-digest");
      return sendAccountantDigest();
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

  /**
   * Exam reminders used to only exist as a manual "send now" button an admin
   * had to remember to click — nothing scheduled it, so a student who
   * registered got no reminder unless someone in the office thought to. This
   * fires once, on the single calendar day three days before each sitting.
   */
  results.push(
    await run("exam-reminders", async () => {
      const { sendDueExamReminders } = await import("@/lib/exam-reminders");
      return sendDueExamReminders();
    }),
  );

  /**
   * A tutor's students going quiet — low attendance, no portal activity, or
   * repeated "not yet" answers — used to be invisible until somebody in the
   * office happened to notice. This flags it to the tutor directly, at most
   * once a week per tutor (see the dedupeKey in notifyTutorsOfChurnRisk).
   */
  results.push(
    await run("churn-risk", async () => {
      const { notifyTutorsOfChurnRisk } = await import("@/lib/student-risk");
      return notifyTutorsOfChurnRisk();
    }),
  );

  results.push(
    await run("recording-reconcile", async () => {
      const { reconcileRecordings } = await import("@/lib/class-recorder");
      return reconcileRecordings();
    }),
  );

  /**
   * Retention no longer deletes anything on a schedule. Staff keep every class
   * recording forever; the student-side 14-day window is a read filter in
   * `/api/student/videos`, not a deletion (see src/lib/retention.ts). What
   * runs here instead is the nudge: a student about to lose a recording off
   * their shelf gets told, so they can download it in the app first.
   */
  results.push(
    await run("recording-expiry-nudge", async () => {
      const { sendDueExpiryNudges } = await import("@/lib/recording-expiry-nudge");
      return sendDueExpiryNudges();
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
   * Fold yesterday's usage into the daily rollup and debit each school's
   * balance.
   *
   * Yesterday rather than today, because a day that is still being written to
   * would be restated on the next tick and every tick after — and a customer
   * watching their balance move for reasons that keep changing has no way to
   * check it. Both the rollup and the debit are keyed on the day, so running
   * this hourly costs nothing and running it twice bills nothing twice.
   */
  /**
   * The two meters that are readings rather than events — what is stored, and
   * who was active. Taken BEFORE the rollup so today's reading is in the ledger
   * when yesterday's day is folded.
   */
  results.push(
    await run("meter-storage", async () => {
      const { meterStorage } = await import("@/lib/usage/daily-meters");
      return meterStorage();
    }),
  );

  results.push(
    await run("meter-active-students", async () => {
      const { meterActiveStudents } = await import("@/lib/usage/daily-meters");
      return meterActiveStudents();
    }),
  );

  results.push(
    await run("usage-rollup", async () => {
      const { rollUpUsage } = await import("@/lib/usage/record");
      return rollUpUsage();
    }),
  );

  /**
   * Deliver queued webhooks, and warn any school whose balance is running out.
   *
   * The low-balance warning is deliberately not "you have been cut off". A
   * school mid-term losing its register over a late transfer would be a worse
   * failure than carrying them for a few days, so this warns while there is
   * still time to act and the grace allowance does the rest.
   */
  results.push(
    await run("webhooks", async () => {
      const { deliverPendingWebhooks } = await import("@/lib/webhooks");
      return deliverPendingWebhooks(25);
    }),
  );

  results.push(
    await run("low-balance-warnings", async () => {
      const { warnLowBalances } = await import("@/lib/usage/record");
      return warnLowBalances();
    }),
  );

  /**
   * Open the story turns whose day has run out, and close the dead stories.
   *
   * This is the job that keeps Satzkette chains alive: a turn nobody took stops
   * being exclusive and goes to the whole class. Cheap, and it must not be
   * skipped — without it a single student who stops opening the app silently
   * ends every story they were offered a turn in.
   */
  /**
   * Push today's missions to whoever hasn't opened the dashboard yet — see
   * src/lib/daily-missions-push.ts. Capped per tick for the same reason
   * material-ai is: this runs a model call per (level, band) the first time
   * each is seen today, plus a write per student, on the same box as the
   * site itself.
   */
  results.push(
    await run("daily-missions-push", async () => {
      const { sendDueMissionPush } = await import("@/lib/daily-missions-push");
      return sendDueMissionPush();
    }),
  );

  /**
   * "Your streak ends today" — the loss-aversion nudge Duolingo built its
   * habit loop on. See src/lib/streak-reminders.ts for why it reuses the same
   * attendance-day data every other streak display already reads.
   */
  results.push(
    await run("streak-reminders", async () => {
      const { sendDueStreakReminders } = await import("@/lib/streak-reminders");
      return sendDueStreakReminders();
    }),
  );

  results.push(
    await run("satzkette-turns", async () => {
      const { openLapsedTurns, archiveStaleMatches } = await import("@/lib/satzkette-server");
      return { opened: await openLapsedTurns(), archived: await archiveStaleMatches() };
    }),
  );

  /**
   * Work Drive calendar: remind attendees of an event that starts soon, once
   * per attendee per event (dedupe on EventAttendee.reminderSentAt). See
   * src/lib/work-drive/event-reminders.ts.
   */
  results.push(
    await run("work-drive-event-reminders", async () => {
      const { sendDueEventReminders } = await import("@/lib/work-drive/event-reminders");
      return sendDueEventReminders();
    }),
  );

  /**
   * Work Drive housekeeping: hard-delete files 30 days into a workspace trash,
   * and prune surplus old file versions. Both bounded per tick.
   */
  results.push(
    await run("work-drive-retention", async () => {
      const { purgeExpiredTrash, pruneOldVersions } = await import("@/lib/work-drive/retention");
      return { trash: await purgeExpiredTrash(), versions: await pruneOldVersions() };
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

  /**
   * Turn newly finished class recordings into a transcript, a summary and
   * the vocabulary that class actually taught — see class-transcription.ts.
   * Capped even lower than material-ai: an ASR call over a full recording is
   * the slowest, heaviest thing any cron job here does.
   */
  results.push(
    await run("class-transcription", async () => {
      try {
        const { processTranscriptionQueue } = await import("@/lib/class-transcription");
        return await processTranscriptionQueue(2);
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

/**
 * Wrapped rather than marked inside the body: the scope has to be
 * established before the handler runs, not on its first line. See
 * withUnscoped in src/lib/tenant/context.ts.
 */
export const GET = withUnscoped(
  "the platform cron dispatcher runs every periodic job for every tenant",
  handleGET,
);
