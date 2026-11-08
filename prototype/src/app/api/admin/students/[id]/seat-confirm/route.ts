import { NextResponse } from "next/server";
import { requireCapability, scopedBranchIds } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";
import { askSeatBatchConfirmation } from "@/lib/seat-batch-confirm";

export const dynamic = "force-dynamic";

/**
 * "Ask them to confirm their seat" — the office button for a student whose
 * held batch looks implausibly far out. One student at a time, by hand;
 * never a bulk scan. See lib/seat-batch-confirm.ts.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const tenantId = gate.session.user.tenantId ?? null;
  const where: Record<string, unknown> = { id };
  if (tenantId) where.OR = [{ tenantId }, { branch: { tenantId } }, { user: { tenantId } }];
  const allowed = scopedBranchIds(gate.admin);
  if (allowed) where.branchId = { in: allowed };
  const found = await prisma.student.findFirst({ where: where as never, select: { id: true } });
  if (!found) return NextResponse.json({ error: "Student not found" }, { status: 404 });

  const record = await askSeatBatchConfirmation(id);
  if (!record) {
    return NextResponse.json(
      { error: "Nothing to ask — either already pending, or this student's batch has no year on it to question." },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, record });
}
