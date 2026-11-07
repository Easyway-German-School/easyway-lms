import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/admin-roles";
import { prisma } from "@/lib/prisma";
import { loadDirectory, probeDirectory } from "@/lib/recorder-directory";
import { recordingObjectStorage } from "@/lib/storage";
import { isRecorderEgressId, recorderAppBase, recorderFleetMode, recorderSecret, recorderSelected, recordingBackend } from "@/lib/recorder";
import { fallbackPolicy, liveKitMinutes, monthStartUtc } from "@/lib/recording-fallback";
import { loadRecordingForecast } from "@/lib/recording-forecast-server";
import { buildRecorderStatus } from "@/lib/recorder-status";
import { readControl, readSchedulerBeats, readSpendFile } from "@/lib/recorder-control";
import { buildSpend, monthlyBudgetUsd, parseServerSpend, shapeRecordings } from "@/lib/recorder-report";
import { schoolDayStart, zonedDateKey } from "@/lib/school-time";
import { liveWhere } from "@/lib/live-presence";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireCapability("materials");
  if (!gate.ok) return gate.response;

  const now = new Date();
  const tenantId = gate.session.user.tenantId ?? null;
  const rows = await prisma.classRecording.findMany({
    where: { startedAt: { gte: monthStartUtc(now) } },
    select: { id: true, roomName: true, level: true, sessionSlot: true, egressId: true, durationSeconds: true, sizeBytes: true, startedAt: true, status: true, transcript: { select: { status: true } } },
    orderBy: { startedAt: "desc" },
  });
  const liveSessions = await prisma.liveClassSession.findMany({
    where: liveWhere(),
    orderBy: { startedAt: "asc" },
    select: {
      id: true,
      roomName: true,
      title: true,
      kind: true,
      level: true,
      sessionSlot: true,
      startedAt: true,
      privateClassId: true,
      branch: { select: { name: true } },
      lecturer: { select: { user: { select: { name: true } } } },
    },
  });
  const activeRooms = liveSessions.length
    ? await prisma.classRecording.findMany({
        where: { roomName: { in: liveSessions.map((session) => session.roomName) }, status: "active" },
        select: { roomName: true },
      })
    : [];
  const activeRoomNames = new Set(activeRooms.map((recording) => recording.roomName));
  const dayStart = schoolDayStart(now);
  const today = rows.filter((r) => r.startedAt >= dayStart);
  const own = rows.filter((r) => isRecorderEgressId(r.egressId));
  const liveKit = rows.filter((r) => !isRecorderEgressId(r.egressId));

  const fleet = recorderFleetMode();
  const [directory, forecast, beats, control, serverSpendFile] = await Promise.all([
    fleet ? loadDirectory() : Promise.resolve(null),
    tenantId ? loadRecordingForecast({ tenantId, now, hours: 24 }).catch(() => null) : Promise.resolve(null),
    fleet ? readSchedulerBeats() : Promise.resolve(undefined),
    fleet ? readControl() : Promise.resolve(undefined),
    fleet ? readSpendFile() : Promise.resolve(null),
  ]);

  const status = buildRecorderStatus({
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
  });

  const spend = buildSpend({
    now,
    today: zonedDateKey(now),
    serverSpend: parseServerSpend(serverSpendFile),
    liveKitMinutesToday: liveKitMinutes(liveKit.filter((r) => r.startedAt >= dayStart), now),
    liveKitMinutesMonth: liveKitMinutes(liveKit, now),
    budgetUsd: monthlyBudgetUsd(),
  });
  // What THIS deployment actually sees. Everything here is non-secret (names and counts, never keys).
  const storage = recordingObjectStorage();
  let storageHost: string | null = null;
  try { storageHost = storage?.endpoint ? new URL(storage.endpoint.startsWith("http") ? storage.endpoint : `https://${storage.endpoint}`).host : storage ? "(AWS S3)" : null; } catch { storageHost = "(unreadable)"; }
  const diagnostics = {
    backend: recordingBackend(),
    fleet: recorderFleetMode(),
    secretOk: !!recorderSecret(),
    appBase: recorderAppBase(),
    usesOurRecorder: recorderSelected(),
    storage: { bucket: storage?.bucket ?? null, host: storageHost },
    directory: fleet ? await probeDirectory() : null,
    spendFileRead: serverSpendFile !== null,
  };
  return NextResponse.json({
    ...status,
    spend,
    recordingsToday: shapeRecordings(today, isRecorderEgressId),
    liveSessions: liveSessions.map((session) => ({
      id: session.id,
      title: session.title,
      kind: session.kind,
      level: session.level,
      sessionSlot: session.sessionSlot,
      startedAt: session.startedAt.toISOString(),
      branchName: session.branch?.name ?? null,
      lecturerName: session.lecturer?.user?.name ?? null,
      recording: activeRoomNames.has(session.roomName),
    })),
    diagnostics,
  });
}
