import { NextResponse } from "next/server";

import { requireCapability, scopedBranchIds } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";
import { batchFromAdmission, monthNameToIndex, MONTH_NAMES } from "@/lib/batch";
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
        levelCompletedFor: true,
        createdAt: true,
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

    return NextResponse.json({
      groups: groupList,
      students: byId,
      total: rows.length,
      truncated: rows.length >= MAX_STUDENTS,
      noBatch: rows.filter((r) => !r.batch).length,
      currentIntake,
      months: MONTH_NAMES,
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

/** "YYYY-MM-DD" → local midday (survives a DST / server-offset slide). */
function parseCalendarDay(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Resolve ONE student from the "can't place" worklist.
 *
 * This is the human gate the plan calls for: the classifier can only guess at a
 * quiet, ambiguous account, so a person confirms it here and the answer is
 * written to `admission.cohortStatus`, which the classifier then treats as the
 * truth. A "new" confirmation also drops them into the current intake if they
 * had no batch; an "ongoing" confirmation with a month fills `classesStartedAt`
 * (only when it is still blank — an existing start date is someone's real
 * answer and is left alone).
 *
 *   { studentId, status: "new" | "ongoing", startedOn?: "YYYY-MM-DD", batch?: "September" }
 */
export async function PATCH(request: Request) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const tenantId = gate.session.user.tenantId ?? null;
  const body = await request.json().catch(() => ({}));

  const studentId = typeof body.studentId === "string" ? body.studentId.trim() : "";
  const status = body.status === "new" || body.status === "ongoing" ? body.status : null;
  const startedOnRaw = typeof body.startedOn === "string" ? body.startedOn : "";
  const batchRaw = typeof body.batch === "string" ? body.batch.trim() : "";

  if (!studentId) return NextResponse.json({ error: "No student given" }, { status: 400 });
  if (!status) return NextResponse.json({ error: "Confirm new or ongoing" }, { status: 400 });

  const batchMonthIndex = batchRaw ? monthNameToIndex(batchRaw) : null;
  if (batchRaw && batchMonthIndex === null) {
    return NextResponse.json({ error: "Give a real month name" }, { status: 400 });
  }

  const startedOn = status === "ongoing" && startedOnRaw ? parseCalendarDay(startedOnRaw) : null;
  if (status === "ongoing" && startedOnRaw && !startedOn) {
    return NextResponse.json({ error: "That start date could not be read" }, { status: 400 });
  }

  const where: Record<string, unknown> = { id: studentId, ...tenantWhere(tenantId) };
  const allowedBranchIds = scopedBranchIds(gate.admin);
  if (allowedBranchIds) where.branchId = { in: allowedBranchIds };

  try {
    const student = await prisma.student.findFirst({
      where,
      select: { id: true, admission: true, createdAt: true, classesStartedAt: true },
    });
    if (!student) return NextResponse.json({ error: "Not on your roster" }, { status: 404 });

    const admission =
      student.admission && typeof student.admission === "object"
        ? (student.admission as Record<string, unknown>)
        : {};

    const now = new Date();
    const actor = gate.session.user.name || gate.session.user.email || "office";

    const patch: Record<string, unknown> = {
      ...admission,
      cohortStatus: status,
      cohortStatusAt: now.toISOString(),
      cohortStatusBy: actor,
    };

    // The month to file them under: what the office typed, else — for a new
    // student with no batch yet — the current intake.
    let resolvedBatch: string | null = batchMonthIndex !== null ? MONTH_NAMES[batchMonthIndex] : null;
    if (!resolvedBatch && status === "new" && !batchFromAdmission(admission)) {
      resolvedBatch = (await readCurrentIntake(tenantId)).month;
    }
    if (resolvedBatch) patch.batch = resolvedBatch;

    const data: Record<string, unknown> = { admission: patch };

    let filledStart: string | null = null;
    if (status === "ongoing" && startedOn && !student.classesStartedAt) {
      const clamped =
        startedOn < student.createdAt ? student.createdAt : startedOn > now ? now : startedOn;
      data.classesStartedAt = clamped;
      data.startConfirmedAt = now;
      data.startConfirmedVia = "admin";
      data.startPromptSnoozedUntil = null;
      patch.cohortStatusStartedOn = clamped.toISOString().slice(0, 10);
      filledStart = clamped.toISOString();
    } else if (status === "ongoing" && startedOn) {
      patch.cohortStatusStartedOn = startedOn.toISOString().slice(0, 10);
    }

    await prisma.student.update({ where: { id: student.id }, data });

    return NextResponse.json({
      ok: true,
      studentId: student.id,
      status,
      batch: resolvedBatch,
      classesStartedAt: filledStart,
    });
  } catch (error) {
    console.error("Failed to resolve cohort status:", error);
    return NextResponse.json({ error: "Unable to save that" }, { status: 500 });
  }
}
