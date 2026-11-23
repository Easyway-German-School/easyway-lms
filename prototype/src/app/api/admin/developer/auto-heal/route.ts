import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/admin-roles";
import { autoHealStats, PORTAL_RESYNC_PATTERN, setAutoHealPattern } from "@/lib/auto-heal";
import { infraGuardStats, setInfraGuardPattern } from "@/lib/infra-guard";

export const dynamic = "force-dynamic";

/**
 * Stats and kill switches for Mission Control's automatic repairs. GET is
 * the Patterns tab's live numbers for BOTH patterns; PATCH is each one's
 * toggle, picked by `?pattern=`. Both behind `security` like the rest of
 * the developer console.
 */
export async function GET() {
  const gate = await requireCapability("security");
  if (!gate.ok) return gate.response;
  const [portalResync, infraGuard] = await Promise.all([autoHealStats(), infraGuardStats()]);
  return NextResponse.json({ stats: portalResync, infraGuard });
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

  const which = new URL(request.url).searchParams.get("pattern");
  const applied =
    which === "infra-guard"
      ? await setInfraGuardPattern(patch, gate.session.user.id as string)
      : await setAutoHealPattern(PORTAL_RESYNC_PATTERN, patch, gate.session.user.id as string);
  if (!applied) return NextResponse.json({ error: "Unknown pattern" }, { status: 404 });

  const [portalResync, infraGuard] = await Promise.all([autoHealStats(), infraGuardStats()]);
  return NextResponse.json({ stats: portalResync, infraGuard });
}
