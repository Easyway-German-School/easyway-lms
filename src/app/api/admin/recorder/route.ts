import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";
import { loadDirectory } from "@/lib/recorder-directory";
import { isRecorderEgressId, recorderFleetMode, recordingBackend } from "@/lib/recorder";
import { fallbackPolicy, liveKitMinutes, monthStartUtc } from "@/lib/recording-fallback";
import { loadRecordingForecast } from "@/lib/recording-forecast-server";
import { buildRecorderStatus } from "@/lib/recorder-status";
import { readControl, readSchedulerBeats } from "@/lib/recorder-control";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireCapability("materials");
  if (!gate.ok) return gate.response;

  const now = new Date();
  const tenantId = gate.session.user.tenantId ?? null;
  const rows = await prisma.classRecording.findMany({
    where: { startedAt: { gte: monthStartUtc(now) } },
    select: { egressId: true, durationSeconds: true, startedAt: true, status: true },
  });
  const own = rows.filter((r) => isRecorderEgressId(r.egressId));
  const liveKit = rows.filter((r) => !isRecorderEgressId(r.egressId));

  const fleet = recorderFleetMode();
  const [directory, forecast, beats, control] = await Promise.all([
    fleet ? loadDirectory() : Promise.resolve(null),
    tenantId ? loadRecordingForecast({ tenantId, now, hours: 24 }).catch(() => null) : Promise.resolve(null),
    fleet ? readSchedulerBeats() : Promise.resolve(undefined),
    fleet ? readControl() : Promise.resolve(undefined),
  ]);

  return NextResponse.json(
    buildRecorderStatus({
      mode: recordingBackend(),
      fleet: recorderFleetMode(),
      directory,
      now,
      policy: fallbackPolicy(),
      liveKitMinutesThisMonth: liveKitMinutes(liveKit, now),
      ownRecordings: own.length,
      liveKitRecordings: liveKit.length,
      forecast,
      beats,
      control,
    }),
  );
}
