import { prisma } from "@/lib/prisma";
import { computeAll, FINANCE_STUDENT_SELECT, naira, nairaShort } from "@/lib/finance/receivables";
import { KIND, notify } from "@/lib/notify";

/**
 * Once-a-week roundup for whoever holds `payments`: what the tuition ledger did
 * this week that a person should look at.
 *
 * Idempotent per ISO week via the notification dedupeKey, so it is safe to call
 * from /api/cron/tick on every run — the first call in a given week sends, the
 * rest are dropped by notify(). Nothing to report → nothing sent.
 */

function isoWeekKey(now: Date): string {
  // Thursday-of-this-week trick for a stable ISO week number.
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export type AccountantDigestResult = { sent: boolean; weekKey: string; reason?: string };

export async function sendAccountantDigest(now: Date = new Date()): Promise<AccountantDigestResult> {
  const weekKey = isoWeekKey(now);
  const dedupeKey = `accountant-digest-${weekKey}`;
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);

  const [overrides, defaultedPlans, students] = await Promise.all([
    prisma.auditLog.findMany({
      where: { action: "promotion.fee_override", at: { gte: weekAgo } },
      select: { summary: true },
    }),
    prisma.paymentPlan.findMany({
      where: { status: "defaulted", defaultedAt: { gte: weekAgo }, deletedAt: null },
      select: { studentId: true, student: { select: { user: { select: { name: true } } } } },
    }),
    prisma.student.findMany({ where: { status: "active" }, select: FINANCE_STUDENT_SELECT }),
  ]);

  const finance = computeAll(students, now).filter((row) => row.ledgerPopulated);
  const owing = finance.filter((row) => row.lifetimeOutstanding > 0).sort((a, b) => b.lifetimeOutstanding - a.lifetimeOutstanding);
  const legacyTotal = finance.reduce((sum, row) => sum + row.legacyOutstanding, 0);
  const goForwardTotal = finance.reduce((sum, row) => sum + row.goForwardOutstanding, 0);
  const owesPrior = finance.filter((row) => row.owesPriorLevel).length;

  if (overrides.length === 0 && defaultedPlans.length === 0 && owing.length === 0) {
    return { sent: false, weekKey, reason: "nothing to report" };
  }

  const lines: string[] = [
    `Tuition ledger — week ${weekKey}`,
    ``,
    `Outstanding: ${nairaShort(goForwardTotal)} go-forward` +
      (legacyTotal > 0 ? ` + ${nairaShort(legacyTotal)} legacy arrears` : ""),
    `${owesPrior} student${owesPrior === 1 ? "" : "s"} owe on a level they have already left.`,
  ];
  if (overrides.length) {
    lines.push(``, `Promoted with an open balance (override), ${overrides.length} this week:`);
    for (const o of overrides.slice(0, 8)) lines.push(`  • ${o.summary ?? "(no summary)"}`);
  }
  if (defaultedPlans.length) {
    lines.push(``, `Payment plans defaulted this week:`);
    for (const p of defaultedPlans.slice(0, 10)) lines.push(`  • ${p.student.user?.name ?? p.studentId}`);
  }
  if (owing.length) {
    lines.push(``, `Largest balances:`);
    for (const row of owing.slice(0, 8)) {
      lines.push(`  • ${row.name} (${row.branch}) — ${naira(row.lifetimeOutstanding)}${row.owesPriorLevel ? " *earlier level" : ""}`);
    }
  }

  await notify({
    to: { audience: "admin", capability: "payments" },
    kind: KIND.tuitionReminder,
    severity: "info",
    title: `Tuition ledger digest — week ${weekKey}`,
    message: lines.join("\n"),
    link: "/admin/finance?tab=receivables&focus=owing",
    dedupeKey,
  }).catch((error) => {
    console.error("accountant digest notify failed", { weekKey, error });
  });

  return { sent: true, weekKey };
}
