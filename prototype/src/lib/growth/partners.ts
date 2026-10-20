import { prisma } from "@/lib/prisma";

/**
 * Corporate/partnership CRM — the BDM's field work. Deliberately plain
 * compared to Lead/LeadActivity: no commission is tied to a Partner, so
 * there is nothing here worth an immutable ledger for yet. See the schema
 * comment on `model Partner`.
 */

/** A partner nobody has touched in 30+ days — the "stay in their mind" nudge. */
export const STALE_PARTNER_DAYS = 30;

export function isPartnerStale(partner: { lastContactedAt: Date | null; createdAt: Date }): boolean {
  const reference = partner.lastContactedAt ?? partner.createdAt;
  const days = (Date.now() - reference.getTime()) / (1000 * 60 * 60 * 24);
  return days >= STALE_PARTNER_DAYS;
}

export async function logPartnerContact(opts: { partnerId: string; note?: string | null }): Promise<void> {
  await prisma.partner.update({
    where: { id: opts.partnerId },
    data: {
      lastContactedAt: new Date(),
      ...(opts.note ? { notes: opts.note } : {}),
    },
  });
}
