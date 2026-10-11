import { prisma } from "@/lib/prisma";
import { logLeadActivity } from "@/lib/growth/activity";
import { createFollowUpTask } from "@/lib/growth/tasks";
import { pickRepForLead } from "@/lib/growth/intelligence";

/**
 * The Growth Desk pipeline layer over Lead.
 *
 * Nothing here ever edits a Lead's commercial outcome directly from a rep's
 * input — see CommissionEntry in schema.prisma. What lives here is the
 * assignment logic sitting on top of the append-only trail in
 * src/lib/growth/activity.ts, which together are the actual replacement for
 * the Google Sheet: a rep's view of "what happened on this lead" is a
 * sequence of rows nobody can quietly rewrite.
 */

/** Hand a lead to a specific rep, logging who did it and when. */
export async function assignLead(opts: {
  leadId: string;
  assignedToId: string;
  actorId?: string | null;
}): Promise<void> {
  await prisma.lead.update({
    where: { id: opts.leadId },
    data: { assignedToId: opts.assignedToId },
  });

  await logLeadActivity({
    leadId: opts.leadId,
    type: "assigned",
    payload: { assignedToId: opts.assignedToId, auto: opts.actorId == null },
    actorId: opts.actorId ?? null,
  });
}

/**
 * Move a lead through the sales funnel. The only way its `status` ever
 * changes once Growth Desk owns it — direct `prisma.lead.update` calls on
 * status bypass the ledger, so new code should route through here, not
 * around it.
 */
export async function updateLeadStage(opts: {
  leadId: string;
  status: string;
  note?: string | null;
  actorId?: string | null;
}): Promise<void> {
  const current = await prisma.lead.findUnique({
    where: { id: opts.leadId },
    select: { status: true },
  });
  if (!current) throw new Error("Lead not found");

  await prisma.lead.update({
    where: { id: opts.leadId },
    data: { status: opts.status },
  });

  await logLeadActivity({
    leadId: opts.leadId,
    type: "stage_change",
    payload: { from: current.status, to: opts.status, note: opts.note ?? null },
    actorId: opts.actorId ?? null,
  });
}

/**
 * Called right after a Lead is created (captureLead in src/lib/leads.ts).
 * Who it goes to is now learned, not just least-loaded — see
 * src/lib/growth/intelligence.ts's pickRepForLead for the weighted-random
 * policy and why it is deliberately not "send it to whoever converts
 * best". Silent no-op when there is no rep to hand it to yet — the lead
 * just sits in the unassigned pool until a Teamlead claims it by hand.
 */
export async function autoAssignNewLead(leadId: string, leadName: string): Promise<void> {
  const repId = await pickRepForLead();
  if (!repId) return;

  await assignLead({ leadId, assignedToId: repId, actorId: null });
  await createFollowUpTask({
    leadId,
    assignedToId: repId,
    title: `Follow up with ${leadName}`,
    autoAssigned: true,
  });
}
