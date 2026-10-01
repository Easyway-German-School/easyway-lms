import { NextResponse } from "next/server";

import { requireCapability, scopedBranchIds } from "@/lib/admin-roles";
import { loadPipeline, nudgeStudents } from "@/lib/next-level-pipeline-server";

/**
 * The next-level pipeline.
 *
 *   GET                                  everyone who has just finished or been
 *                                        moved up, with their stage and the
 *                                        details they gave
 *   POST {action:"nudge", studentIds}    Becca reminds those who have not kept
 *                                        a seat yet (one a day each)
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
  if (body?.action !== "nudge" || !Array.isArray(body?.studentIds)) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  const ids = (body.studentIds as unknown[]).filter((id): id is string => typeof id === "string").slice(0, MAX_NUDGES);

  try {
    // Re-derive who is eligible inside the admin's own fence — the browser
    // only ever names ids.
    const { where, tenantId } = fence(gate);
    const pipeline = await loadPipeline({ where, tenantId });
    return NextResponse.json(await nudgeStudents(pipeline.rows, ids));
  } catch (error) {
    console.error("Next-level nudge failed:", error);
    return NextResponse.json({ error: "Could not send the reminders" }, { status: 500 });
  }
}
