import { NextResponse } from "next/server";

import { requireCapability, scopedBranchIds } from "@/lib/admin-roles";
import { loadPipeline, previewInvite, sendInvites } from "@/lib/next-level-pipeline-server";

/**
 * The next-level pipeline.
 *
 *   GET                                  everyone who has just finished or been
 *                                        moved up, with their stage and the
 *                                        details they gave
 *   POST {action:"preview", studentId}   the exact bell text and designed email a
 *                                        student would get, to read before sending
 *   POST {action:"send", studentIds}     send it — bell, push and email together —
 *                                        to those among them whose portal is open
 *                                        and who have not answered yet
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_NUDGES = 150;

function fence(gate: Extract<Awaited<ReturnType<typeof requireCapability>>, { ok: true }>) {
  const tenantId = gate.session.user.tenantId ?? null;
  const where: Record<string, unknown> = tenantId
    ? { OR: [{ tenantId }, { branch: { tenantId } }, { user: { tenantId } }] }
    : {};
  const allowed = scopedBranchIds(gate.admin);
  if (allowed) where.branchId = { in: allowed };
  return { where, tenantId };
}

export async function GET() {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;
  try {
    const { where, tenantId } = fence(gate);
    return NextResponse.json(await loadPipeline({ where, tenantId }));
  } catch (error) {
    console.error("Next-level pipeline failed to load:", error);
    return NextResponse.json({ error: "Unable to load the next-level pipeline" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => ({}));
  const action = body?.action;
  if (action !== "send" && action !== "preview") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  try {
    // Re-derive who exists inside the admin's own fence — the browser only ever
    // names ids, never who is eligible.
    const { where, tenantId } = fence(gate);
    const pipeline = await loadPipeline({ where, tenantId });

    if (action === "preview") {
      const id = typeof body.studentId === "string" ? body.studentId : null;
      const row = (id ? pipeline.rows.find((r) => r.studentId === id) : null) ?? pipeline.rows.find((r) => r.eligible);
      if (!row) return NextResponse.json({ preview: null });
      return NextResponse.json({ preview: await previewInvite(row.studentId) });
    }

    if (!Array.isArray(body.studentIds)) {
      return NextResponse.json({ error: "studentIds required" }, { status: 400 });
    }
    const ids = (body.studentIds as unknown[]).filter((id): id is string => typeof id === "string").slice(0, MAX_NUDGES);
    return NextResponse.json(await sendInvites(pipeline.rows, ids));
  } catch (error) {
    console.error("Next-level admin action failed:", error);
    return NextResponse.json({ error: "Could not complete that" }, { status: 500 });
  }
}
