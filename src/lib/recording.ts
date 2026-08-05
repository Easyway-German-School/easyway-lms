/**
 * Class recording, and the storage architecture behind it.
 *
 * Every online class is captured automatically and lands on the Watch shelf in
 * Materials. Nobody presses record — a tutor with a class to teach will forget,
 * and the one class they forget is the one a student needed.
 *
 * ---------------------------------------------------------------------------
 * WHY SERVER-SIDE CAPTURE
 * ---------------------------------------------------------------------------
 * The recording is made by LiveKit's egress service, sitting next to the SFU —
 * not in anybody's browser. That single choice is what makes bad networks
 * irrelevant to the archive: when a student's line dies mid-class, the
 * recording does not gain a hole, because the student was never the one
 * recording it. Browser-side capture (MediaRecorder) would have made the tape
 * only as good as the worst connection in the room, which is precisely the
 * problem we are trying to solve.
 *
 * ---------------------------------------------------------------------------
 * WHY THE FILE IS SMALL
 * ---------------------------------------------------------------------------
 * A German lesson is not a film. The payload is speech and whatever is on the
 * board; a grid of forty webcam tiles is decoration that costs money to store
 * and costs a student on mobile data money to watch.
 *
 * So we do not use LiveKit's presets — the smallest is 720p30, which is built
 * for filming faces. `CLASS_ENCODING` below is tuned for a classroom instead:
 * modest video, generous audio. Audio is the lesson. This is roughly a tenth
 * the size of a naive recording of the same class, before any storage trick,
 * and it is the single largest cost lever in the whole system.
 *
 * ---------------------------------------------------------------------------
 * WHY THE KEYS LOOK LIKE THAT
 * ---------------------------------------------------------------------------
 * Objects are stored under `recordings/<branch>/<level>/<date>/<room>.mp4`.
 * Partitioning by date and cohort is not tidiness — it is what lets a bucket
 * lifecycle rule say "A1 recordings older than 90 days move to cold storage"
 * without us maintaining an index, and what lets one branch's tapes be listed
 * or handed over without scanning everything.
 *
 * Storage is any S3-compatible bucket, so the school is not married to a
 * vendor: Cloudflare R2, Backblaze B2, AWS S3 and a self-hosted MinIO all
 * speak this. R2 is the recommendation, because on this workload the bill is
 * bandwidth rather than gigabytes, and R2 charges nothing to serve.
 */

import { EgressClient, EncodedFileOutput, EncodedFileType, EncodingOptions, S3Upload } from "livekit-server-sdk";
import { objectStorage } from "@/lib/storage";

/**
 * Tuned for a classroom rather than a film set.
 *
 * 640x360 at 20fps is legible for a whiteboard and a talking head, and dies
 * quietly on a 3G connection instead of buffering. 96kbps stereo audio is
 * deliberately generous for the size of the video: a student rewatching a
 * lesson to catch a declension needs to *hear* it, and audio is cheap.
 */
export const CLASS_ENCODING = new EncodingOptions({
  width: 640,
  height: 360,
  framerate: 20,
  videoBitrate: 600,
  audioBitrate: 96,
});

/**
 * Audio only, for schools that would rather keep five years of lessons than
 * one year of video.
 *
 * A German class is speech. Dropping the picture costs the whiteboard and
 * costs nothing else — and it is not a small saving: roughly **45 MB an hour
 * against 300**, which is the difference between 66 GB and 438 GB of storage
 * per branch per year. At that size a phone can hold an entire level offline.
 *
 * Set `RECORDING_VARIANT=audio` to switch. The tile still appears on the Watch
 * shelf and the player still resumes where the student stopped; there is
 * simply no picture behind the sound.
 */
export const AUDIO_ENCODING = new EncodingOptions({
  audioBitrate: 96,
});

export type RecordingVariant = "video" | "audio";

export function recordingVariant(): RecordingVariant {
  return String(process.env.RECORDING_VARIANT ?? "").trim().toLowerCase() === "audio" ? "audio" : "video";
}

/** Roughly what an hour costs to keep, for the admin UI and the diagnostics. */
export function mbPerHour(variant: RecordingVariant = recordingVariant()): number {
  const kbps = variant === "audio" ? 96 + 8 : 600 + 96;
  return Math.round((kbps * 1000 * 3600) / 8 / 1024 / 1024);
}

/** Kept for callers that just want the current profile's figure. */
export const MB_PER_HOUR = mbPerHour("video");

export type RecordingStorage = {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKey: string;
  secret: string;
  publicBaseUrl?: string;
};

/**
 * Recording needs a bucket to write into, and LiveKit needs credentials for it.
 * Without them we do not record — same deliberate fallback as the classroom
 * itself, where a missing key downgrades the feature instead of breaking the
 * class. A tutor must always be able to teach.
 */
export function recordingStorage(): RecordingStorage | null {
  // Same bucket resolver the uploads use, so one set of credentials serves
  // both. The public base is the one difference: recordings are streamed and
  // carry no personal documents, so they are served from a CDN rather than
  // through the app's own auth-checked /api/files route.
  const storage = objectStorage();
  if (!storage) return null;

  return {
    ...storage,
    publicBaseUrl: process.env.RECORDING_PUBLIC_BASE_URL || storage.publicBaseUrl,
  };
}

export function recordingConfigured(): boolean {
  return recordingStorage() !== null;
}

function slug(value: string | null | undefined, fallback: string): string {
  const out = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return out || fallback;
}

/**
 * Where this class's file lives in the bucket.
 *
 * The room name is already unique per cohort, and the date makes it unique per
 * class. A second recording of the same room on the same day (a tutor restarts
 * after a crash) gets a suffix rather than overwriting the first — losing the
 * first half of a class to a filename collision would be unforgivable.
 */
export function recordingObjectKey(input: {
  branchName?: string | null;
  level?: string | null;
  roomName: string;
  at?: Date;
  attempt?: number;
}): string {
  const at = input.at ?? new Date();
  const date = at.toISOString().slice(0, 10);
  const branch = slug(input.branchName, "easyway");
  const level = slug(input.level, "a1");
  const suffix = input.attempt && input.attempt > 1 ? `-${input.attempt}` : "";
  return `recordings/${branch}/${level}/${date}/${slug(input.roomName, "class")}${suffix}.mp4`;
}

/**
 * The URL the student's player will hit.
 *
 * Prefers an explicit public base (an R2 custom domain or CDN hostname), then
 * falls back to the bucket endpoint. Returning a path when neither is set is
 * intentional: the row is still created and the recording is still safe in the
 * bucket, and an admin can fix the base URL later without losing the class.
 */
export function recordingPublicUrl(objectKey: string, storage = recordingStorage()): string {
  if (!storage) return objectKey;
  if (storage.publicBaseUrl) {
    return `${storage.publicBaseUrl.replace(/\/+$/, "")}/${objectKey}`;
  }
  if (storage.endpoint) {
    return `${storage.endpoint.replace(/\/+$/, "")}/${storage.bucket}/${objectKey}`;
  }
  return `https://${storage.bucket}.s3.${storage.region}.amazonaws.com/${objectKey}`;
}

/** The egress output description LiveKit writes to. */
export function buildFileOutput(objectKey: string, storage: RecordingStorage): EncodedFileOutput {
  return new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath: objectKey,
    output: {
      case: "s3",
      value: new S3Upload({
        bucket: storage.bucket,
        region: storage.region,
        endpoint: storage.endpoint,
        accessKey: storage.accessKey,
        secret: storage.secret,
        // R2 and B2 require path-style addressing; S3 tolerates it.
        forcePathStyle: Boolean(storage.endpoint),
      }),
    },
  });
}

export function egressClient(): EgressClient | null {
  const url = process.env.LIVEKIT_URL;
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!url || !key || !secret) return null;
  return new EgressClient(url.replace(/^wss:/, "https:").replace(/^ws:/, "http:"), key, secret);
}

/**
 * Delete one object from the bucket.
 *
 * LiveKit writes objects but has no interest in removing them, so this is
 * signed by hand. `aws4fetch` is a few kilobytes and speaks plain SigV4, which
 * every S3-compatible service understands — pulling in the full AWS SDK to
 * issue one DELETE would have been a strange trade.
 *
 * Returns false rather than throwing on failure: retention must be able to
 * report "could not reclaim this one" and carry on down the list.
 */
export async function deleteRecordingObject(objectKey: string): Promise<boolean> {
  const storage = recordingStorage();
  if (!storage) return false;

  try {
    const { AwsClient } = await import("aws4fetch");
    const aws = new AwsClient({
      accessKeyId: storage.accessKey,
      secretAccessKey: storage.secret,
      region: storage.region,
      service: "s3",
    });

    const base = storage.endpoint
      ? `${storage.endpoint.replace(/\/+$/, "")}/${storage.bucket}`
      : `https://${storage.bucket}.s3.${storage.region}.amazonaws.com`;

    const response = await aws.fetch(`${base}/${objectKey}`, { method: "DELETE" });
    // S3 answers 204 for a delete, and also for an object that was already
    // gone — which is the right outcome either way.
    return response.status === 204 || response.status === 200 || response.status === 404;
  } catch (error) {
    console.error(`Could not delete ${objectKey}:`, error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Tiering policy
//
// The bucket enforces lifecycle; this decides what the rule should be. Both
// halves live here so the policy is one readable function rather than a rule
// buried in a cloud console that nobody at the school can read.
//
// The insight is that we already know what gets watched. `VideoProgress` has a
// row per student per video, so a recording's real popularity is measured, not
// guessed — and class tapes follow a violent curve: heavy traffic for about a
// fortnight while the cohort catches up, then near silence forever.
// ---------------------------------------------------------------------------

/** Recordings stay on fast storage this long regardless of traffic. */
export const HOT_WINDOW_DAYS = 14;

export function shouldStayHot(input: { recordedAt: Date; watchersLast30Days: number; now?: Date }): boolean {
  const now = input.now ?? new Date();
  const ageDays = (now.getTime() - input.recordedAt.getTime()) / 86_400_000;
  if (ageDays <= HOT_WINDOW_DAYS) return true;
  // Still being watched after the window — a tape the next cohort found useful
  // is worth keeping fast, and there are few enough of these to afford it.
  return input.watchersLast30Days >= 3;
}
