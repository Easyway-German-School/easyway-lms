/**
 * Bring every Travel Package student's tuition ledger onto the flat ₦980,000.
 *
 * WHY: Travel Package replaces the per-level fee ladder with one flat price,
 * but a student onboarded on the default pathway (then switched), or one whose
 * charge was raised before the pathway was set, keeps a per-level charge
 * (~₦150k). Every screen — the student's own portal included — then reads them
 * as "paid in full" off a ₦500k first payment. `reconcileTravelPackageStudent`
 * collapses the ledger to the one ₦980,000 charge; this runs it across the
 * whole roster.
 *
 * Money received is never touched — only the debit side. A student the fix
 * moves from "settled" to "owing" gets the same warm portal note the office
 * button sends.
 *
 * Idempotent: an already-correct student is a no-op, so it is safe to re-run.
 *
 *   npx tsx --tsconfig tsconfig.json --env-file=.env.local scripts/reconcile-travel-package.ts           # dry run — report only
 *   npx tsx --tsconfig tsconfig.json --env-file=.env.local scripts/reconcile-travel-package.ts --apply   # write + notify
 *
 * WHY runUnscoped + runWithAuditActor: a bare script has no request-scoped
 * tenant context, and TuitionCharge is tenant-owned — queries would throw
 * without it. Reconciling every tenant's Travel Package students is a
 * legitimate cross-tenant sweep.
 */

import { prisma } from "@/lib/prisma";
import { runUnscoped } from "@/lib/tenant/context";
import { runWithAuditActor } from "@/lib/audit-context";
import { TRAVEL_PACKAGE_PATHWAY } from "@/lib/payment";
import { reconcileTravelPackageStudent } from "@/lib/travel-package";
import { travelPackagePartPaymentNotice } from "@/lib/travel-package-notice";
import { naira } from "@/lib/finance/receivables";

const APPLY = process.argv.includes("--apply");

async function main() {
  const students = await prisma.student.findMany({
    where: { pathway: TRAVEL_PACKAGE_PATHWAY },
    select: { id: true, user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
  });

  console.log(
    `${students.length} student(s) on the "${TRAVEL_PACKAGE_PATHWAY}" pathway.` +
      (APPLY ? " Applying fixes." : " Dry run — no writes."),
  );

  let changed = 0;
  let notified = 0;

  for (const student of students) {
    const who = student.user?.name || student.user?.email || student.id;

    // The helper writes as it goes, so in a dry run we only *report*. We call
    // it either way — its work is idempotent — but guard the writes behind
    // APPLY by reading the ledger first for the dry-run summary.
    const before = await prisma.tuitionCharge.findMany({
      where: { studentId: student.id, deletedAt: null },
      select: { level: true, amount: true },
    });
    const beforeTotal = before.reduce((sum, c) => sum + c.amount, 0);
    const looksWrong = before.length !== 1 || beforeTotal !== 980000;

    if (!looksWrong) {
      console.log(`  ok    ${who} — one ₦980,000 charge already.`);
      continue;
    }

    if (!APPLY) {
      console.log(
        `  FIX   ${who} — ${before.length} charge(s) totalling ${naira(beforeTotal)} ` +
          `(${before.map((c) => `${c.level}:${naira(c.amount)}`).join(", ") || "none"}) -> one ${naira(980000)} charge.`,
      );
      changed += 1;
      continue;
    }

    try {
      const result = await reconcileTravelPackageStudent({ studentId: student.id, setPathway: true });
      if (!result) {
        console.log(`  skip  ${who} — not found on re-read.`);
        continue;
      }
      changed += 1;
      const noteBits: string[] = [];
      if (result.chargeFixed) noteBits.push("charge -> ₦980,000");
      if (result.chargesRetired > 0) noteBits.push(`${result.chargesRetired} old charge(s) folded`);
      if (result.pathwaySet) noteBits.push("pathway set");
      console.log(
        `  DONE  ${who} — ${noteBits.join(", ") || "no change"}. ` +
          `Paid ${naira(result.paid)}, now owes ${naira(result.owed)}.`,
      );
      try {
        await travelPackagePartPaymentNotice(result);
        if (result.wasFullPaidBefore && !result.fullPaidAfter) notified += 1;
      } catch (noticeError) {
        console.error(`        (notice failed for ${who})`, noticeError);
      }
    } catch (error) {
      console.error(`  FAIL  ${who}:`, error);
      process.exitCode = 1;
    }
  }

  console.log(
    `\n${APPLY ? "Reconciled" : "Would reconcile"} ${changed} student(s).` +
      (APPLY ? ` ${notified} told it's now a part payment.` : ""),
  );
}

runWithAuditActor({ source: "script", allowUnscopedWrites: true }, () =>
  runUnscoped("reconcile Travel Package ledgers to the flat price", main),
)
  .catch((error) => {
    console.error("Reconcile failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
