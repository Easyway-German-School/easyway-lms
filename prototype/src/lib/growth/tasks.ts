import { prisma } from "@/lib/prisma";
import { logLeadActivity } from "@/lib/growth/activity";
import { isPartnerStale } from "@/lib/growth/partners";
import { startOfToday } from "@/lib/growth/reports";
import { sourceConversionRate } from "@/lib/growth/intelligence";
import type { GrowthTitle } from "@/lib/growth/titles";

/**
 * The daily queue. Scoring is no longer a fixed per-source constant — see
 * src/lib/growth/intelligence.ts for the Bayesian estimator this now calls,
 * which starts at the same defaults these constants used to hardcode and
 * shifts toward this school's own observed conversion rates as real data
 * accumulates. See the schema comment on SalesTask for why there is no
 * separate "carry over" step: a pending task simply keeps showing up until
 * it is done or skipped.
 */

/**
 * Higher sorts first. Recency matters (a lead goes cold fast); source
 * quality is now the school's own learned conversion rate for that source,
 * not a number somebody guessed once and never revisited.
 */
export async function priorityScoreForLead(lead: { source: string; createdAt: Date }): Promise<number> {
  const rate = await sourceConversionRate(lead.source);
  const hoursOld = (Date.now() - lead.createdAt.getTime()) / (1000 * 60 * 60);
  const recencyBoost = Math.max(0, 48 - hoursOld);
  return rate * 100 + recencyBoost;
}

export async function createFollowUpTask(opts: {
  leadId: string;
  assignedToId: string;
  title: string;
  dueDate?: Date | null;
  autoAssigned?: boolean;
}): Promise<void> {
  const lead = await prisma.lead.findUnique({
    where: { id: opts.leadId },
    select: { source: true, createdAt: true },
  });

  await prisma.salesTask.create({
    data: {
      assignedToId: opts.assignedToId,
      leadId: opts.leadId,
      kind: "follow_up",
      title: opts.title,
      dueDate: opts.dueDate ?? new Date(),
      priorityScore: lead ? await priorityScoreForLead(lead) : 0,
      autoAssigned: opts.autoAssigned ?? false,
    },
  });
}

/** A rep's queue: everything not yet done, ranked so the most urgent is first. */
export async function getDailyQueue(assignedToId: string) {
  return prisma.salesTask.findMany({
    where: { assignedToId, status: "pending" },
    include: {
      lead: { select: { id: true, name: true, email: true, phone: true, status: true } },
    },
    orderBy: [{ priorityScore: "desc" }, { dueDate: "asc" }],
  });
}

/**
 * The Growth Desk ops engine — what today's queue holds beyond raw lead
 * follow-ups, built around what each job actually does rather than one
 * generic list for everyone:
 *
 *   bdm        a nudge for every partner nobody has touched in 30+ days —
 *              the field-work half of the job, see src/lib/growth/partners.ts.
 *   sales_lead a single reminder when the team hasn't all filed today's
 *              report yet — the daily-reporting rule from the handbook,
 *              made actionable instead of just a page somebody has to
 *              remember to check.
 *   rep        nothing extra — a rep's queue is driven entirely by
 *              auto-assignment at lead capture (see autoAssignNewLead in
 *              src/lib/growth/leads.ts), which already runs the moment a
 *              lead needs working.
 *
 * Idempotent by design: called on every queue load, and checks for an
 * identically-titled open task before creating one, so refreshing the page
 * ten times in a row does not flood the queue ten times over.
 */
export async function ensureDailyOpsTasks(userId: string, title: GrowthTitle): Promise<void> {
  if (title === "bdm") {
    const partners = await prisma.partner.findMany({
      where: { ownerId: userId },
      select: { id: true, name: true, lastContactedAt: true, createdAt: true },
    });

    // Capped so one account owning fifty dormant partners does not bury the
    // queue in nudges — the five most overdue are the ones that matter today.
    const stale = partners
      .filter(isPartnerStale)
      .sort((a, b) => (a.lastContactedAt ?? a.createdAt).getTime() - (b.lastContactedAt ?? b.createdAt).getTime())
      .slice(0, 5);

    for (const partner of stale) {
      const title_ = `Check in with ${partner.name} — no contact in 30+ days`;
      const existing = await prisma.salesTask.findFirst({
        where: { assignedToId: userId, title: title_, status: "pending" },
        select: { id: true },
      });
      if (!existing) {
        await prisma.salesTask.create({
          data: { assignedToId: userId, kind: "partner_followup", title: title_, priorityScore: 25, autoAssigned: true },
        });
      }
    }
  }

  if (title === "sales_lead") {
    const [repCount, reportsToday] = await Promise.all([
      prisma.user.count({ where: { role: "ADMIN", adminRole: "growth", deletedAt: null } }),
      prisma.dailyReport.count({ where: { reportDate: startOfToday() } }),
    ]);

    if (reportsToday < repCount) {
      const title_ = "Chase outstanding daily reports from the team";
      const existing = await prisma.salesTask.findFirst({
        where: { assignedToId: userId, title: title_, status: "pending" },
        select: { id: true },
      });
      if (!existing) {
        await prisma.salesTask.create({
          data: { assignedToId: userId, kind: "team_check", title: title_, priorityScore: 20, autoAssigned: true },
        });
      }
    }
  }
}

export async function completeTask(opts: {
  taskId: string;
  actorId: string;
  outcome: "done" | "skipped";
}): Promise<void> {
  const task = await prisma.salesTask.update({
    where: { id: opts.taskId },
    data: { status: opts.outcome, completedAt: new Date() },
  });

  if (task.leadId) {
    await logLeadActivity({
      leadId: task.leadId,
      type: "task_completed",
      payload: { taskId: task.id, outcome: opts.outcome, title: task.title },
      actorId: opts.actorId,
    });
  }
}
