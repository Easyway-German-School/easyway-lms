import type { JobOutcome } from "@/lib/cron-lanes";
import { sendHybridSessionPolicyNotice } from "@/lib/hybrid-session-policy-notice";

/**
 * The job registry for the daily tick — extracted from /api/cron/tick so the
 * SAME registrations can run from two different front doors: the Vercel route
 * (for as long as it still exists) and the standalone runner in
 * scripts/standalone-cron.ts (the self-hosted cron worker). Duplicating this
 * list in two places guarantees they drift the first time someone adds a job
 * to one and forgets the other; one function neither file can pass around
 * without the other finding out.
 *
 * Lane placement lives in CRON_PLAN (cron-lanes.ts), not here — this file only
 * says what each job NAME does when it runs.
 */
export function buildDailyCronJobs(): Map<string, () => Promise<unknown>> {
  const jobs = new Map<string, () => Promise<unknown>>();
  const register = (name: string, work: () => Promise<unknown>) => {
    jobs.set(name, work);
  };

  register("email-queue", async () => {
    const { drainQueue } = await import("@/lib/email-queue");
    return drainQueue(50);
  });

  register("sms-queue", async () => {
    const { drainSmsQueue } = await import("@/lib/sms-queue");
    return drainSmsQueue(50);
  });

  register("payment-plans", async () => {
    const { sweepPaymentPlans } = await import("@/lib/payment-plans");
    return sweepPaymentPlans();
  });

  register("accountant-digest", async () => {
    const { sendAccountantDigest } = await import("@/lib/accountant-digest");
    return sendAccountantDigest();
  });

  register("admin-brief-digest", async () => {
    const { sendAdminBriefDigest } = await import("@/lib/admin-brief");
    return sendAdminBriefDigest();
  });

  register("payment-warnings", async () => {
    const { runPaymentWarnings } = await import("@/lib/payment-warnings");
    return runPaymentWarnings({ dryRun: false });
  });

  register("seat-nudges", async () => {
    const { runSeatNudges } = await import("@/lib/seat-nudges");
    return runSeatNudges();
  });

  register("hybrid-session-policy-notice", async () => {
    return sendHybridSessionPolicyNotice();
  });

  register("auto-graduation", async () => {
    const { runAutoGraduation } = await import("@/lib/graduation-server");
    return runAutoGraduation();
  });

  register("auto-level-progression", async () => {
    const { runAutoLevelProgression } = await import("@/lib/graduation-server");
    return runAutoLevelProgression();
  });

  register("auto-next-level", async () => {
    const { runAutoNextLevel } = await import("@/lib/next-level-pipeline-server");
    return runAutoNextLevel();
  });

  register("fee-reminders", async () => {
    const { sendDueFeeReminders } = await import("@/lib/fee-reminders");
    return sendDueFeeReminders();
  });

  register("exam-reminders", async () => {
    const { sendDueExamReminders } = await import("@/lib/exam-reminders");
    return sendDueExamReminders();
  });

  register("exam-campaign-reminders", async () => {
    const { sendDueExamCampaignReminders } = await import("@/lib/exam-campaign-reminders");
    return sendDueExamCampaignReminders();
  });

  register("pretest-reminders", async () => {
    const { sendDuePretestReminders } = await import("@/lib/pretest-reminders");
    return sendDuePretestReminders();
  });

  register("auto-release-results", async () => {
    const { autoReleaseDueResults } = await import("@/lib/result-release");
    return autoReleaseDueResults();
  });

  register("result-release-nudge", async () => {
    const { nudgeUnreleasedResults } = await import("@/lib/result-release");
    return nudgeUnreleasedResults();
  });

  register("churn-risk", async () => {
    const { notifyTutorsOfChurnRisk } = await import("@/lib/student-risk");
    return notifyTutorsOfChurnRisk();
  });

  register("recording-reconcile", async () => {
    const { reconcileRecordings } = await import("@/lib/class-recorder");
    return reconcileRecordings();
  });

  register("short-recording-purge", async () => {
    const { applyShortRecordingPurge } = await import("@/lib/retention");
    return applyShortRecordingPurge({ dryRun: false });
  });

  register("recording-expiry-nudge", async () => {
    const { sendDueExpiryNudges } = await import("@/lib/recording-expiry-nudge");
    return sendDueExpiryNudges();
  });

  register("student-code-backfill", async () => {
    const { backfillMissingStudentCodes } = await import("@/lib/student-code-backfill");
    return backfillMissingStudentCodes();
  });

  register("batch-placement", async () => {
    const { placeUnplacedStudents } = await import("@/lib/batch-placement-server");
    const report = await placeUnplacedStudents({ apply: true });
    return { scanned: report.scanned, placed: report.placed.length, leftForAPerson: report.needsPerson.length };
  });

  register("student-code-realign", async () => {
    const { realignUpcomingIntakeCodes } = await import("@/lib/student-code-backfill");
    return realignUpcomingIntakeCodes();
  });

  register("profile-photo-nudge", async () => {
    const { nudgeStudentsWithoutPhoto } = await import("@/lib/profile-photo-nudge");
    return nudgeStudentsWithoutPhoto();
  });

  register("profile-branch-nudge", async () => {
    const { nudgeStudentsWithoutBranch } = await import("@/lib/branch-nudge");
    return nudgeStudentsWithoutBranch();
  });

  register("profile-details-nudge", async () => {
    const { nudgeStudentsWithProfileGaps } = await import("@/lib/profile-details-nudge");
    return nudgeStudentsWithProfileGaps();
  });

  register("material-send-nudge", async () => {
    const { nudgeTutorsWithUnsentMaterials } = await import("@/lib/material-send-nudge");
    return nudgeTutorsWithUnsentMaterials();
  });

  register("tutor-batch-notice", async () => {
    const { announceTutorBatches } = await import("@/lib/tutor-batch-notice");
    return announceTutorBatches();
  });

  register("assignment-availability-nudge", async () => {
    const { nudgeStudentsWithAssignmentsAvailable } = await import("@/lib/assignment-availability-nudge");
    return nudgeStudentsWithAssignmentsAvailable();
  });

  register("backup-health", async () => {
    const { checkBackupHealth } = await import("@/lib/backup-health");
    return checkBackupHealth();
  });

  register("sign-in-anomaly", async () => {
    const { flagUnfamiliarStaffSignIns } = await import("@/lib/sign-in-anomaly");
    return flagUnfamiliarStaffSignIns();
  });

  register("meter-storage", async () => {
    const { meterStorage } = await import("@/lib/usage/daily-meters");
    return meterStorage();
  });

  register("meter-active-students", async () => {
    const { meterActiveStudents } = await import("@/lib/usage/daily-meters");
    return meterActiveStudents();
  });

  register("usage-rollup", async () => {
    const { rollUpUsage } = await import("@/lib/usage/record");
    return rollUpUsage();
  });

  register("webhooks", async () => {
    const { deliverPendingWebhooks } = await import("@/lib/webhooks");
    return deliverPendingWebhooks(25);
  });

  register("low-balance-warnings", async () => {
    const { warnLowBalances } = await import("@/lib/usage/record");
    return warnLowBalances();
  });

  register("daily-missions-push", async () => {
    const { sendDueMissionPush } = await import("@/lib/daily-missions-push");
    return sendDueMissionPush();
  });

  register("streak-reminders", async () => {
    const { sendDueStreakReminders } = await import("@/lib/streak-reminders");
    return sendDueStreakReminders();
  });

  register("satzkette-turns", async () => {
    const { openLapsedTurns, archiveStaleMatches } = await import("@/lib/satzkette-server");
    return { opened: await openLapsedTurns(), archived: await archiveStaleMatches() };
  });

  register("work-drive-event-reminders", async () => {
    const { sendDueEventReminders } = await import("@/lib/work-drive/event-reminders");
    return sendDueEventReminders();
  });

  register("work-drive-retention", async () => {
    const { purgeExpiredTrash, pruneOldVersions } = await import("@/lib/work-drive/retention");
    return { trash: await purgeExpiredTrash(), versions: await pruneOldVersions() };
  });

  register("material-ai", async () => {
    try {
      const { processMaterialQueue } = await import("@/lib/material-ai");
      return await processMaterialQueue(3);
    } catch (error) {
      return { skipped: true, reason: error instanceof Error ? error.message : String(error) };
    }
  });

  register("class-transcription", async () => {
    try {
      const { kickClassNotes } = await import("@/lib/class-notes-runner");
      if (await kickClassNotes()) return { kicked: true };
      const { processTranscriptionQueue } = await import("@/lib/class-transcription");
      return await processTranscriptionQueue(2);
    } catch (error) {
      return { skipped: true, reason: error instanceof Error ? error.message : String(error) };
    }
  });

  return jobs;
}

/** The fast tick's two jobs, same reuse reason as buildDailyCronJobs above. */
export async function runFastCronJobs(): Promise<{
  ok: boolean;
  result: unknown;
  autoHeal: unknown;
}> {
  const [emailResult, autoHealResult] = await Promise.allSettled([
    (async () => {
      const { drainQueue } = await import("@/lib/email-queue");
      return drainQueue(50);
    })(),
    (async () => {
      const { runPortalResync } = await import("@/lib/auto-heal");
      return runPortalResync();
    })(),
  ]);

  if (emailResult.status === "rejected") console.error("tick-fast: email drain failed:", emailResult.reason);
  if (autoHealResult.status === "rejected") console.error("tick-fast: auto-heal failed:", autoHealResult.reason);

  return {
    ok: emailResult.status === "fulfilled" && autoHealResult.status === "fulfilled",
    result: emailResult.status === "fulfilled" ? emailResult.value : { error: String(emailResult.reason) },
    autoHeal: autoHealResult.status === "fulfilled" ? autoHealResult.value : { error: String(autoHealResult.reason) },
  };
}

/**
 * The "a job failed" alert, same text and dedupeKey whichever front door ran
 * the tick — an admin seeing this must not be able to tell from the message
 * whether Vercel or the self-hosted worker produced it.
 */
export async function notifyFailedCronJobs(failed: JobOutcome[]): Promise<void> {
  if (!failed.length) return;
  try {
    const { notify } = await import("@/lib/notify");
    const today = new Date().toISOString().slice(0, 10);
    for (const job of failed) {
      await notify({
        to: { audience: "admin", capability: "security" },
        title: `Scheduled job "${job.job}" failed`,
        message:
          `The daily automation job "${job.job}" errored on its last run: ${job.error ?? "no message recorded"}. ` +
          `It ran in its own lane, so the other jobs were not held up. If this keeps happening, whatever that job does — reminders, digests, the backup check — is not happening.`,
        kind: "cron.job_failed",
        severity: "warning",
        link: "/admin/security",
        dedupeKey: `cron-failed:${job.job}:${today}`,
        push: false,
      });
    }
  } catch (alertError) {
    console.error("Could not send cron-failure alert:", alertError);
  }
}
