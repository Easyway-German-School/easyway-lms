import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { finaliseRecording } from "@/lib/class-recorder";
import { EgressStatus } from "livekit-server-sdk";
import { withUnscoped } from "@/lib/tenant/context";

export const dynamic = "force-dynamic";

export const POST = withUnscoped("rescue missing recordings across tenants for debugging", async (request: Request) => {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await prisma.classRecording.findMany({ where: { objectKey: { not: null }, materialId: null } });
  const results: Array<{ egressId: string; outcome: string }> = [];

  for (const row of rows) {
    try {
      const outcome = await finaliseRecording({
        egressId: row.egressId,
        status: EgressStatus.EGRESS_COMPLETE,
        fileResults: [{ filename: row.objectKey ?? undefined }],
      });
      results.push({ egressId: row.egressId, outcome });
    } catch (error) {
      console.error('Error finalising missing recording', row.egressId, error);
      results.push({ egressId: row.egressId, outcome: 'error' });
    }
  }

  return NextResponse.json({ checked: rows.length, results });
});
