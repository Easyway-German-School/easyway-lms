import { NextResponse } from "next/server";

import { requireCapability, scopedBranchIds } from "@/lib/admin-roles";
import {
  loadPipeline,
  previewInvite,
  previewLockedNotice,
  readNextLevelAuto,
  sendInvites,
  sendLockedNotices,
} from "@/lib/next-level-pipeline-server";
import { setBatchAutomatic } from "@/lib/graduation-server";

/**
 * The next-level pipeline.
 *
 *   GET                                  everyone who has just finished or been
 *                                        moved up, with their stage and the
 *                                        details they gave
 *   POST {action:"preview", studentId}   the exact bell text and designed email a
 *                                        student would get, to read before sending
 *   POST {action:"send", studentIds,     send it — bell, push and email together —
 *        includeReminders?}              to those among them whose portal is open,
 *                                        who have not answered, and who have not
 *                                        been messaged yet (reminders only when asked)
 *   POST {action:"setAuto", enabled}     the same single switch as Finished batches: move-up + invite
 *                                        each morning, and this page's hourly send
 *   POST {action:"previewLocked"}        the status notice a locked-portal student gets
 *   POST {action:"sendLocked", studentIds, includeAgain?}
 *                                        send that notice (bell + email, no SMS) to
 *                                        the locked students named; anyone noticed in
 *                                        the last week is left alone
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
    const [pipeline, auto] = await Promise.all([loadPipeline({ where, tenantId }), readNextLevelAuto(tenantId)]);
    return NextResponse.json({ ...pipeline, auto });
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
  if (action !== "send" && action !== "preview" && action !== "setAuto" && action !== "previewLocked" && action !== "sendLocked") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  if (action === "setAuto") {
    const tenantId = gate.session.user.tenantId ?? null;
    if (!tenantId) return NextResponse.json({ error: "No school to switch this on for" }, { status: 400 });
    await setBatchAutomatic(tenantId, body?.enabled === true);
    return NextResponse.json({ auto: await readNextLevelAuto(tenantId) });
  }

  try {
    // Re-derive who exists inside the admin's own fence — the browser only ever
    // names ids, never who is eligible.
    const { where, tenantId } = fence(gate);
    const pipeline = await loadPipeline({ where, tenantId });

    if (action === "previewLocked") {
      const id = typeof body.studentId === "string" ? body.studentId : null;
      return NextResponse.json({ preview: previewLockedNotice(pipeline.rows, id) });
    }

    if (action === "sendLocked") {
      if (!Array.isArray(body.studentIds)) {
        return NextResponse.json({ error: "studentIds required" }, { status: 400 });
      }
      const lockedIds = (body.studentIds as unknown[]).filter((id): id is string => typeof id === "string").slice(0, 300);
      return NextResponse.json(await sendLockedNotices(pipeline.rows, lockedIds, { includeAgain: body.includeAgain === true }));
    }

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
    return NextResponse.json(await sendInvites(pipeline.rows, ids, { includeReminders: body.includeReminders === true }));
  } catch (error) {
    console.error("Next-level admin action failed:", error);
    return NextResponse.json({ error: "Could not complete that" }, { status: 500 });
  }
}
