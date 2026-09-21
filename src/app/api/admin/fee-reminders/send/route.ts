import { NextRequest, NextResponse } from "next/server";
import { requireCapability, scopedBranchIds } from "@/lib/admin-roles";
import { CHASE_CATEGORIES, type ChaseCategory } from "@/lib/finance/receivables";
import type { RosterFilters } from "@/lib/student-roster-query";
import {
  CHUNK_MAX,
  resolveChaseAudience,
  sendChaseChunk,
  validateChaseNote,
} from "@/lib/fee-chase-send";

export const dynamic = "force-dynamic";
// A chunk messages up to CHUNK_MAX students one by one and then flushes their emails.
export const maxDuration = 60;

/**
 * The mass fee reminder, in two calls the Reminders tab makes in order:
 *
 *   { action: "audience", ... }  who WOULD be reached — nothing is sent.
 *   { action: "send", ... }      one chunk of them, up to CHUNK_MAX students.
 *
 * `payments` capability: this messages students about money, on behalf of the
 * school, in bulk. See lib/fee-chase-send.ts for why it is chunked.
 */

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
  "focus",
  "agingBucket",
  "ids",
  "tag",
  "year",
] as const;

/** Only known keys, only strings — never pass a request body into a query builder as-is. */
function filtersFrom(value: unknown): RosterFilters {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const out: RosterFilters = {};
  for (const key of FILTER_KEYS) {
    const v = raw[key];
    if (typeof v === "string" && v.trim()) out[key] = v.trim();
  }
  return out;
}

function categoryFrom(value: unknown): ChaseCategory | null {
  return typeof value === "string" && (CHASE_CATEGORIES as readonly string[]).includes(value)
    ? (value as ChaseCategory)
    : null;
}

export async function POST(request: NextRequest) {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const ctx = {
    tenantId: gate.session.user.tenantId,
    allowedBranchIds: scopedBranchIds(gate.admin),
  };
  const category = categoryFrom(body.category);
  const skipRecent = body.skipRecent !== false;

  if (body.action === "audience") {
    const audience = await resolveChaseAudience(
      {
        filters: filtersFrom(body.filters),
        category,
        includeAwaitingBatch: body.includeAwaitingBatch === true,
        skipRecent,
      },
      ctx,
    );
    return NextResponse.json({ ...audience, chunkSize: CHUNK_MAX });
  }

  if (body.action === "send") {
    const studentIds = Array.isArray(body.studentIds)
      ? body.studentIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    if (studentIds.length === 0) return NextResponse.json({ error: "No students to send to" }, { status: 400 });
    if (studentIds.length > CHUNK_MAX) {
      return NextResponse.json({ error: `Send at most ${CHUNK_MAX} at a time` }, { status: 400 });
    }

    const note = validateChaseNote(body.note);
    if (!note.ok) return NextResponse.json({ error: note.error }, { status: 400 });

    const result = await sendChaseChunk(
      { studentIds, email: body.email === true, note: note.note, skipRecent, category },
      ctx,
    );
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
