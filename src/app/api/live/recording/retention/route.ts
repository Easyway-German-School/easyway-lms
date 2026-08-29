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

  const plan = await planRetention();
  return NextResponse.json({
    ok: true,
    policy: RETENTION,
    reclaimable: plan.reclaimable,
    bytesReclaimable: plan.bytesReclaimable,
    verdicts: plan.verdicts,
  });
}

/**
 * Actually reclaim.
 *
 * Requires `{"confirm": true}` in the body. A scheduled job has to state its
 * intent in the same words a person would, which means nobody ever deletes a
 * term's teaching because a cron was pointed at the wrong endpoint.
 */
export async function POST(request: Request) {
  const denied = await authorise(request);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { confirm?: boolean };
  const result = await applyRetention({ dryRun: body.confirm !== true });

  return NextResponse.json({ ok: true, ...result });
}

// Long-running: model calls / bulk work. Set here (not vercel.json) so it
// travels with the route regardless of where the app is built from.
export const maxDuration = 60;
