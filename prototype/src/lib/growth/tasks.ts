import { prisma } from "@/lib/prisma";
import { logLeadActivity } from "@/lib/growth/activity";

/**
 * The daily queue, v1: rules-based, not ML — there is no history yet to
 * train anything on, coming straight off a Google Sheet. See the schema
 * comment on SalesTask for why there is no separate "carry over" step: a
 * pending task simply keeps showing up until it is done or skipped.
 */

/** Freshly-created leads get a head start; older sources get less urgency. */
const SOURCE_WEIGHT: Record<string, number> = {
  walk_in: 30,
  website: 20,
  csv_import: 10,
};

function sourceWeight(source: string): number {
  return SOURCE_WEIGHT[source] ?? 15;
}

/**
 * Higher sorts first. Recency matters most (a lead goes cold fast), source
 * quality second. Tune the constants once there is real completion data to
 * judge them against — see LeadActivity, which already records what a rep
 * actually did with a lead.
 */
export function priorityScoreForLead(lead: { source: string; createdAt: Date }): number {
  const hoursOld = (Date.now() - lead.createdAt.getTime()) / (1000 * 60 * 60);
  const recencyBoost = Math.max(0, 48 - hoursOld);
  return sourceWeight(lead.source) + recencyBoost;
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
      priorityScore: lead ? priorityScoreForLead(lead) : 0,
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
