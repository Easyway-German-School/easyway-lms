import { prisma } from "@/lib/prisma";

/**
 * TUTOR PAYROLL — what the school pays a tutor, computed from what they
 * actually taught.
 *
 * Deliberately the simplest model that is still honest: an admin sets ONE
 * rate per tutor (per class held, or a flat monthly figure), and this reads
 * back `ClassSession.status = "held"` — the same field the gradebook,
 * attendance and every other "did this class happen" screen already reads —
 * rather than inventing a second attendance concept. There is no
 * commission-of-tuition-collected math here: that needs a real percentage
 * negotiated per tutor this codebase has no record of, and guessing one
 * would either short-change or over-pay somebody.
 *
 * PayrollPayment is a ledger, not a balance: nothing here auto-pays a tutor.
 * An admin records "paid ₦X for September" once the transfer has actually
 * gone out, same as a student's manual Payment row.
 */

export const PAYROLL_RATE_TYPES = ["per_class", "monthly"] as const;
export type PayrollRateType = (typeof PAYROLL_RATE_TYPES)[number];

export function isPayrollRateType(value: unknown): value is PayrollRateType {
  return (PAYROLL_RATE_TYPES as readonly string[]).includes(String(value));
}

/** Classes this tutor actually held in [from, to). The one fact every payroll figure is built from. */
export async function classesHeldFor(lecturerId: string, from: Date, to: Date): Promise<number> {
  return prisma.classSession.count({
    where: { lecturerId, status: "held", date: { gte: from, lt: to } },
  });
}

export type PayrollPeriodFigures = {
  lecturerId: string;
  rateType: PayrollRateType | null;
  rateAmount: number | null;
  classesHeld: number;
  /** What the rate says this tutor earned over the period — null when no rate is set at all. */
  earned: number | null;
  /** Sum of PayrollPayment rows recorded with `paidAt` inside the period. */
  paid: number;
  /** max(0, earned - paid). Null (not zero) when there is no rate to measure against. */
  owed: number | null;
};

/** One tutor's figures for one period. `to` is exclusive. */
export async function payrollFiguresFor(lecturerId: string, from: Date, to: Date): Promise<PayrollPeriodFigures> {
  const [rate, classesHeld, payments] = await Promise.all([
    prisma.tutorPayRate.findUnique({ where: { lecturerId } }),
    classesHeldFor(lecturerId, from, to),
    prisma.payrollPayment.findMany({
      where: { lecturerId, paidAt: { gte: from, lt: to } },
      select: { amount: true },
    }),
  ]);

  const paid = payments.reduce((sum, p) => sum + p.amount, 0);
  const rateType = isPayrollRateType(rate?.rateType) ? rate.rateType : null;
  const earned = rate ? (rateType === "monthly" ? rate.amount : rate.amount * classesHeld) : null;

  return {
    lecturerId,
    rateType,
    rateAmount: rate?.amount ?? null,
    classesHeld,
    earned,
    paid,
    owed: earned === null ? null : Math.max(0, earned - paid),
  };
}

/** Every tutor who has a rate set, with their figures for one period — the admin roster view. */
export async function payrollSummaryFor(from: Date, to: Date) {
  const rates = await prisma.tutorPayRate.findMany({
    select: {
      lecturerId: true,
      lecturer: {
        select: {
          id: true,
          status: true,
          user: { select: { name: true, email: true } },
          branch: { select: { name: true } },
        },
      },
    },
  });

  const figures = await Promise.all(rates.map((row) => payrollFiguresFor(row.lecturerId, from, to)));
  const byLecturer = new Map(figures.map((f) => [f.lecturerId, f]));

  return rates.map((row) => ({
    ...byLecturer.get(row.lecturerId)!,
    name: row.lecturer.user?.name ?? row.lecturer.user?.email ?? "Unnamed tutor",
    status: row.lecturer.status,
    branchName: row.lecturer.branch?.name ?? null,
  }));
}

/** The calendar month containing `date`, as a [from, to) pair. */
export function monthRange(date: Date): { from: Date; to: Date; label: string } {
  const from = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const to = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  const label = from.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  return { from, to, label };
}
