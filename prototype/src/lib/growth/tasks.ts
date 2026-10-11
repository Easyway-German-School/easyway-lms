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

/** How much Claude's read of a lead's notes can move its priority — see aiSignalBoost. */
const URGENCY_BOOST: Record<string, number> = { low: 0, medium: 10, high: 25 };
const BUYING_SIGNAL_BOOST: Record<string, number> = { weak: 0, moderate: 15, strong: 35 };

/**
 * Zero when the Growth Desk AI switch is off, no key is configured, or
 * nobody has logged a note Claude could read yet — the scoring function
 * calling this never knows or cares which, it just gets 0 and carries on
 * exactly as it did before this existed. See src/lib/ai.ts's
 * analyzeLeadSignal for where the "ai_signal" LeadActivity this reads
 * actually gets written.
 */
async function aiSignalBoost(leadId: string): Promise<number> {
  const latest = await prisma.leadActivity.findFirst({
    where: { leadId, type: "ai_signal" },
    orderBy: { createdAt: "desc" },
    select: { payload: true },
  });
  if (!latest?.payload || typeof latest.payload !== "object") return 0;
  const payload = latest.payload as Record<string, unknown>;
  const urgency = typeof payload.urgency === "string" ? payload.urgency : "medium";
  const buyingSignal = typeof payload.buyingSignal === "string" ? payload.buyingSignal : "weak";
  return (URGENCY_BOOST[urgency] ?? 0) + (BUYING_SIGNAL_BOOST[buyingSignal] ?? 0);
}

/**
 * Higher sorts first. Three layers, each optional on top of the one
 * before: recency always applies; source quality is the school's own
 * learned conversion rate, not a number somebody guessed once; and an AI
 * read of the lead's notes, when one exists, nudges it further — never the
 * whole score, never required for the score to mean something.
 */
export async function priorityScoreForLead(lead: { id: string; source: string; createdAt: Date }): Promise<number> {
  const rate = await sourceConversionRate(lead.source);
  const hoursOld = (Date.now() - lead.createdAt.getTime()) / (1000 * 60 * 60);
  const recencyBoost = Math.max(0, 48 - hoursOld);
  const aiBoost = await aiSignalBoost(lead.id);
  return rate * 100 + recencyBoost + aiBoost;
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
    select: { id: true, source: true, createdAt: true },
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

/**
 * Called after Claude reads a lead's notes and finds something — see
 * src/app/api/admin/growth/leads/[id]/activity/route.ts. Re-scores every
 * OPEN task on this lead so the new signal actually changes queue order
 * today, not just for the next task created.
 */
export async function rescoreOpenTasksForLead(leadId: string): Promise<void> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, source: true, createdAt: true },
  });
  if (!lead) return;

  const score = await priorityScoreForLead(lead);
  await prisma.salesTask.updateMany({
    where: { leadId, status: "pending" },
    data: { priorityScore: score },
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
  /** True when the system itself determined this, not a self-click — see autoCompleteTasksForLeadActivity. */
  verified?: boolean;
}): Promise<void> {
  const task = await prisma.salesTask.update({
    where: { id: opts.taskId },
    data: { status: opts.outcome, completedAt: new Date() },
  });

  if (task.leadId) {
    await logLeadActivity({
      leadId: task.leadId,
      type: "task_completed",
      payload: { taskId: task.id, outcome: opts.outcome, title: task.title, verified: opts.verified ?? false },
      actorId: opts.actorId,
    });
  }
}

/**
 * The system's own proof a rep actually worked a lead, replacing a
 * self-click "Done" button for anything tied to a lead. Called right after
 * a note, a call, or a stage change lands on one — from the person who
 * logged it, never from whoever happens to be looking at the lead.
 *
 * Deliberately narrow: only completes THAT actor's own pending tasks on
 * THAT lead. A Teamlead moving a stage on someone else's lead must never
 * credit the assigned rep's queue for work the Teamlead did — that would
 * just move the unverifiable claim up a level instead of removing it. See
 * the handbook note at the top of this file on why "done" can no longer be
 * asserted — only observed.
 */
export async function autoCompleteTasksForLeadActivity(opts: { leadId: string; actorId: string | null }): Promise<void> {
  if (!opts.actorId) return;

  const tasks = await prisma.salesTask.findMany({
    where: { leadId: opts.leadId, assignedToId: opts.actorId, status: "pending" },
    select: { id: true },
  });

  for (const task of tasks) {
    await completeTask({ taskId: task.id, actorId: opts.actorId, outcome: "done", verified: true });
  }
}
