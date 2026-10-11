import { prisma } from "@/lib/prisma";

/**
 * PLACEHOLDER — not a real business decision yet.
 *
 * The school has not set an actual commission rate or structure. This
 * constant exists only so the mechanism — compute strictly off a real
 * Payment, never off anything a rep can write — can be built and tested
 * now. Do not treat any CommissionEntry this produces as real pay until
 * someone replaces this with the confirmed policy.
 *
 * TODO(growth-desk): replace with the real commission policy once the
 * business decides it. Every entry's `status` stays "pending" either way —
 * approval (and the `payroll` capability check that gates it) is a
 * separate, later step regardless of what the rate is.
 */
const PLACEHOLDER_COMMISSION_RATE = 0.1; // 10% of the payment amount — NOT CONFIRMED

/**
 * Create a CommissionEntry for a Payment, if it is tied to a Lead with a
 * rep assigned. Safe to call from every payment-creation path:
 *   - a no-op when the payment's student has no Lead, or the Lead has no
 *     rep assigned (most payments — most students were never a Growth
 *     Desk lead at all);
 *   - safe to call more than once for the same payment, since the unique
 *     constraint on CommissionEntry.paymentId makes a duplicate impossible
 *     and this checks first to avoid a noisy error in the logs on retry.
 *
 * Deliberately NOT wired into the CSV/bulk student import path — that is
 * backfilling historic records, not a new sale any current rep worked, and
 * running this there would pay commission on history.
 */
export async function recordCommissionForPayment(paymentId: string): Promise<void> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, studentId: true, amount: true, tenantId: true },
  });
  if (!payment) return;

  const lead = await prisma.lead.findFirst({
    where: { convertedStudentId: payment.studentId, assignedToId: { not: null } },
    select: { id: true, assignedToId: true },
  });
  if (!lead?.assignedToId) return;

  const existing = await prisma.commissionEntry.findUnique({ where: { paymentId } });
  if (existing) return;

  await prisma.commissionEntry.create({
    data: {
      leadId: lead.id,
      repId: lead.assignedToId,
      paymentId: payment.id,
      amount: Math.round(payment.amount * PLACEHOLDER_COMMISSION_RATE),
      rateApplied: PLACEHOLDER_COMMISSION_RATE,
      tenantId: payment.tenantId,
    },
  });
}
