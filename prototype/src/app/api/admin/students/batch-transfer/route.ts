import { NextResponse } from "next/server";

import { requireCapability, scopedBranchIds } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";
import { MONTH_NAMES } from "@/lib/batch";
import {
  cancelBatchTransfers,
  parseBatchDestination,
  scheduleBatchTransfers,
  type BatchDestination,
} from "@/lib/batch-transfer";
import { readCurrentIntake } from "@/lib/intake-server";
import { buildRosterWhereClause, parseRosterFilters } from "@/lib/student-roster-query";

/**
 * Move students to another batch - from the Students page.
 *
 *   GET   the destination choices (and the school's current intake, to default to)
 *   POST  { studentIds | filters, month, year }   schedule the move; it takes
 *                                                 effect as soon as each student's
 *                                                 tuition deposit has cleared
 *   POST  { action: "cancel", studentIds | filters }   drop a scheduled move
 *
 * What "moves" a student, and why it waits for payment, is in
 * src/lib/batch-transfer.ts. This file is only the doorway: who may do it, and
 * which students the request means.
 */

export const dynamic = "force-dynamic";
// Each activation re-points the tutor, the student ID and the enrolment history.
export const maxDuration = 60;

/** One request moves at most this many, so it finishes inside maxDuration. */
const MAX_PER_REQUEST = 400;

const FILTER_KEYS = [
  "branchId",
  "level",
  "batch",
  "classType",
  "sessionSlot",
  "status",
  "paymentStatus",
  "tutorId",
  "search",
  "year",
] as const;

export async function GET() {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const now = new Date();
  const currentIntake = await readCurrentIntake(gate.session.user.tenantId ?? null);
  const nowAbsolute = now.getFullYear() * 12 + now.getMonth();

  // From this month, so a batch that is already under way is still a valid
  // destination for somebody who paid late; 18 months ahead is further than the
  // office ever schedules.
  const options = Array.from({ length: 19 }, (_, offset) => {
    const absolute = nowAbsolute + offset;
    const year = Math.floor(absolute / 12);
    const month = MONTH_NAMES[absolute % 12];
    return { month, year, label: `${month} ${year}` };
  });

  return NextResponse.json({ options, currentIntake });
}

export async function POST(request: Request) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => ({}));
  const cancel = body?.action === "cancel";

  const ids: string[] = Array.isArray(body.studentIds)
    ? (body.studentIds as unknown[]).filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];
  const rawFilters = body.filters && typeof body.filters === "object" ? (body.filters as Record<string, unknown>) : null;

  if (ids.length === 0 && !rawFilters) {
    return NextResponse.json({ error: "Select at least one student." }, { status: 400 });
  }

  let destination: BatchDestination | null = null;
  if (!cancel) {
    const parsed = parseBatchDestination(body.month, body.year);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    destination = parsed.destination;
  }

  // The same fence the Students list applies: this tenant, and - for an admin
  // restricted to particular branches - only those branches.
  const search = new URLSearchParams();
  if (rawFilters) {
    for (const key of FILTER_KEYS) {
      const value = rawFilters[key];
      if (typeof value === "string" && value.trim()) search.set(key, value.trim());
    }
  }
  const where = buildRosterWhereClause(parseRosterFilters(new URL(`http://x/?${search.toString()}`)), {
    tenantId: gate.session.user.tenantId,
    allowedBranchIds: scopedBranchIds(gate.admin),
  });
  if (ids.length > 0) where.id = { in: ids.slice(0, 2000) };

  try {
    const total = await prisma.student.count({ where });
    if (total === 0) {
      return NextResponse.json({ error: "No students matched - nothing was changed." }, { status: 404 });
    }
    if (total > MAX_PER_REQUEST) {
      return NextResponse.json(
        {
          error: `${total} students match - move at most ${MAX_PER_REQUEST} at a time. Narrow it by branch, level or session first.`,
        },
        { status: 400 },
      );
    }

    const targets = await prisma.student.findMany({
      where,
      select: { id: true, admission: true, createdAt: true },
      orderBy: { createdAt: "asc" },
      take: MAX_PER_REQUEST,
    });

    if (cancel) {
      const cancelled = await cancelBatchTransfers(targets);
      return NextResponse.json({ ok: true, cancelled, skipped: ids.length ? ids.length - targets.length : 0 });
    }

    if (!destination) return NextResponse.json({ error: "Choose a destination batch." }, { status: 400 });
    const summary = await scheduleBatchTransfers(targets, destination, gate.session.user.id ?? null);
    return NextResponse.json({
      ok: true,
      ...summary,
      matched: targets.length,
      skipped: ids.length ? ids.length - targets.length : 0,
      batch: destination.month,
      batchYear: destination.year,
    });
  } catch (error) {
    console.error("Batch transfer request failed:", error);
    return NextResponse.json({ error: "Unable to move those students." }, { status: 500 });
  }
}
