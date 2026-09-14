/**
 * Phase C of the cohort-backfill work — see src/lib/cohort-classify.ts and
 * project memory. Fills the ONE field it is safe to derive in bulk:
 * `Student.classesStartedAt`, for students the classifier is sure are already
 * mid-course but who never confirmed a start date (no attendance button, no
 * office sign-off).
 *
 * WHAT IT WRITES, and nothing else:
 *   classesStartedAt        <- the classifier's suggestedStartedAt, clamped to
 *                              [registration date, today]
 *   startConfirmedAt        <- now
 *   startConfirmedVia       <- "derived-backfill"  (so a wrong call is traceable
 *                              and reversible, and the daily "have you started?"
 *                              prompt stops for them — exactly as an attendance
 *                              row already does in germany-journey-server.ts)
 *   startPromptSnoozedUntil <- null
 *
 * WHAT IT WILL NOT DO:
 *   - touch a student whose `classesStartedAt` is already set (idempotent —
 *     safe to re-run for stragglers);
 *   - touch anyone the classifier calls `new` or `unknown`, or anyone below
 *     "high" confidence;
 *   - write `admission.batch`. That month drives the timetable rotation, and a
 *     wrong one visibly breaks a whole cohort's calendar. The script only
 *     REPORTS the batch months it would suggest (…-batch-todo.csv); the office
 *     applies them by hand from /admin/cohorts using the mismatch flags, which
 *     is the human gate the plan calls for.
 *
 * SAFETY RAILS:
 *   - dry run by default; --commit required to write;
 *   - before any write, a JSON snapshot of every affected student's prior
 *     start fields is dropped in backups/ — restorable with a one-liner;
 *   - three CSVs are written every run (commit or not): the start-date fills,
 *     the batch months for the office to action, and the unclear residual;
 *   - writes are chunked transactions, tagged source:"script".
 *
 *   npx tsx --tsconfig tsconfig.json scripts/backfill-cohort-start-dates.ts
 *   npx tsx --tsconfig tsconfig.json scripts/backfill-cohort-start-dates.ts --commit
 *   npx tsx --tsconfig tsconfig.json scripts/backfill-cohort-start-dates.ts --branch "Lagos" --limit 500
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { prisma } from "@/lib/prisma";
import { runUnscoped } from "@/lib/tenant/context";
import { runWithAuditActor } from "@/lib/audit-context";
import { batchFromAdmission } from "@/lib/batch";
import { defaultCurrentIntake, type CurrentIntake } from "@/lib/intake";
import { readCurrentIntake } from "@/lib/intake-server";
import { classifyRoster, type RosterStudent } from "@/lib/cohort-classify-server";
import type { CohortClassification } from "@/lib/cohort-classify";

/* ---------------------------------------------------------------- flags -- */

const argv = process.argv.slice(2);
const COMMIT = argv.includes("--commit");

function flag(name: string): string | null {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}

const BRANCH = flag("branch");
const TENANT = flag("tenant");
const LIMIT = Number(flag("limit")) || undefined;

const NOW = new Date();
const BACKUP_DIR = join(process.cwd(), "backups");
const STAMP = NOW.toISOString().replace(/[:.]/g, "-").slice(0, 19);

/* ---------------------------------------------------------------- types -- */

type Loaded = RosterStudent & {
  tenantId: string | null;
  studentCode: string | null;
  branchName: string | null;
  studentName: string;
  email: string;
  storedBatch: string | null;
  priorClassesStartedAt: Date | null;
  priorStartConfirmedAt: Date | null;
  priorStartConfirmedVia: string | null;
};

type StartFill = {
  student: Loaded;
  classification: CohortClassification;
  /** suggestedStartedAt, clamped into [createdAt, now]. */
  applied: Date;
};

/* ------------------------------------------------------------- csv util -- */

function csv(cols: string[], rows: Array<Record<string, unknown>>): string {
  const cell = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
}

function write(name: string, contents: string) {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const path = join(BACKUP_DIR, `cohort-backfill-${STAMP}-${name}`);
  writeFileSync(path, contents, "utf8");
  return path;
}

/* ------------------------------------------------------------------ run -- */

async function load(): Promise<Loaded[]> {
  const where: Record<string, unknown> = { deletedAt: null, status: "active" };
  if (TENANT) where.tenantId = TENANT;
  if (BRANCH) where.branch = { name: { equals: BRANCH, mode: "insensitive" } };

  const students = await prisma.student.findMany({
    where,
    take: LIMIT,
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      level: true,
      admission: true,
      createdAt: true,
      classesStartedAt: true,
      levelCompletedFor: true,
      startConfirmedAt: true,
      startConfirmedVia: true,
      tenantId: true,
      studentCode: true,
      branch: { select: { name: true } },
      user: { select: { name: true, email: true } },
    },
  });

  return students.map((s) => ({
    id: s.id,
    level: s.level,
    admission: s.admission,
    createdAt: s.createdAt,
    classesStartedAt: s.classesStartedAt,
    levelCompletedFor: s.levelCompletedFor,
    tenantId: s.tenantId,
    studentCode: s.studentCode,
    branchName: s.branch?.name ?? null,
    studentName: s.user?.name ?? "(no name)",
    email: s.user?.email ?? "",
    storedBatch: batchFromAdmission(s.admission),
    priorClassesStartedAt: s.classesStartedAt,
    priorStartConfirmedAt: s.startConfirmedAt,
    priorStartConfirmedVia: s.startConfirmedVia,
  }));
}

/** Classify per tenant, because the "new" test compares against that tenant's intake. */
async function classifyAll(students: Loaded[]): Promise<Record<string, CohortClassification>> {
  const byTenant = new Map<string | null, Loaded[]>();
  for (const s of students) {
    const list = byTenant.get(s.tenantId);
    if (list) list.push(s);
    else byTenant.set(s.tenantId, [s]);
  }

  const intakeCache = new Map<string | null, CurrentIntake>();
  const out: Record<string, CohortClassification> = {};

  for (const [tenantId, group] of byTenant) {
    let intake = intakeCache.get(tenantId);
    if (!intake) {
      intake = tenantId ? await readCurrentIntake(tenantId) : defaultCurrentIntake(NOW);
      intakeCache.set(tenantId, intake);
    }
    const { byId } = await classifyRoster(
      group.map((s) => ({
        id: s.id,
        level: s.level,
        admission: s.admission,
        createdAt: s.createdAt,
        classesStartedAt: s.classesStartedAt,
        levelCompletedFor: s.levelCompletedFor,
      })),
      intake,
      NOW,
    );
    Object.assign(out, byId);
  }

  return out;
}

function clamp(date: Date, floor: Date, ceil: Date): Date {
  if (date < floor) return floor;
  if (date > ceil) return ceil;
  return date;
}

function summarise(startFills: StartFill[], batchTodo: Loaded[], residual: Loaded[]) {
  const byBranch = new Map<string, { fills: number; batchTodo: number; residual: number }>();
  const bump = (name: string | null, key: "fills" | "batchTodo" | "residual") => {
    const b = name ?? "Unassigned";
    const e = byBranch.get(b) ?? { fills: 0, batchTodo: 0, residual: 0 };
    e[key] += 1;
    byBranch.set(b, e);
  };
  startFills.forEach((f) => bump(f.student.branchName, "fills"));
  batchTodo.forEach((s) => bump(s.branchName, "batchTodo"));
  residual.forEach((s) => bump(s.branchName, "residual"));

  console.log(`\n${COMMIT ? "COMMIT" : "DRY RUN"}${BRANCH ? ` · branch=${BRANCH}` : ""}${TENANT ? ` · tenant=${TENANT}` : ""}\n`);
  console.log(`  start-date fills (this script writes these) : ${startFills.length}`);
  console.log(`  batch months for the office to apply by hand: ${batchTodo.length}`);
  console.log(`  unclear — needs a human                     : ${residual.length}\n`);
  for (const [branch, e] of [...byBranch.entries()].sort()) {
    console.log(`    ${branch.padEnd(16)}  fills ${String(e.fills).padStart(4)}   batch-todo ${String(e.batchTodo).padStart(4)}   unclear ${String(e.residual).padStart(4)}`);
  }
  console.log();
}

async function main() {
  const students = await load();
  if (students.length === 0) {
    console.log("No students matched. Nothing to do.");
    return;
  }

  const classified = await classifyAll(students);

  const startFills: StartFill[] = [];
  const batchTodo: Loaded[] = [];
  const residual: Loaded[] = [];

  for (const student of students) {
    const c = classified[student.id];
    if (!c) continue;

    if (c.status === "unknown") residual.push(student);

    const midCourse = c.status === "ongoing" || c.status === "returning";
    const sure = c.confidence === "high";

    if (midCourse && sure && !student.classesStartedAt && c.suggestedStartedAt) {
      const suggested = new Date(c.suggestedStartedAt);
      if (!Number.isNaN(suggested.getTime())) {
        startFills.push({
          student,
          classification: c,
          applied: clamp(suggested, student.createdAt, NOW),
        });
      }
    }

    if (midCourse && sure && !student.storedBatch && c.suggestedBatch) {
      batchTodo.push(student);
    }
  }

  summarise(startFills, batchTodo, residual);

  const fillsCsv = write(
    "start-fills.csv",
    csv(
      ["studentCode", "name", "email", "branch", "level", "status", "currentBatch", "oldStart", "newStart", "evidence"],
      startFills.map((f) => ({
        studentCode: f.student.studentCode,
        name: f.student.studentName,
        email: f.student.email,
        branch: f.student.branchName,
        level: f.student.level,
        status: f.classification.status,
        currentBatch: f.student.storedBatch ?? "",
        oldStart: "",
        newStart: f.applied.toISOString().slice(0, 10),
        evidence: f.classification.evidence.join(" · "),
      })),
    ),
  );
  const batchCsv = write(
    "batch-todo.csv",
    csv(
      ["studentCode", "name", "email", "branch", "level", "status", "suggestedBatch", "mismatch", "evidence"],
      batchTodo.map((s) => {
        const c = classified[s.id];
        return {
          studentCode: s.studentCode,
          name: s.studentName,
          email: s.email,
          branch: s.branchName,
          level: s.level,
          status: c.status,
          suggestedBatch: c.suggestedBatch ?? "",
          mismatch: c.mismatch ?? "",
          evidence: c.evidence.join(" · "),
        };
      }),
    ),
  );
  const residualCsv = write(
    "unclear.csv",
    csv(
      ["studentCode", "name", "email", "branch", "level", "registered", "currentBatch", "evidence"],
      residual.map((s) => {
        const c = classified[s.id];
        return {
          studentCode: s.studentCode,
          name: s.studentName,
          email: s.email,
          branch: s.branchName,
          level: s.level,
          registered: s.createdAt.toISOString().slice(0, 10),
          currentBatch: s.storedBatch ?? "",
          evidence: c.evidence.join(" · "),
        };
      }),
    ),
  );
  console.log(`  wrote ${fillsCsv}`);
  console.log(`  wrote ${batchCsv}`);
  console.log(`  wrote ${residualCsv}\n`);

  if (!COMMIT) {
    console.log("Dry run. Re-run with --commit to write the start-date fills above.\n");
    return;
  }

  if (startFills.length === 0) {
    console.log("Nothing to write.\n");
    return;
  }

  // Restorable snapshot of the exact fields about to change.
  const snapshotPath = write(
    "snapshot.json",
    JSON.stringify(
      startFills.map((f) => ({
        id: f.student.id,
        classesStartedAt: f.student.priorClassesStartedAt,
        startConfirmedAt: f.student.priorStartConfirmedAt,
        startConfirmedVia: f.student.priorStartConfirmedVia,
      })),
      null,
      2,
    ),
  );
  console.log(`  snapshot: ${snapshotPath}\n`);

  const CHUNK = 100;
  let written = 0;
  for (let i = 0; i < startFills.length; i += CHUNK) {
    const slice = startFills.slice(i, i + CHUNK);
    await prisma.$transaction(
      slice.map((f) =>
        prisma.student.update({
          where: { id: f.student.id },
          data: {
            classesStartedAt: f.applied,
            startConfirmedAt: NOW,
            startConfirmedVia: "derived-backfill",
            startPromptSnoozedUntil: null,
          },
        }),
      ),
      { timeout: 120_000 },
    );
    written += slice.length;
    console.log(`  ...${written}/${startFills.length}`);
  }

  console.log(`\nDone. ${written} start date(s) filled. ${batchTodo.length} batch month(s) still need the office (see batch-todo.csv).\n`);
}

const run = () => runUnscoped("cohort start-date backfill across every tenant", main);

(COMMIT
  ? runWithAuditActor({ source: "script", allowUnscopedWrites: true }, run)
  : run()
)
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
