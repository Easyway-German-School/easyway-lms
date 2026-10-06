import { NextResponse } from "next/server";

import { requireCapability, scopedBranchIds } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";
import { realignStudentCodeById } from "@/lib/student-code";
import { batchFromAdmission, batchYearFromAdmission, monthNameToIndex, MONTH_NAMES, resolveBatchWindow } from "@/lib/batch";
import { parseBatchDestination, readPendingBatchTransfer, scheduleBatchTransfers } from "@/lib/batch-transfer";
import { classifyRoster } from "@/lib/cohort-classify-server";
import { readCurrentIntake } from "@/lib/intake-server";

/**
 * The cohort view — every student grouped by branch → level → batch month.
 *
 * The point is the "(no batch)" bucket and the wrong-month strays: students
 * who came in before the current-intake default existed, or through an import
 * row with a blank batch column, and now sit outside every cohort the
 * timetable, the promotion engine and the "message the September intake" send
 * can see. GET lists the groups; POST moves a selection into one month.
 *
 * Reversible: it only rewrites `admission.batch`, one JSON key, and the
 * previous value is in the audit trail like any other student edit.
 */

export const dynamic = "force-dynamic";
// A move re-points tutors and student IDs per student; see batch-transfer.ts.
export const maxDuration = 60;

const NO_BATCH = "(no batch)";
const MAX_STUDENTS = 4000;
const MAX_ASSIGN = 400;

/** The tenant fence GET/DELETE on /api/admin/students use — no-branch students included. */
function tenantWhere(tenantId: string | null | undefined) {
  if (!tenantId) return {};
  return {
    OR: [{ tenantId }, { branch: { tenantId } }, { user: { tenantId } }],
  };
}

type Row = {
  id: string;
  name: string;
  email: string;
  studentCode: string | null;
  status: string;
  level: string;
  branchName: string | null;
  batch: string | null;
  batchYear: number | null;
  pendingBatchTransfer: { month: string; year: number } | null;
  startedClasses: boolean;
};

export async function GET() {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const tenantId = gate.session.user.tenantId ?? null;

  const where: Record<string, unknown> = { ...tenantWhere(tenantId) };
  const allowedBranchIds = scopedBranchIds(gate.admin);
  if (allowedBranchIds) where.branchId = { in: allowedBranchIds };

  try {
    const students = await prisma.student.findMany({
      where,
      take: MAX_STUDENTS,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        level: true,
        status: true,
        studentCode: true,
        classesStartedAt: true,
        levelCompletedFor: true,
        createdAt: true,
        admission: true,
        enrolments: {
          where: { outcome: "ongoing", deletedAt: null },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { batchYear: true },
        },
        branch: { select: { name: true } },
        user: { select: { name: true, email: true } },
      },
    });

    const rows: Row[] = students.map((s) => {
      const batch = batchFromAdmission(s.admission);
      const batchYear =
        batchYearFromAdmission(s.admission) ??
        s.enrolments[0]?.batchYear ??
        (batch ? resolveBatchWindow(batch, { registeredAt: s.createdAt })?.year ?? null : null);
      return {
        id: s.id,
        name: s.user?.name ?? "(no name)",
        email: s.user?.email ?? "",
        studentCode: s.studentCode,
        status: s.status,
        level: s.level,
        branchName: s.branch?.name ?? null,
        batch,
        batchYear,
        pendingBatchTransfer: readPendingBatchTransfer(s.admission),
        startedClasses: Boolean(s.classesStartedAt),
      };
    });

    // branch → level → batch, each a stable key so the client can address a
    // group without sending its whole membership back.
    const groups = new Map<
      string,
      { branch: string; level: string; batch: string; batchYear: number | null; count: number; started: number; ids: string[] }
    >();
    for (const row of rows) {
      const branch = row.branchName ?? "No branch";
      const batch = row.batch ?? NO_BATCH;
      const key = `${branch}||${row.level}||${batch}||${row.batchYear ?? "?"}`;
      const g =
        groups.get(key) ?? { branch, level: row.level, batch, batchYear: row.batchYear, count: 0, started: 0, ids: [] };
      g.count += 1;
      if (row.startedClasses) g.started += 1;
      g.ids.push(row.id);
      groups.set(key, g);
    }

    const groupList = [...groups.values()].sort(
      (a, b) =>
        a.branch.localeCompare(b.branch) ||
        a.level.localeCompare(b.level) ||
        // Unknown month sorts last; real months in calendar order.
        (monthNameToIndex(a.batch) ?? 99) - (monthNameToIndex(b.batch) ?? 99) ||
        (a.batchYear ?? 0) - (b.batchYear ?? 0),
    );

    const byId: Record<string, Omit<Row, "id">> = {};
    for (const row of rows) {
      const { id, ...rest } = row;
      byId[id] = rest;
    }

    const currentIntake = await readCurrentIntake(tenantId);

    // The read-only half: is each of these starting a batch or mid-course, and
    // does their stored batch month agree with the evidence? No writes — the
    // office reads this, eyeballs it, and fixes anything wrong by hand with the
    // existing "move to month" control.
    const { byId: classifications, tally: classTally } = await classifyRoster(
      students.map((s) => ({
        id: s.id,
        level: s.level,
        admission: s.admission,
        createdAt: s.createdAt,
        classesStartedAt: s.classesStartedAt,
        levelCompletedFor: s.levelCompletedFor,
      })),
      currentIntake,
    );

    const startAbsolute = Math.max(
      new Date().getFullYear() * 12 + new Date().getMonth(),
      currentIntake.year * 12 + (monthNameToIndex(currentIntake.month) ?? new Date().getMonth()),
    );
    const batchOptions = Array.from({ length: 24 }, (_, offset) => {
      const absolute = startAbsolute + offset;
      const year = Math.floor(absolute / 12);
      const month = MONTH_NAMES[absolute % 12];
      return { month, year, label: `${month} ${year}` };
    });

    return NextResponse.json({
      groups: groupList,
      students: byId,
      total: rows.length,
      truncated: rows.length >= MAX_STUDENTS,
      noBatch: rows.filter((r) => !r.batch).length,
      currentIntake,
      batchOptions,
      classifications,
      classTally,
    });
  } catch (error) {
    console.error("Failed to load cohorts:", error);
    return NextResponse.json({ error: "Unable to load cohorts" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const tenantId = gate.session.user.tenantId ?? null;
  const body = await request.json().catch(() => ({}));

  const ids = Array.isArray(body.studentIds)
    ? (body.studentIds as unknown[])
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        .slice(0, MAX_ASSIGN)
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "Select at least one student" }, { status: 400 });
  }
  const parsed = parseBatchDestination(body.batch, body.batchYear);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { destination } = parsed;

  const where: Record<string, unknown> = { id: { in: ids }, ...tenantWhere(tenantId) };
  const allowedBranchIds = scopedBranchIds(gate.admin);
  if (allowedBranchIds) where.branchId = { in: allowedBranchIds };

  try {
    // Read-modify-write: admission is one JSON blob and the other keys in it
    // (phone, city, photo) must survive a batch change. The move itself - the
    // schedule, the wait for payment, the tutor, the student ID - is
    // src/lib/batch-transfer.ts, shared with the Students page.
    const targets = await prisma.student.findMany({
      where,
      select: { id: true, admission: true, createdAt: true },
    });

    const summary = await scheduleBatchTransfers(targets, destination, gate.session.user.id ?? null);

    return NextResponse.json({
      ok: true,
      ...summary,
      skipped: ids.length - targets.length,
      batch: destination.month,
      batchYear: destination.year,
    });
  } catch (error) {
    console.error("Failed to assign cohort batch:", error);
    return NextResponse.json({ error: "Unable to move those students" }, { status: 500 });
  }
}
