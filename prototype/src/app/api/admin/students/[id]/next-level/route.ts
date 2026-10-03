import { NextResponse } from "next/server";

import { requireCapability, scopedBranchIds } from "@/lib/admin-roles";
import { prisma, unguardedPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/prisma-guard";
import { applyMoveUp, previewMoveUp } from "@/lib/next-level-manual-server";

/**
 * The Graduate dialog on the Students table.
 *
 *   GET                                        what the dialog shows: the student,
 *                                              their next level, price, opening day
 *                                              and what is on file
 *   POST {mode:"invite"|"move", details, notify}  do it — only ever called from the
 *                                              dialog's confirmation step
 *
 * A click on "Graduate" used to flip the student's status in one request. Now
 * nothing changes until POST, and POST is only sent after the admin has read a
 * summary of exactly what will happen.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Gate = Extract<Awaited<ReturnType<typeof requireCapability>>, { ok: true }>;

/** The admin may only touch students inside their own tenant and branches. */
async function inScope(gate: Gate, studentId: string): Promise<boolean> {
  const tenantId = gate.session.user.tenantId ?? null;
  const where: Record<string, unknown> = { id: studentId };
  if (tenantId) where.OR = [{ tenantId }, { branch: { tenantId } }, { user: { tenantId } }];
  const allowed = scopedBranchIds(gate.admin);
  if (allowed) where.branchId = { in: allowed };
  const found = await prisma.student.findFirst({ where: where as never, select: { id: true } });
  return Boolean(found);
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!(await inScope(gate, id))) return NextResponse.json({ error: "Student not found" }, { status: 404 });

  try {
    const preview = await previewMoveUp(id);
    if (!preview) return NextResponse.json({ error: "Student not found" }, { status: 404 });
    return NextResponse.json({ preview });
  } catch (error) {
    console.error("Move-up preview failed:", error);
    return NextResponse.json({ error: "Could not load this student" }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!(await inScope(gate, id))) return NextResponse.json({ error: "Student not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const mode = body?.mode === "move" ? "move" : body?.mode === "invite" ? "invite" : null;
  if (!mode) return NextResponse.json({ error: "Choose invite or move" }, { status: 400 });

  try {
    const result = await applyMoveUp(id, { mode, details: body?.details, notify: body?.notify !== false });
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });

    await writeAudit(unguardedPrisma, {
      action: mode === "move" ? "student.next_level_move" : "student.next_level_invite",
      model: "Student",
      recordId: id,
      severity: "notice",
      summary:
        mode === "move"
          ? `Moved up to ${result.targetLevel} by hand from the Students table`
          : `Invited to ${result.targetLevel} by hand from the Students table`,
    }).catch((error) => console.error("next-level audit write failed", error));

    return NextResponse.json(result);
  } catch (error) {
    console.error("Move-up failed:", error);
    return NextResponse.json({ error: "Something went wrong — nothing was half-applied that a retry won't fix" }, { status: 500 });
  }
}
