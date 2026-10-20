import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { normalizeGrowthTitle } from "@/lib/growth/titles";
import { readGrowthAutoAssignSettings, writeGrowthAutoAssignSettings } from "@/lib/growth/auto-assign-settings";

export const dynamic = "force-dynamic";

/**
 * GET/PATCH — the auto-assign switch, and how many leads are sitting
 * unassigned right now (only non-zero once the switch has been off for a
 * while, or there's simply nobody on the Growth Desk yet).
 *
 * Unlike the AI switch next door, this is the Sales & Marketing Teamlead's
 * own operational tool, not a cost-bearing third-party call a super admin
 * has to sign off on — so the gate is the `sales_lead` title, not `super`.
 */
async function requireSalesLead() {
  const gate = await requireCapability("growth");
  if (!gate.ok) return { ok: false as const, response: gate.response };

  const user = await prisma.user.findUnique({ where: { id: gate.admin.userId }, select: { growthTitle: true } });
  if (normalizeGrowthTitle(user?.growthTitle) !== "sales_lead") {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Only the Sales & Marketing Teamlead can change this" }, { status: 403 }),
    };
  }
  return { ok: true as const, admin: gate.admin, session: gate.session };
}

export async function GET() {
  const gate = await requireCapability("growth");
  if (!gate.ok) return gate.response;

  const settings = await readGrowthAutoAssignSettings(gate.session.user.tenantId);
  const unassigned = await prisma.lead.count({
    where: { assignedToId: null, status: { notIn: ["converted", "lost", "dropped"] } },
  });
  return NextResponse.json({ ...settings, unassigned });
}

export async function PATCH(req: NextRequest) {
  const gate = await requireSalesLead();
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => null);
  const { enabled } = (body || {}) as Record<string, unknown>;
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be true or false" }, { status: 400 });
  }
  if (!gate.session.user.tenantId) {
    return NextResponse.json({ error: "No tenant on this account" }, { status: 400 });
  }

  const settings = await writeGrowthAutoAssignSettings(gate.session.user.tenantId, enabled, {
    name: gate.admin.email,
  });
  const unassigned = await prisma.lead.count({
    where: { assignedToId: null, status: { notIn: ["converted", "lost", "dropped"] } },
  });
  return NextResponse.json({ ...settings, unassigned });
}
