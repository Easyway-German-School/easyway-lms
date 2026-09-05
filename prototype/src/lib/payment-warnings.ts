import { prisma } from "@/lib/prisma";
import { derivePaymentStatus, receivedPaymentFilter, requiredDepositFor, tuitionFeeFor } from "@/lib/payment";
import { PART_PAYMENT_LOCK_DAYS } from "@/lib/access";
import { buildLedger, ledgerIsPopulated } from "@/lib/finance/ledger";
import { onTrackPlanStudentIds } from "@/lib/payment-plans";
import { KIND, notify } from "@/lib/notify";

/**
 * Warns students before their portal access is paused for non-payment.
 *
 * There are two ways to end up locked out (see deriveStudentAccess /
 * PaymentLockScreen), and each gets its own escalation:
 *
 *  1. REGISTRATION-ONLY — never cleared the 60% deposit, so classes never
 *     opened. Nudged at 14 / 30 / 45 days from enrolment (WARNING_TIERS).
 *     Nothing is "paused" here because nothing was ever unlocked; the final
 *     notice is a prompt, not a threat.
 *
 *  2. PART-PAID, BALANCE OPEN — started class on a part-payment and never
 *     settled. Access genuinely pauses PART_PAYMENT_LOCK_DAYS (30) days after
 *     classes start, so the notices are aimed at that date: 10 days before,
 *     3 days before, and on the day (BALANCE_TIERS). The final one is now a
 *     true statement — access is actually paused.
 *
 * An admin `paymentGraceUntil` in the future suppresses the balance track
 * entirely. Each tier fires at most once per student — the sent Notification
 * row (dedupeKey) is the record, so re-running is safe.
 */

export const WARNING_TIERS = [
  { tier: "notice", afterDays: 14 },
  { tier: "warning", afterDays: 30 },
  { tier: "final", afterDays: 45 },
] as const;

export type WarningTier = (typeof WARNING_TIERS)[number]["tier"];

/**
 * Balance-track tiers, measured as days remaining until the lock lands (so a
 * negative value means the lock has already landed). Ordered most-urgent-first
 * for the "highest tier reached" pick.
 */
export const BALANCE_TIERS = [
  { tier: "balance-final", withinDays: 0 },
  { tier: "balance-warning", withinDays: 3 },
  { tier: "balance-notice", withinDays: 10 },
] as const;

export type BalanceTier = (typeof BALANCE_TIERS)[number]["tier"];

const DAY_MS = 86_400_000;

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

function balanceTitleFor(tier: BalanceTier) {
  if (tier === "balance-notice") return "Tuition balance due soon";
  if (tier === "balance-warning") return "3 days until your access pauses";
  return "Your portal access is paused";
}

function balanceMessageFor(tier: BalanceTier, balance: number, lockAt: Date): string {
  const amount = `₦${balance.toLocaleString()}`;
  const lockDate = lockAt.toLocaleDateString("en-NG", { day: "numeric", month: "long" });
  if (tier === "balance-notice") {
    return `You still owe ${amount} on your tuition. Please clear it from the Payments page before ${lockDate}, when access to your classes, assignments and certificates pauses until the balance is settled.`;
  }
  if (tier === "balance-warning") {
    return `${amount} is still outstanding on your tuition. Access to your classes, assignments and certificates pauses on ${lockDate} unless it is settled. Pay from the Payments page or speak to your branch office today.`;
  }
  return `Access to your classes, assignments and certificates is now paused: ${amount} of your tuition is still outstanding. Settle it from the Payments page or with your branch office and your access is restored immediately.`;
}

export type WarningRun = {
  checked: number;
  atRisk: number;
  created: Array<{ studentId: string; name: string; tier: WarningTier | BalanceTier; balance: number }>;
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
      classType: true,
      pathway: true,
      createdAt: true,
      classesStartedAt: true,
      paymentGraceUntil: true,
      branch: { select: { name: true } },
      user: { select: { id: true, name: true } },
      payments: { where: receivedPaymentFilter(), select: { amount: true } },
      tuitionCharges: {
        where: { deletedAt: null },
        select: { id: true, level: true, amount: true, waivedAmount: true, legacyArrears: true, createdAt: true, settledAt: true },
      },
    },
  });

  // Students on an on-track tuition payment plan — treated exactly like a
  // future grace date: no balance-track escalation while they keep to it.
  const onTrackPlan = await onTrackPlanStudentIds(now);

  const run: WarningRun = { checked: students.length, atRisk: 0, created: [], skipped: 0 };

  for (const student of students) {
    const feeLookup = { level: student.level, branch: student.branch?.name ?? null, classType: student.classType, pathway: student.pathway };
    const tuitionFee = tuitionFeeFor(feeLookup);
    const requiredDeposit = requiredDepositFor(feeLookup);
    const totalPaid = student.payments.reduce((sum, p) => sum + p.amount, 0);
    const { fullPaid, depositPaid } = derivePaymentStatus({ totalPaid, tuitionFee, requiredDeposit });

    // The per-level ledger. When populated it decides both what is owed and
    // which clock the lock runs on; legacy arrears (levels passed before the
    // ledger existed) are chased on a gentle track, never with a lock threat.
    const ledger = buildLedger(student.tuitionCharges ?? [], totalPaid, now);
    const hasLedger = ledgerIsPopulated(ledger);
    const goForwardOwed = hasLedger ? ledger.goForwardOutstanding : Math.max(0, tuitionFee - totalPaid);

    if (hasLedger ? goForwardOwed <= 0 && ledger.legacyOutstanding <= 0 : fullPaid) continue;
    run.atRisk++;

    const graceUntil = student.paymentGraceUntil ? new Date(student.paymentGraceUntil) : null;
    const graceActive =
      onTrackPlan.has(student.id) || (!!graceUntil && now.getTime() < graceUntil.getTime());

    // -------- Legacy-arrears track: gentle, no lock language, fires once --------
    if (hasLedger && ledger.legacyOutstanding > 0 && !graceActive) {
      const marker = "legacy-arrears";
      const already = await prisma.notification.findFirst({
        where: { studentId: student.id, OR: [{ dedupeKey: marker }, { channel: marker }] },
        select: { id: true },
      });
      if (!already) {
        if (!dryRun) {
          await notify({
            to: { studentIds: [student.id] },
            kind: KIND.tuitionReminder,
            severity: "info",
            title: "An earlier tuition balance is on your account",
            message: `Our records show ₦${ledger.legacyOutstanding.toLocaleString()} still outstanding from an earlier level. Nothing is restricted — please settle it from the Payments page or arrange a plan with your branch office when you can.`,
            link: "/payments",
            dedupeKey: marker,
            push: true,
          });
        }
        run.created.push({ studentId: student.id, name: student.user.name ?? "(unnamed)", tier: "balance-notice", balance: ledger.legacyOutstanding });
      }
    }

    const balance = goForwardOwed;

    // -------- Balance track: part-paid, aimed at the 30-day post-start lock --------
    if (depositPaid && goForwardOwed > 0) {
      if (graceActive) {
        run.skipped++;
        continue;
      }

      const anchor =
        (hasLedger && ledger.oldestOpenGoForwardChargeAt
          ? new Date(ledger.oldestOpenGoForwardChargeAt)
          : null) ?? student.classesStartedAt ?? student.createdAt;
      const lockAt = new Date(anchor.getTime() + PART_PAYMENT_LOCK_DAYS * DAY_MS);
      const daysUntilLock = Math.ceil((lockAt.getTime() - now.getTime()) / DAY_MS);

      // Most-urgent tier currently reached (BALANCE_TIERS is ordered final→notice).
      const dueBalance = BALANCE_TIERS.find((t) => daysUntilLock <= t.withinDays);
      if (!dueBalance) continue;

      const marker = dueBalance.tier;
      const already = await prisma.notification.findFirst({
        where: { studentId: student.id, OR: [{ dedupeKey: marker }, { channel: marker }] },
        select: { id: true },
      });
      if (already) {
        run.skipped++;
        continue;
      }

      if (!dryRun) {
        await notify({
          to: { studentIds: [student.id] },
          kind: KIND.tuitionReminder,
          severity:
            dueBalance.tier === "balance-final"
              ? "critical"
              : dueBalance.tier === "balance-warning"
                ? "warning"
                : "info",
          title: balanceTitleFor(dueBalance.tier),
          message: balanceMessageFor(dueBalance.tier, balance, lockAt),
          link: "/payments",
          dedupeKey: marker,
          push: true,
        });
      }

      run.created.push({
        studentId: student.id,
        name: student.user.name ?? "(unnamed)",
        tier: dueBalance.tier,
        balance,
      });
      continue;
    }

    // -------- Registration-only track: never cleared the deposit --------
    // A student who has cleared the current-level deposit is handled by the
    // balance track above (even if all they owe now is legacy arrears) — they
    // are not "registration only".
    if (depositPaid) continue;

    const daysEnrolled = Math.floor((now.getTime() - student.createdAt.getTime()) / DAY_MS);

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
