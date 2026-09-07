import { NextResponse } from "next/server";

import { requireCapability, scopedBranchIds } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";
import { batchFromAdmission, monthNameToIndex, MONTH_NAMES } from "@/lib/batch";
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

const NO_BATCH = "(no batch)";
const MAX_STUDENTS = 4000;
const MAX_ASSIGN = 500;

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
        admission: true,
        branch: { select: { name: true } },
        user: { select: { name: true, email: true } },
      },
    });

    const rows: Row[] = students.map((s) => ({
      id: s.id,
      name: s.user?.name ?? "(no name)",
      email: s.user?.email ?? "",
      studentCode: s.studentCode,
      status: s.status,
      level: s.level,
      branchName: s.branch?.name ?? null,
      batch: batchFromAdmission(s.admission),
      startedClasses: Boolean(s.classesStartedAt),
    }));

    // branch → level → batch, each a stable key so the client can address a
    // group without sending its whole membership back.
    const groups = new Map<
      string,
      { branch: string; level: string; batch: string; count: number; started: number; ids: string[] }
    >();
    for (const row of rows) {
      const branch = row.branchName ?? "No branch";
      const batch = row.batch ?? NO_BATCH;
      const key = `${branch}||${row.level}||${batch}`;
      const g =
        groups.get(key) ?? { branch, level: row.level, batch, count: 0, started: 0, ids: [] };
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
        (monthNameToIndex(a.batch) ?? 99) - (monthNameToIndex(b.batch) ?? 99),
    );

    const byId: Record<string, Omit<Row, "id">> = {};
    for (const row of rows) {
      const { id, ...rest } = row;
      byId[id] = rest;
    }

    return NextResponse.json({
      groups: groupList,
      students: byId,
      total: rows.length,
      truncated: rows.length >= MAX_STUDENTS,
      noBatch: rows.filter((r) => !r.batch).length,
      currentIntake: await readCurrentIntake(tenantId),
      months: MONTH_NAMES,
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
  const batch = typeof body.batch === "string" ? body.batch.trim() : "";
  const monthIndex = monthNameToIndex(batch);

  if (ids.length === 0) {
    return NextResponse.json({ error: "Select at least one student" }, { status: 400 });
  }
  if (monthIndex === null) {
    return NextResponse.json({ error: "Give a real month name" }, { status: 400 });
  }
  const month = MONTH_NAMES[monthIndex];

  const where: Record<string, unknown> = { id: { in: ids }, ...tenantWhere(tenantId) };
  const allowedBranchIds = scopedBranchIds(gate.admin);
  if (allowedBranchIds) where.branchId = { in: allowedBranchIds };

  try {
    // Read-modify-write: admission is one JSON blob and the other keys in it
    // (phone, city, photo) must survive a batch change.
    const targets = await prisma.student.findMany({
      where,
      select: { id: true, admission: true },
    });

    let updated = 0;
    for (let i = 0; i < targets.length; i += 50) {
      const chunk = targets.slice(i, i + 50);
      await Promise.all(
        chunk.map((student) => {
          const admission =
            student.admission && typeof student.admission === "object"
              ? (student.admission as Record<string, unknown>)
              : {};
          if (admission.batch === month) return Promise.resolve();
          updated += 1;
          return prisma.student.update({
            where: { id: student.id },
            data: { admission: { ...admission, batch: month } },
          });
        }),
      );
    }

    return NextResponse.json({
      ok: true,
      updated,
      skipped: ids.length - targets.length,
      batch: month,
    });
  } catch (error) {
    console.error("Failed to assign cohort batch:", error);
    return NextResponse.json({ error: "Unable to move those students" }, { status: 500 });
  }
}
