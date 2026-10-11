import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { normalizeGrowthTitle } from "@/lib/growth/titles";
import { readGrowthQuotaSettings, writeGrowthQuotaSettings } from "@/lib/growth/quota-settings";

export const dynamic = "force-dynamic";

/**
 * GET/PATCH — the daily quota every rep's momentum ring on Today is drawn
 * against. Anyone on the desk can read it (they need to see their own
 * target); only the Sales & Marketing Teamlead can change it, same split
 * as auto-assign next door.
 */
export async function GET() {
  const gate = await requireCapability("growth");
  if (!gate.ok) return gate.response;

  const settings = await readGrowthQuotaSettings(gate.session.user.tenantId);
  return NextResponse.json(settings);
}

export async function PATCH(req: NextRequest) {
  const gate = await requireCapability("growth");
  if (!gate.ok) return gate.response;

  const user = await prisma.user.findUnique({ where: { id: gate.admin.userId }, select: { growthTitle: true } });
  if (normalizeGrowthTitle(user?.growthTitle) !== "sales_lead") {
    return NextResponse.json({ error: "Only the Sales & Marketing Teamlead can change this" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const { count } = (body || {}) as Record<string, unknown>;
  if (count !== null && (typeof count !== "number" || !Number.isFinite(count) || count <= 0)) {
    return NextResponse.json({ error: "count must be a positive number, or null to clear the quota" }, { status: 400 });
  }
  if (!gate.session.user.tenantId) {
    return NextResponse.json({ error: "No tenant on this account" }, { status: 400 });
  }

  const settings = await writeGrowthQuotaSettings(gate.session.user.tenantId, count, { name: gate.admin.email });
  return NextResponse.json(settings);
}
