import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { reconcileRecordings } from "@/lib/class-recorder";
import { maybeUnscoped } from "@/lib/tenant/context";

export const dynamic = "force-dynamic";

/**
 * Finish any recording the webhook did not.
 *
 * Two callers, which is why there are two ways in:
 *
 *   - a scheduled job, authenticated with CRON_SECRET, running every few
 *     minutes so a lost webhook costs a short delay rather than a lost class;
 *   - an admin pressing a button, when someone is standing there asking why
 *     yesterday's class is not on the shelf.
 *
 * Safe to call as often as you like: it only looks at captures still marked
 * active, and `finaliseRecording` is idempotent.
 */
async function authorise(request: Request): Promise<Response | null> {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization");
  if (secret && provided === `Bearer ${secret}`) return null;

  const gate = await requireCapability("materials");
  return gate.ok ? null : gate.response;
}

export async function POST(request: Request) {
  const denied = await authorise(request);
  if (denied) return denied;

  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization");
  const isCron = secret && provided === `Bearer ${secret}`;
  console.log("[RECONCILE POST] secret set?", Boolean(secret), "provided", provided, "isCron", isCron);

  try {
    const result = await maybeUnscoped(
      Boolean(isCron),
      "recording reconcile runs across every tenant",
      reconcileRecordings,
    );
    console.log("[RECONCILE POST] result", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Recording reconcile failed", error);
    return NextResponse.json({ error: "Reconcile failed" }, { status: 500 });
  }
}

/** GET is allowed so a cron provider that only issues GETs can drive it too. */
export async function GET(request: Request) {
  return POST(request);
}
