import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { finaliseRecording } from "@/lib/class-recorder";
import { egressClient } from "@/lib/recording";
import { EgressStatus } from "livekit-server-sdk";
import { withUnscoped } from "@/lib/tenant/context";

export const dynamic = "force-dynamic";

/**
 * Rescue a row stuck without a Material row — but ask LiveKit what actually
 * happened rather than assuming success.
 *
 * This used to finalise every match with `status: EGRESS_COMPLETE` hardcoded,
 * regardless of what the row's own `status` field already said. A row already
 * marked "failed" or "aborted" got a second pass through here that forced it
 * to look successful and created a Material row pointing at a file that was
 * never written. `reconcileRecordings()` had the identical bug; both are now
 * fixed the same way — ask LiveKit for the real, current status and let
 * `finaliseRecording`'s own object-existence check have the final word.
 */
export const POST = withUnscoped("rescue missing recordings across tenants for debugging", async (request: Request) => {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const client = egressClient();
  if (!client) return NextResponse.json({ error: "LiveKit is not configured" }, { status: 503 });

  const rows = await prisma.classRecording.findMany({ where: { objectKey: { not: null }, materialId: null } });
  const results: Array<{ egressId: string; outcome: string }> = [];

  for (const row of rows) {
    try {
      const [info] = await client.listEgress({ egressId: row.egressId });
      if (!info) {
        results.push({ egressId: row.egressId, outcome: "unknown-to-livekit" });
        continue;
      }
      const outcome = await finaliseRecording({
        egressId: row.egressId,
        status: info.status,
        error: info.error,
        fileResults: info.fileResults,
      });
      results.push({ egressId: row.egressId, outcome });
    } catch (error) {
      console.error('Error finalising missing recording', row.egressId, error);
      results.push({ egressId: row.egressId, outcome: 'error' });
    }
  }

  return NextResponse.json({ checked: rows.length, results });
});
