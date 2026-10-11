import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-roles";
import { isOverdue } from "@/lib/growth/fund-requests";

export const dynamic = "force-dynamic";

/**
 * PATCH — approve or reject. This is the handbook's escalation rule encoded
 * directly as an authorization check, not just a UI label:
 *   - the Chief Operating Officer (`super`) can decide any request, any time.
 *   - the Accountant can only decide one that has already sat unanswered
 *     past the 1-hour window — "approval can be made through discretion"
 *     once a request is genuinely stuck, never before.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const existing = await prisma.fundRequest.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Request not found" }, { status: 404 });

  const isCoo = gate.admin.adminRole === "super";
  const isAccountantEscalation = gate.admin.adminRole === "accountant" && isOverdue(existing);
  if (!isCoo && !isAccountantEscalation) {
    return NextResponse.json(
      { error: "Only the COO can decide this, unless it has passed the 1-hour window unanswered" },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null);
  const { decision, note } = (body || {}) as Record<string, unknown>;
  if (decision !== "approved" && decision !== "rejected") {
    return NextResponse.json({ error: 'decision must be "approved" or "rejected"' }, { status: 400 });
  }

  await prisma.fundRequest.update({
    where: { id },
    data: {
      status: decision,
      approvedById: gate.admin.userId,
      approvedAt: new Date(),
      decisionNote: typeof note === "string" ? note.trim() || null : null,
    },
  });

  return NextResponse.json({ ok: true });
}
