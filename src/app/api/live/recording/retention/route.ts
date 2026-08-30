import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { applyRetention, planRetention, RETENTION } from "@/lib/retention";

export const dynamic = "force-dynamic";

async function authorise(request: Request): Promise<Response | null> {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization");
  if (secret && provided === `Bearer ${secret}`) return null;

  const gate = await requireCapability("materials");
  return gate.ok ? null : gate.response;
}

/**
 * What retention would reclaim, and why. Reads only.
 *
 * Safe to open in a browser and safe to leave on a dashboard: nothing here
 * deletes anything, and every verdict carries the sentence that justifies it.
 */
export async function GET(request: Request) {
  const denied = await authorise(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const olderThanRaw = url.searchParams.get("olderThanDays");
  const olderThanDays = olderThanRaw != null && Number.isFinite(Number(olderThanRaw)) ? Number(olderThanRaw) : undefined;

  const plan = await planRetention({ olderThanDays });
  return NextResponse.json({
    ok: true,
    policy: RETENTION,
    // With no ?olderThanDays this is 0 — staff keep every recording forever,
    // and a purge only ever happens when an admin names an age cutoff.
    olderThanDays: olderThanDays ?? null,
    reclaimable: plan.reclaimable,
    bytesReclaimable: plan.bytesReclaimable,
    verdicts: plan.verdicts,
  });
}

/**
 * Actually reclaim — a deliberate, manual purge.
 *
 * Requires BOTH `{"confirm": true}` and `{"olderThanDays": N}` in the body.
 * Nothing is scheduled and there is no age-based auto-deletion any more: staff
 * keep every recording forever, so a purge only happens when an admin names a
 * cutoff and confirms it in the same request. Without `olderThanDays` this
 * reclaims nothing, whatever `confirm` says.
 */
export async function POST(request: Request) {
  const denied = await authorise(request);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { confirm?: boolean; olderThanDays?: number };
  const olderThanDays =
    typeof body.olderThanDays === "number" && Number.isFinite(body.olderThanDays) && body.olderThanDays > 0
      ? body.olderThanDays
      : undefined;
  const result = await applyRetention({ dryRun: body.confirm !== true, olderThanDays });

  return NextResponse.json({ ok: true, ...result });
}

// Long-running: model calls / bulk work. Set here (not vercel.json) so it
// travels with the route regardless of where the app is built from.
export const maxDuration = 60;
