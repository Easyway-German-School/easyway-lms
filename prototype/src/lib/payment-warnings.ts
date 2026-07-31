import { prisma } from "@/lib/prisma";
import { derivePaymentStatus, requiredDepositFor, tuitionFeeFor } from "@/lib/payment";
import { KIND, notify } from "@/lib/notify";

/**
 * Warns students before their account locks for non-payment.
 *
 * Access to classes, assignments, attendance and certificates is gated on
 * tuition being paid (see PaymentLockScreen). Locking someone out with
 * no warning is the kind of thing that loses a student rather than collecting
 * a fee, so this gives three escalating notices first.
 *
 * Tiers are based on how long the student has been enrolled with an
 * outstanding balance:
 *
 *   notice   14 days   friendly nudge, nothing restricted
 *   warning  30 days   states the lock date plainly
 *   final    45 days   last notice before access is restricted
 *
 * Each tier fires at most once per student — the sent Notification row is the
 * record, so re-running is safe and will not spam anyone.
 */

export const WARNING_TIERS = [
  { tier: "notice", afterDays: 14 },
  { tier: "warning", afterDays: 30 },
  { tier: "final", afterDays: 45 },
] as const;

export type WarningTier = (typeof WARNING_TIERS)[number]["tier"];

function titleFor(tier: WarningTier) {
  if (tier === "notice") return "Tuition balance outstanding";
  if (tier === "warning") return "Action needed: tuition balance";
  return "Final notice: your access will be restricted";
}

function messageFor(tier: WarningTier, balance: number, daysLeft: number) {
  const amount = `₦${balance.toLocaleString()}`;
  if (tier === "notice") {
    return `You have ${amount} outstanding on your tuition. You can pay any time from the Payments page — nothing is restricted yet.`;
  }
  if (tier === "warning") {
    return `${amount} is still outstanding. If it is not settled within ${daysLeft} days, access to your classes, assignments and certificates will be paused until payment is received.`;
  }
  return `${amount} remains outstanding. This is the last notice before access to your classes, assignments and certificates is paused. Please pay from the Payments page or speak to your branch office today.`;
}

/**
 * Idempotency token so a tier is never sent twice.
 *
 * This used to be written into the notification's `channel` column, which made
 * every warning invisible in the portal — the bell only shows rows whose
 * channel is not "email", and these were neither. It is `dedupeKey` now, which
 * is what that column is for, and notify() drops a repeat itself.
 */
function markerFor(tier: WarningTier) {
  return `payment-${tier}`;
}

export type WarningRun = {
  checked: number;
  atRisk: number;
  created: Array<{ studentId: string; name: string; tier: WarningTier; balance: number }>;
  skipped: number;
};

export async function runPaymentWarnings(options?: { now?: Date; dryRun?: boolean }): Promise<WarningRun> {
  const now = options?.now ?? new Date();
  const dryRun = options?.dryRun ?? false;

  const students = await prisma.student.findMany({
    where: { status: "active" },
    select: {
      id: true,
      level: true,
      createdAt: true,
      branch: { select: { name: true } },
      user: { select: { id: true, name: true } },
      payments: { where: { status: "completed" }, select: { amount: true } },
    },
  });

  const run: WarningRun = { checked: students.length, atRisk: 0, created: [], skipped: 0 };

  for (const student of students) {
    const feeLookup = { level: student.level, branch: student.branch?.name ?? null };
    const tuitionFee = tuitionFeeFor(feeLookup);
    const requiredDeposit = requiredDepositFor(feeLookup);
    const totalPaid = student.payments.reduce((sum, p) => sum + p.amount, 0);
    const { fullPaid } = derivePaymentStatus({ totalPaid, tuitionFee, requiredDeposit });

    if (fullPaid) continue;
    run.atRisk++;

    const daysEnrolled = Math.floor((now.getTime() - student.createdAt.getTime()) / 86_400_000);

    // Highest tier the student has reached; only that one is sent.
    const due = [...WARNING_TIERS].reverse().find((t) => daysEnrolled >= t.afterDays);
    if (!due) continue;

    const marker = markerFor(due.tier);
    // Both spellings are checked: rows written before this used `channel`.
    const already = await prisma.notification.findFirst({
      where: { studentId: student.id, OR: [{ dedupeKey: marker }, { channel: marker }] },
      select: { id: true },
    });
    if (already) {
      run.skipped++;
      continue;
    }

    const balance = Math.max(0, tuitionFee - totalPaid);
    const finalTier = WARNING_TIERS[WARNING_TIERS.length - 1];
    const daysLeft = Math.max(0, finalTier.afterDays - daysEnrolled);
    const title = titleFor(due.tier);
    const message = messageFor(due.tier, balance, daysLeft);

    if (!dryRun) {
      // notify() writes the row, dedupes on the marker and pushes, and never
      // throws — a mail or push failure must not stop the run.
      await notify({
        to: { studentIds: [student.id] },
        kind: KIND.tuitionReminder,
        // The final notice is the one that precedes losing access, so it is
        // the one that is allowed to interrupt.
        severity: due.tier === "final" ? "critical" : due.tier === "warning" ? "warning" : "info",
        title,
        message,
        link: "/payments",
        dedupeKey: marker,
        push: true,
      });
    }

    run.created.push({
      studentId: student.id,
      name: student.user.name ?? "(unnamed)",
      tier: due.tier,
      balance,
    });
  }

  return run;
}
