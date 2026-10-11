import { prisma } from "@/lib/prisma";

/**
 * The append-only pipeline log. Nothing in Growth Desk ever overwrites a
 * LeadActivity row — a correction is a new row, same reasoning as
 * AuditLog and TermsAcceptance elsewhere in this schema.
 */
export type LeadActivityType = "note" | "call" | "stage_change" | "task_completed" | "assigned";

export async function logLeadActivity(opts: {
  leadId: string;
  type: LeadActivityType;
  payload?: Record<string, unknown> | null;
  actorId?: string | null;
}): Promise<void> {
  await prisma.leadActivity.create({
    data: {
      leadId: opts.leadId,
      type: opts.type,
      payload: opts.payload ?? undefined,
      actorId: opts.actorId ?? null,
    },
  });
}
