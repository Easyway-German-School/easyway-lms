import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-roles";
import { readGrowthAiSettings, writeGrowthAiSettings } from "@/lib/growth/ai-settings";

export const dynamic = "force-dynamic";

/**
 * GET/PATCH — the Growth Desk AI switch. Super admin only, by explicit
 * request: this is a cost-bearing feature that reads real lead data
 * through a third party, which is a different kind of decision than
 * anything else a `growth` capability holder can already do.
 */
function requireSuper(adminRole: string | undefined) {
  return adminRole === "super";
}

export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  if (!requireSuper(gate.admin.adminRole)) {
    return NextResponse.json({ error: "Only the super admin can read this" }, { status: 403 });
  }

  const settings = await readGrowthAiSettings(gate.session.user.tenantId);
  const keyConfigured = Boolean(process.env.ANTHROPIC_API_KEY) && !process.env.ANTHROPIC_API_KEY?.startsWith("sk-placeholder");
  return NextResponse.json({ ...settings, keyConfigured });
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;
  if (!requireSuper(gate.admin.adminRole)) {
    return NextResponse.json({ error: "Only the super admin can change this" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const { enabled } = (body || {}) as Record<string, unknown>;
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be true or false" }, { status: 400 });
  }
  if (!gate.session.user.tenantId) {
    return NextResponse.json({ error: "No tenant on this account" }, { status: 400 });
  }

  const settings = await writeGrowthAiSettings(gate.session.user.tenantId, enabled, { name: gate.admin.email });
  const keyConfigured = Boolean(process.env.ANTHROPIC_API_KEY) && !process.env.ANTHROPIC_API_KEY?.startsWith("sk-placeholder");
  return NextResponse.json({ ...settings, keyConfigured });
}
