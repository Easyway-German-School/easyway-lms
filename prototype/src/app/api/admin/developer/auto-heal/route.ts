import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/admin-roles";
import { autoHealStats, PORTAL_RESYNC_PATTERN, setAutoHealPattern } from "@/lib/auto-heal";

export const dynamic = "force-dynamic";

/**
 * Stats and kill switch for Mission Control's one fully-automatic repair.
 * GET is the Patterns tab's live numbers; PATCH is the toggle — both behind
 * `security` like the rest of the developer console.
 */
export async function GET() {
  const gate = await requireCapability("security");
  if (!gate.ok) return gate.response;
  return NextResponse.json({ stats: await autoHealStats() });
}

export async function PATCH(request: Request) {
  const gate = await requireCapability("security");
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => ({}))) as { enabled?: unknown; dryRun?: unknown };
  const patch: { enabled?: boolean; dryRun?: boolean } = {};
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (typeof body.dryRun === "boolean") patch.dryRun = body.dryRun;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to change — pass enabled and/or dryRun as booleans" }, { status: 400 });
  }

  const applied = await setAutoHealPattern(PORTAL_RESYNC_PATTERN, patch, gate.session.user.id as string);
  if (!applied) return NextResponse.json({ error: "Unknown pattern" }, { status: 404 });
  return NextResponse.json({ stats: await autoHealStats() });
}
