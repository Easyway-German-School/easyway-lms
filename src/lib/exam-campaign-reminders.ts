/**
 * The 3×/week "register for the exam" reminder.
 *
 * The daily Becca popup and the pinned banner carry the campaign inside the
 * portal; this is the half that reaches a student who has not opened the app —
 * a bell row (and a phone buzz) on the campaign's reminder weekdays, to
 * everyone who has NOT marked themselves registered.
 *
 * Shape borrowed from exam-reminders.ts / fee-reminders.ts: fire on a whole
 * calendar day, keyed with a per-day `dedupeKey`, so the hourly cron tick sends
 * exactly one reminder per student per reminder-day no matter how often it runs.
 */

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant/context";
import { notify, KIND } from "@/lib/notify";
import {
  campaignIsLive,
  schoolDateKey,
  schoolWeekday,
  type ExamCampaignConfig,
} from "@/lib/exam-campaign";
import { readAllExamCampaigns } from "@/lib/exam-campaign-server";

/** A school has hundreds of students, not tens of thousands. */
const SCAN_LIMIT = 5_000;

export type ExamCampaignReminderResult = {
  campaignKey: string;
  reason?: string;
  eligible: number;
  alreadyRegistered: number;
  created: number;
  pushed: number;
};

/**
 * Send this tenant's reminder now. Assumes tenant scope is already established
 * (the cron sweep wraps it in `runWithTenant`; the admin "send now" button is
 * already inside its own request scope).
 *
 * `force` skips the weekday / live-window gates — the office pressing the
 * button means "send it today whatever day it is" — but keeps the per-day
 * dedupeKey, so pressing it twice in one day is a no-op.
 */
export async function deliverExamCampaignReminder(
  config: ExamCampaignConfig,
  opts: { force?: boolean } = {},
): Promise<ExamCampaignReminderResult> {
  const base: ExamCampaignReminderResult = {
    campaignKey: config.campaignKey,
    eligible: 0,
    alreadyRegistered: 0,
    created: 0,
    pushed: 0,
  };

  if (!config.enabled) return { ...base, reason: "disabled" };
  if (!opts.force) {
    if (!campaignIsLive(config)) return { ...base, reason: "outside registration window" };
    if (!config.reminderWeekdays.includes(schoolWeekday())) {
      return { ...base, reason: "not a reminder weekday" };
    }
  }

  const students = await prisma.student.findMany({
    where: { status: "active" },
    orderBy: { createdAt: "asc" },
    take: SCAN_LIMIT,
    select: { userId: true },
  });
  const allUserIds = students.map((s) => s.userId).filter((id): id is string => Boolean(id));
  if (allUserIds.length === 0) return { ...base, reason: "no active students" };

  const registered = await prisma.examCampaignResponse.findMany({
    where: { campaignKey: config.campaignKey, registered: true, userId: { in: allUserIds } },
    select: { userId: true },
  });
  const skip = new Set(registered.map((r) => r.userId));
  const userIds = allUserIds.filter((id) => !skip.has(id));

  base.eligible = allUserIds.length;
  base.alreadyRegistered = skip.size;
  if (userIds.length === 0) return { ...base, reason: "everyone registered" };

  const res = await notify({
    to: { userIds },
    kind: KIND.examCampaign,
    severity: "info",
    title: config.reminderTitle,
    message: config.reminderMessage,
    link: "/exams/osd",
    push: true,
    dedupeKey: `exam-campaign:${config.campaignKey}:${schoolDateKey()}`,
  });

  base.created = res.created;
  base.pushed = res.pushed;
  return base;
}

/**
 * The cron entry — every tenant that has SAVED a campaign (see
 * readAllExamCampaigns for why a never-touched tenant is skipped). Isolated per
 * tenant: one school's bad row does not stop the rest.
 */
export async function sendDueExamCampaignReminders(): Promise<{
  tenants: number;
  results: ExamCampaignReminderResult[];
}> {
  const campaigns = await readAllExamCampaigns();
  const results: ExamCampaignReminderResult[] = [];

  for (const { tenantId, config } of campaigns) {
    try {
      const result = await runWithTenant(tenantId, () => deliverExamCampaignReminder(config));
      results.push(result);
    } catch (error) {
      results.push({
        campaignKey: config.campaignKey,
        reason: `failed: ${error instanceof Error ? error.message : String(error)}`,
        eligible: 0,
        alreadyRegistered: 0,
        created: 0,
        pushed: 0,
      });
    }
  }

  return { tenants: campaigns.length, results };
}
