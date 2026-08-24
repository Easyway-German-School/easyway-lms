/**
 * Starting, finishing and rescuing class recordings.
 *
 * The pure decisions — encoding, object keys, tiering — live in `recording.ts`.
 * This is the part that talks to LiveKit and the database.
 *
 * THE ORDER OF EVENTS, because it is not the obvious one:
 *
 *   1. A tutor opens the classroom. `/api/live/session` calls
 *      `ensureRecordingStarted()`, which is idempotent — students opening the
 *      same room, and the tutor reloading, must not start a second capture.
 *   2. The class happens. Nothing here runs.
 *   3. The room empties. LiveKit stops the egress on its own.
 *   4. Minutes later the file finishes encoding and uploading, and a webhook
 *      arrives. `finaliseRecording()` writes the library row.
 *   5. If that webhook never arrives — and in development it never does, since
 *      LiveKit cannot reach a laptop — `reconcileRecordings()` picks it up by
 *      asking LiveKit directly. The webhook is the fast path, not the only one.
 *
 * Nothing here is allowed to break a class. Every entry point swallows its own
 * errors: a failed recording is a bad afternoon, a classroom that will not open
 * because the recorder threw is a catastrophe.
 */

import { EgressStatus } from "livekit-server-sdk";
import { prisma } from "@/lib/prisma";
import { notifyInBackground, KIND } from "@/lib/notify";
import { createRecordingThumbnail } from "@/lib/recording-thumbnail";
import {
  AUDIO_ENCODING,
  CLASS_ENCODING,
  buildFileOutput,
  egressClient,
  recordingConfigured,
  recordingObjectKey,
  recordingPublicUrl,
  recordingStorage,
  recordingVariant,
  verifyRecordingObject,
} from "@/lib/recording";

export type StartRecordingInput = {
  roomName: string;
  tenantId?: string | null;
  branchId?: string | null;
  branchName?: string | null;
  level?: string | null;
  sessionSlot?: string | null;
  startedByUserId?: string | null;
};

/**
 * Start capturing this room, unless it is already being captured.
 *
 * Returns the egress id, or null when recording is switched off or already
 * running. Never throws.
 */
export async function ensureRecordingStarted(input: StartRecordingInput): Promise<string | null> {
  try {
    const storage = recordingStorage();
    const client = egressClient();
    if (!storage || !client) return null;

    // The database is the lock. Two tutors opening the same room in the same
    // second is rare enough that a race would only cost a duplicate file, and
    // the reconciler tidies those; a distributed lock here would be more
    // machinery than the problem deserves.
    const active = await prisma.classRecording.findFirst({
      where: { roomName: input.roomName, status: "active" },
      select: { egressId: true },
    });
    if (active) return active.egressId;

    // A capture that LiveKit still has running but we lost the row for — a
    // restarted dev server, say. Adopt it rather than starting a second one.
    const live = await client.listEgress({ roomName: input.roomName, active: true });
    if (live.length > 0) {
      const adopted = live[0];
      await prisma.classRecording.upsert({
        where: { egressId: adopted.egressId },
        create: {
          egressId: adopted.egressId,
          roomName: input.roomName,
          branchId: input.branchId ?? null,
          level: input.level ?? null,
          sessionSlot: input.sessionSlot ?? null,
          startedByUserId: input.startedByUserId ?? null,
          status: "active",
        },
        update: {},
      });
      return adopted.egressId;
    }

    const attempt =
      (await prisma.classRecording.count({
        where: { roomName: input.roomName, startedAt: { gte: startOfToday() } },
      })) + 1;

    const objectKey = recordingObjectKey({
      branchName: input.branchName,
      level: input.level,
      roomName: input.roomName,
      attempt,
    });

    const variant = recordingVariant();
    const info = await client.startRoomCompositeEgress(
      input.roomName,
      { file: buildFileOutput(objectKey, storage) },
      {
        // The tutor is the lesson. "speaker" keeps whoever is talking large and
        // everyone else small, which is both the most useful tape and the
        // cheapest one to encode.
        layout: "speaker",
        audioOnly: variant === "audio",
        encodingOptions: variant === "audio" ? AUDIO_ENCODING : CLASS_ENCODING,
      },
    );

    await prisma.classRecording.create({
      data: {
        egressId: info.egressId,
        roomName: input.roomName,
        tenantId: input.tenantId ?? null,
        branchId: input.branchId ?? null,
        level: input.level ?? null,
        sessionSlot: input.sessionSlot ?? null,
        startedByUserId: input.startedByUserId ?? null,
        status: "active",
        variant,
        objectKey,
      },
    });

    return info.egressId;
  } catch (error) {
    // Deliberately swallowed — see the module comment. A class must open.
    console.error("Could not start class recording:", error);
    return null;
  }
}

/** Stop a capture early. Used when a tutor ends a class deliberately. */
export async function stopRecordingForRoom(roomName: string): Promise<boolean> {
  try {
    const client = egressClient();
    if (!client) return false;
    const active = await prisma.classRecording.findFirst({
      where: { roomName, status: "active" },
      select: { egressId: true },
    });
    if (!active) return false;
    await client.stopEgress(active.egressId);
    return true;
  } catch (error) {
    console.error("Could not stop class recording:", error);
    return false;
  }
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

const SLOT_LABEL: Record<string, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
};

/** "A1 · Morning class · 2 August" — what a student scanning the shelf reads. */
function recordingTitle(input: { level?: string | null; sessionSlot?: string | null; at: Date }): string {
  const level = (input.level || "Class").toUpperCase();
  const slot = SLOT_LABEL[String(input.sessionSlot || "")] ?? null;
  const date = input.at.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
  return slot ? `${level} · ${slot} class · ${date}` : `${level} · ${date}`;
}

/**
 * A capture has finished. Write it into the library.
 *
 * Idempotent on `egressId`, because the webhook and the reconciler will
 * routinely both deliver the same completed egress and neither knows about the
 * other. A class appearing twice on the shelf is exactly the kind of small
 * ugliness nobody ever gets round to fixing.
 */
export async function finaliseRecording(egress: {
  egressId: string;
  status?: EgressStatus;
  error?: string;
  fileResults?: Array<{ filename?: string; duration?: bigint | number; size?: bigint | number; location?: string }>;
}): Promise<"created" | "already" | "failed" | "unknown"> {
  try {
    const row =
      (await prisma.classRecording.findUnique({ where: { egressId: egress.egressId } })) ??
      (egress.fileResults?.[0]?.filename
        ? await prisma.classRecording.findFirst({ where: { objectKey: egress.fileResults[0]!.filename } })
        : null);
    if (!row) return "unknown";
    if (row.materialId) return "already";

    const failed = egress.status === EgressStatus.EGRESS_FAILED || egress.status === EgressStatus.EGRESS_ABORTED;
    if (failed) {
      await prisma.classRecording.update({
        where: { id: row.id },
        data: {
          status: egress.status === EgressStatus.EGRESS_ABORTED ? "aborted" : "failed",
          endedAt: new Date(),
          error: egress.error || "Egress did not complete",
        },
      });
      return "failed";
    }

    const result = egress.fileResults?.[0];
    const objectKey = result?.filename || row.objectKey;
    if (!objectKey) return "unknown";

    // LiveKit saying the upload finished is not the same as this app being
    // able to read it back — see the comment on `verifyRecordingObject`. A
    // Backblaze/R2 outage, an exhausted download quota or a rotated key all
    // answer LiveKit's own upload just fine and only show up here, on the
    // read side. Catching it now means a "failed" row and an admin ping,
    // instead of a Material row that looks ready and 404s the first time a
    // student presses play.
    const verified = await verifyRecordingObject(objectKey);
    if (!verified.ok) {
      await prisma.classRecording.update({
        where: { id: row.id },
        data: { status: "failed", endedAt: new Date(), objectKey, error: verified.reason },
      });
      notifyInBackground({
        to: { audience: "admin", capability: "materials" },
        kind: KIND.recordingFailed,
        severity: "critical",
        title: "A class recording uploaded but can't be read back",
        message: `${recordingTitle({ level: row.level, sessionSlot: row.sessionSlot, at: row.startedAt })}: ${verified.reason}`,
        link: "/admin/materials",
        dedupeKey: `recording-verify-failed:${row.egressId}`,
      });
      return "failed";
    }

    // LiveKit reports duration in nanoseconds, as a bigint.
    const durationSeconds = result?.duration ? Math.round(Number(result.duration) / 1_000_000_000) : null;
    const sizeBytes = result?.size ? Number(result.size) : null;
    const fileUrl = recordingPublicUrl(objectKey);
    const recordedAt = row.startedAt;
    let thumbnailPath: string | null = null;
    try {
      thumbnailPath = await createRecordingThumbnail({
        objectKey,
        title: recordingTitle({ level: row.level, sessionSlot: row.sessionSlot, at: recordedAt }),
        level: row.level,
        recordedAt,
      });
    } catch (thumbnailError) {
      console.error(`Could not create thumbnail for recording ${row.egressId}:`, thumbnailError);
    }

    const material = await prisma.material.create({
      data: {
        title: recordingTitle({ level: row.level, sessionSlot: row.sessionSlot, at: recordedAt }),
        description: "Recorded automatically from the live class.",
        filePath: fileUrl,
        fileName: objectKey.split("/").pop() || "class.mp4",
        fileType: "video/mp4",
        fileSize: sizeBytes ?? 0,
        // The whole point: it lands on the "class recordings" shelf, not among
        // the tutor's prepared lesson videos.
        kind: "recording",
        level: row.level,
        durationSeconds,
        thumbnailPath,
        recordedAt,
      },
    });

    await prisma.classRecording.update({
      where: { id: row.id },
      data: {
        status: "completed",
        endedAt: new Date(),
        objectKey,
        fileUrl,
        durationSeconds,
        sizeBytes,
        materialId: material.id,
      },
    });

    // Tell the cohort whose class it was, and only them. A student who missed
    // Tuesday should not have to go looking.
    if (row.level) {
      notifyInBackground({
        to: { students: { branchId: row.branchId, level: row.level, sessionSlot: row.sessionSlot } },
        kind: KIND.materialPublished,
        title: "Your class recording is ready",
        message: `${material.title} is now on the Watch shelf in Materials.`,
        link: `/materials/watch/${material.id}`,
        dedupeKey: `recording:${row.egressId}`,
      });
    }

    return "created";
  } catch (error) {
    console.error("Could not finalise class recording:", error);
    return "unknown";
  }
}

/**
 * Catch anything the webhook missed.
 *
 * Webhooks cannot reach a development laptop, and in production they can still
 * be lost to a deploy landing at the wrong moment. This asks LiveKit what
 * actually happened to every capture we still think is running, which makes the
 * webhook an optimisation rather than a dependency.
 */
/**
 * The webhook is the fast path. This is what stops a lost one costing a day.
 *
 * `reconcileRecordings` is driven by the daily cron, which is the right cadence
 * for tidying up and completely the wrong one for a student who has just sat
 * through a class and wants to rewatch the bit they missed. A capture finishes
 * encoding a few minutes after the room empties, so the moment that actually
 * matters is somebody opening the Watch shelf — and at that moment we can
 * simply go and ask.
 *
 * Throttled to one pass a minute per server instance, because the shelf is
 * opened by every student in the cohort at roughly the same time and none of
 * them need their own round trip to LiveKit. It only ever looks at captures
 * still marked active, so on the overwhelmingly common path it is a single
 * indexed query that returns nothing.
 *
 * Never awaited by a page, and never allowed to throw: the shelf must render
 * whether or not LiveKit is reachable.
 */
const RECONCILE_THROTTLE_MS = 60_000;
let lastReconcileAt = 0;

export function reconcileRecordingsSoon(): void {
  const now = Date.now();
  if (now - lastReconcileAt < RECONCILE_THROTTLE_MS) return;
  lastReconcileAt = now;
  void reconcileRecordings().catch((error) => {
    console.error("Opportunistic recording reconcile failed:", error);
  });
}

// A capture LiveKit has forgotten about (garbage-collected on its side, or
// the egress id is simply wrong) is never going to answer `listEgress`. Left
// alone that row sits "active" forever — nobody's fault, just nothing left to
// ask. Past this age with no answer, it is dead and should say so.
const STUCK_ACTIVE_HOURS = 6;

export async function reconcileRecordings(): Promise<{ checked: number; finalised: number }> {
  const client = egressClient();
  if (!client || !recordingConfigured()) return { checked: 0, finalised: 0 };

  // Only ACTIVE rows belong here. A row already sitting at "failed" or
  // "aborted" already went through `finaliseRecording` once and got that
  // status from LiveKit's own report — there is no second opinion to ask for,
  // and re-finalising it by faking `EGRESS_COMPLETE` (the bug this used to
  // have) is exactly how a class that genuinely never recorded ends up with a
  // Material row pointing at a file that was never written.
  const open = await prisma.classRecording.findMany({
    where: { status: "active", objectKey: { not: null } },
    select: { egressId: true, startedAt: true },
  });
  if (open.length === 0) return { checked: 0, finalised: 0 };

  const staleBefore = Date.now() - STUCK_ACTIVE_HOURS * 3_600_000;
  let finalised = 0;
  for (const { egressId, startedAt } of open) {
    try {
      const [info] = await client.listEgress({ egressId });
      if (!info) {
        if (startedAt.getTime() < staleBefore) {
          await prisma.classRecording.update({
            where: { egressId },
            data: { status: "failed", endedAt: new Date(), error: "LiveKit has no record of this egress" },
          });
          finalised += 1;
        }
        continue;
      }
      const done =
        info.status === EgressStatus.EGRESS_COMPLETE ||
        info.status === EgressStatus.EGRESS_FAILED ||
        info.status === EgressStatus.EGRESS_ABORTED;
      if (!done) continue;

      const outcome = await finaliseRecording({
        egressId: info.egressId,
        status: info.status,
        error: info.error,
        fileResults: info.fileResults,
      });
      if (outcome === "created" || outcome === "failed") finalised += 1;
    } catch (error) {
      console.error(`Reconcile failed for egress ${egressId}:`, error);
    }
  }

  return { checked: open.length, finalised };
}
