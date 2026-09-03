/**
 * One-time cutover: give every existing student a TuitionCharge for their
 * current level AND every level below it they must have passed through.
 *
 * WHY: before the per-level ledger, "what a student owes" only ever looked at
 * their current level's fee, so a promotion silently erased the previous
 * level's shortfall. A student could ride A1 -> B1 on part-payments and finish
 * owing money nobody could see. This raises the missing charges so that debt
 * becomes visible.
 *
 * QUARANTINE: the current-level charge is a normal go-forward charge. Every
 * LOWER level charge is flagged `legacyArrears = true` — fully visible and
 * chased, but it does NOT trip the automatic portal lock and does NOT
 * hard-block promotion. Students already mid-course never agreed to those rules.
 *
 * PRICE: lower levels are priced at TODAY's tier for that level and branch.
 * There is no historical price table, so this is a documented approximation.
 *
 * Idempotent: skips any (student, level) that already has a charge, so it is
 * safe to run more than once and safe to run after go-live for stragglers.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/backfill-tuition-charges.ts            # dry run
 *   npx tsx --tsconfig tsconfig.json scripts/backfill-tuition-charges.ts --commit   # write
 *
 * WHY runUnscoped + runWithAuditActor: a bare script has no request-scoped
 * tenant context, and TuitionCharge is tenant-owned (src/lib/tenant/registry.ts)
 * — every query would throw without it. A cutover legitimately spans every
 * tenant. `tenantId` is copied from each student's own row onto the charge.
 */

import { prisma } from "@/lib/prisma";
import { runUnscoped } from "@/lib/tenant/context";
import { runWithAuditActor } from "@/lib/audit-context";
import { LEVELS } from "@/lib/levels";
import { tuitionFeeFor } from "@/lib/payment";
import { naira } from "@/lib/finance/receivables";

const COMMIT = process.argv.includes("--commit");
const LADDER = LEVELS as readonly string[];

type Row = {
  studentId: string;
  tenantId: string | null;
  level: string;
  amount: number;
  legacyArrears: boolean;
  branchName: string | null;
  classType: string;
  createdAt: Date;
};

async function build(): Promise<Row[]> {
  const students = await prisma.student.findMany({
    select: {
      id: true,
      level: true,
      classType: true,
      createdAt: true,
      classesStartedAt: true,
      tenantId: true,
      branch: { select: { name: true } },
      tuitionCharges: { select: { level: true } },
    },
  });

  const rows: Row[] = [];

  for (const student of students) {
    const current = String(student.level ?? "A1").trim().toUpperCase();
    const currentIndex = LADDER.indexOf(current);
    // An unrecognised level (bad data) still gets exactly its own charge.
    const topIndex = currentIndex === -1 ? 0 : currentIndex;
    const levels = currentIndex === -1 ? [current] : LADDER.slice(0, topIndex + 1);

    const have = new Set(student.tuitionCharges.map((charge) => charge.level.toUpperCase()));
    const anchor = student.classesStartedAt ?? student.createdAt;

    levels.forEach((level, i) => {
      if (have.has(level)) return;
      rows.push({
        studentId: student.id,
        tenantId: student.tenantId,
        level,
        amount: tuitionFeeFor({
          level,
          branch: student.branch?.name ?? null,
          classType: student.classType,
        }),
        legacyArrears: level !== current,
        branchName: student.branch?.name ?? null,
        classType: student.classType ?? "group",
        // Stamp in ladder order so FIFO allocation == ladder order. Anchored on
        // when the student actually started, so ageing reflects how long the
        // debt has really stood.
        createdAt: new Date(new Date(anchor).getTime() + i * 60_000),
      });
    });
  }

  return rows;
}

function summarise(rows: Row[]) {
  const byBranch = new Map<
    string,
    { students: Set<string>; legacyCount: number; legacyNaira: number; currentCount: number; currentNaira: number }
  >();

  for (const row of rows) {
    const key = row.branchName ?? "Unassigned";
    const entry =
      byBranch.get(key) ??
      { students: new Set<string>(), legacyCount: 0, legacyNaira: 0, currentCount: 0, currentNaira: 0 };
    entry.students.add(row.studentId);
    if (row.legacyArrears) {
      entry.legacyCount += 1;
      entry.legacyNaira += row.amount;
    } else {
      entry.currentCount += 1;
      entry.currentNaira += row.amount;
    }
    byBranch.set(key, entry);
  }

  console.log(`\n${COMMIT ? "WRITING" : "DRY RUN"} — ${rows.length} charge(s) to create\n`);
  for (const [branch, e] of [...byBranch.entries()].sort()) {
    console.log(`  ${branch}`);
    console.log(`    students touched : ${e.students.size}`);
    console.log(`    current-level    : ${e.currentCount}  (${naira(e.currentNaira)})`);
    console.log(`    legacy arrears   : ${e.legacyCount}  (${naira(e.legacyNaira)})`);
  }
  const legacyTotal = rows.filter((r) => r.legacyArrears).reduce((s, r) => s + r.amount, 0);
  const currentTotal = rows.filter((r) => !r.legacyArrears).reduce((s, r) => s + r.amount, 0);
  console.log(`\n  TOTAL current-level charged : ${naira(currentTotal)}`);
  console.log(`  TOTAL legacy arrears raised  : ${naira(legacyTotal)}`);
  console.log(`  (legacy arrears do not auto-lock or block promotion)\n`);
}

async function main() {
  const rows = await build();
  if (!rows.length) {
    console.log("Every student already has a charge for every level they have reached. Nothing to do.");
    return;
  }

  summarise(rows);

  if (!COMMIT) {
    console.log("Re-run with --commit to write these rows.");
    return;
  }

  let written = 0;
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    await prisma.$transaction(
      slice.map((row) =>
        prisma.tuitionCharge.create({
          data: {
            studentId: row.studentId,
            level: row.level,
            amount: row.amount,
            classType: row.classType,
            branchName: row.branchName,
            origin: "backfill",
            legacyArrears: row.legacyArrears,
            createdAt: row.createdAt,
            note: row.legacyArrears ? "Backfilled at ledger cutover — level passed before the ledger existed" : "Backfilled at ledger cutover",
            ...(row.tenantId ? { tenantId: row.tenantId } : {}),
          },
        }),
      ),
      { timeout: 120_000 },
    );
    written += slice.length;
    console.log(`  ...${written}/${rows.length}`);
  }

  console.log(`\nDone. ${written} charge(s) created.`);
}

runWithAuditActor({ source: "script", allowUnscopedWrites: true }, () =>
  runUnscoped("one-time tuition-ledger cutover across every tenant", main),
)
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
