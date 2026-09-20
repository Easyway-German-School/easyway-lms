import { NextResponse } from "next/server";

import { requireCapability, scopedBranchIds } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";
import { batchFromAdmission, monthNameToIndex, MONTH_NAMES } from "@/lib/batch";
import { resolveUpcomingBatch } from "@/lib/batch-reservation";
import { loadUpcomingBatchRows, summariseIntakes } from "@/lib/batch-reservation-server";
import { sendManualSeatNudges } from "@/lib/seat-nudges";
import { rankNameMatches } from "@/lib/student-name-match";

/**
 * The upcoming-intake console: who is waiting for a batch that has not opened,
 * what each has paid, and the tools to place more learners into it.
 *
 *   GET                       the waiting learners + a summary per intake
 *   POST {action:"match"}     turn a pasted list of names into candidate learners
 *   POST {action:"assign"}    move learners into an intake month (their portal
 *                             then waits behind the countdown on its own)
 *   POST {action:"nudge"}     Becca messages the chosen learners now
 *
 * Assigning only rewrites `admission.batch`, the same single JSON key the
 * cohort console rewrites, so it is reversible from /admin/cohorts and lands in
 * the audit trail like any other student edit.
 */

export const dynamic = "force-dynamic";

const MAX_NAMES = 60;
const MAX_ASSIGN = 200;

function tenantWhere(tenantId: string | null | undefined) {
  if (!tenantId) return {};
  return { OR: [{ tenantId }, { branch: { tenantId } }, { user: { tenantId } }] };
}

type Gate = Extract<Awaited<ReturnType<typeof requireCapability>>, { ok: true }>;

function fence(gate: Gate) {
  const where: Record<string, unknown> = { ...tenantWhere(gate.session.user.tenantId ?? null) };
  const allowedBranchIds = scopedBranchIds(gate.admin);
  if (allowedBranchIds) where.branchId = { in: allowedBranchIds };
  return where;
}

function idList(value: unknown, cap: number): string[] {
  return Array.isArray(value)
    ? (value as unknown[]).filter((id): id is string => typeof id === "string" && id.trim().length > 0).slice(0, cap)
    : [];
}

export async function GET() {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  try {
    const rows = await loadUpcomingBatchRows({ where: fence(gate) });

    // When Becca last messaged each learner about their seat.
    const nudges = rows.length
      ? await prisma.notification.findMany({
          where: {
            studentId: { in: rows.map((row) => row.studentId) },
            dedupeKey: { startsWith: "seat-" },
          },
          select: { studentId: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        })
      : [];
    const lastNudge = new Map<string, { at: Date; count: number }>();
    for (const nudge of nudges) {
      if (!nudge.studentId) continue;
      const seen = lastNudge.get(nudge.studentId);
      if (seen) seen.count += 1;
      else lastNudge.set(nudge.studentId, { at: nudge.createdAt, count: 1 });
    }

    return NextResponse.json({
      intakes: summariseIntakes(rows),
      rows: rows.map((row) => ({
        ...row,
        lastNudgedAt: lastNudge.get(row.studentId)?.at.toISOString() ?? null,
        nudgeCount: lastNudge.get(row.studentId)?.count ?? 0,
      })),
    });
  } catch (error) {
    console.error("Failed to load upcoming intake:", error);
    return NextResponse.json({ error: "Unable to load the upcoming intake" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "";

  try {
    if (action === "match") {
      const names: string[] = Array.isArray(body.names)
        ? (body.names as unknown[])
            .filter((n): n is string => typeof n === "string")
            .map((n) => n.replace(/^[\s~*•\-–]+/, "").trim())
            .filter(Boolean)
            .slice(0, MAX_NAMES)
        : [];
      if (names.length === 0) return NextResponse.json({ error: "Paste at least one name" }, { status: 400 });

      const pool = await prisma.student.findMany({
        where: { status: "active", ...fence(gate) },
        select: {
          id: true,
          level: true,
          classesStartedAt: true,
          admission: true,
          branch: { select: { name: true } },
          user: { select: { name: true, email: true } },
        },
        take: 5000,
      });

      const results = names.map((query) => ({
        query,
        candidates: rankNameMatches(query, pool, (s) => s.user?.name ?? "", 4).map(({ item, score }) => ({
          studentId: item.id,
          name: item.user?.name ?? "Unnamed",
          email: item.user?.email ?? "",
          branch: item.branch?.name ?? "Unassigned",
          level: item.level,
          currentBatch: batchFromAdmission(item.admission),
          alreadyInClass: Boolean(item.classesStartedAt && item.classesStartedAt.getTime() <= Date.now()),
          score: Math.round(score * 100) / 100,
        })),
      }));
      return NextResponse.json({ results });
    }

    if (action === "assign") {
      const ids = idList(body.studentIds, MAX_ASSIGN);
      const monthIndex = monthNameToIndex(typeof body.month === "string" ? body.month : "");
      if (ids.length === 0) return NextResponse.json({ error: "Choose at least one learner" }, { status: 400 });
      if (monthIndex === null) return NextResponse.json({ error: "Give a real month name" }, { status: 400 });
      const month = MONTH_NAMES[monthIndex];

      const targets = await prisma.student.findMany({
        where: { id: { in: ids }, ...fence(gate) },
        select: { id: true, createdAt: true, classesStartedAt: true, admission: true, user: { select: { name: true } } },
      });

      const notLocked: string[] = [];
      let updated = 0;
      let locked = 0;
      for (const student of targets) {
        const admission =
          student.admission && typeof student.admission === "object" ? (student.admission as Record<string, unknown>) : {};
        if (admission.batch !== month) {
          await prisma.student.update({
            where: { id: student.id },
            data: { admission: { ...admission, batch: month } },
          });
          updated += 1;
        }
        // A confirmed, past first day means classes already began for them — the
        // batch label will not lock them. Say so instead of implying it did.
        const upcoming = resolveUpcomingBatch(month, {
          registeredAt: student.createdAt,
          classesStartedAt: student.classesStartedAt,
        });
        if (upcoming) locked += 1;
        else notLocked.push(student.user?.name ?? student.id);
      }

      return NextResponse.json({ ok: true, month, updated, locked, notLocked });
    }

    if (action === "nudge") {
      const ids = idList(body.studentIds, MAX_ASSIGN);
      if (ids.length === 0) return NextResponse.json({ error: "Choose at least one learner" }, { status: 400 });
      // Re-fence: only learners this admin may see can be messaged.
      const allowed = await prisma.student.findMany({ where: { id: { in: ids }, ...fence(gate) }, select: { id: true } });
      const result = await sendManualSeatNudges(allowed.map((s) => s.id));
      return NextResponse.json({ ok: true, ...result });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Upcoming intake action failed:", error);
    return NextResponse.json({ error: "That did not work — please try again" }, { status: 500 });
  }
}
