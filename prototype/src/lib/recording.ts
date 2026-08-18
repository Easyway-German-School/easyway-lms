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
 * WHY THE FILE IS 1080p
 * ---------------------------------------------------------------------------
 * This used to be 640x360 — deliberately small, on the reasoning that a German
 * lesson is speech and a whiteboard, not a film. That reasoning still holds for
 * a *live* stream over a shaky connection, which is why the live classroom
 * itself still runs modest simulcast layers (see `LiveKitClassroom.tsx`). It
 * does not hold for the recording: nobody watches a lecture archive over a live
 * link, and a rewatching student squinting at a blurred equation on the board
 * is exactly the failure this quality bump exists to fix.
 *
 * The trade-off is real and was made deliberately, not by accident: 1080p at
 * this bitrate runs roughly 4.5x the bandwidth of the old 360p profile per
 * hour watched (about 1.3 GB/hour against 300 MB/hour). That is a bucket bill
 * line, specifically the DOWNLOAD side of it —
 * check `RECORDING_S3_*`'s provider dashboard for a bandwidth cap before
 * relying on this, since a cap sized for 360p viewing will be reached far
 * sooner at 1080p.
 *
 * `RECORDING_VARIANT=audio` still exists for a school that would rather not
 * pay for picture at all.
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
import { recordingObjectStorage } from "@/lib/storage";

/**
 * Full HD, tuned for a classroom rather than a film set.
 *
 * 1080p30 keeps a whiteboard or a shared screen legible when a student pauses
 * and zooms — the 360p profile this replaced was fine for a talking head and
 * useless for a slide with a table on it. Bitrate is set for what a static
 * classroom shot with a whiteboard actually needs, well under what a real
 * 1080p video-of-motion would take, so quality goes up by far more than the
 * file size does. 128kbps stereo audio stays generous: a student rewatching a
 * lesson to catch a declension needs to *hear* it, and audio is cheap next to
 * video regardless of resolution.
 */
export const CLASS_ENCODING = new EncodingOptions({
  width: 1920,
  height: 1080,
  framerate: 30,
  videoBitrate: 3000,
  audioBitrate: 128,
});

/**
 * Audio only, for schools that would rather keep five years of lessons than
 * one year of video.
 *
 * A German class is speech. Dropping the picture costs the whiteboard and
 * costs nothing else — and at 1080p it is no longer a small saving: roughly
 * **45 MB an hour against 1.3 GB**, which is close to thirty times the
 * storage and bandwidth for the video variant. A school on a metered bucket
 * plan may prefer this by default rather than as a fallback.
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
  const kbps = variant === "audio" ? 96 + 8 : 3000 + 128;
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
  // `RECORDING_S3_*` wins here and `STORAGE_S3_*` is the fallback, so one key
  // pair can still serve both — but a school that wants recordings in their own
  // bucket gets it by setting the recording vars, and nothing else moves.
  return recordingObjectStorage();
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
 * With `RECORDING_PUBLIC_BASE_URL` set, that is a CDN or custom domain in front
 * of a public bucket, and the bytes never touch this app.
 *
 * Without it, the file is served through `/api/files/<key>` — the same
 * authenticated, Range-aware route the uploads use, so the player can still
 * seek and scrub. This is the safe default and, on Backblaze and R2 alike, the
 * common one: making a bucket public is a billing decision as much as a
 * technical one, and a school should not have to make it to get playback.
 *
 * What it must NEVER do is return the raw bucket endpoint, which is what it
 * used to do. On a private bucket that URL is an unsigned request to an
 * authenticated host: a guaranteed 403, written into `Material.filePath`, for a
 * recording that captured and uploaded perfectly.
 */
export function recordingPublicUrl(objectKey: string, storage = recordingStorage()): string {
  const key = objectKey.replace(/^\/+/, "");
  if (storage?.publicBaseUrl) {
    return `${storage.publicBaseUrl.replace(/\/+$/, "")}/${key}`;
  }
  return `/api/files/${key}`;
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

/**
 * Confirm the file egress reported as finished is actually fetchable, before
 * anything gets written to the Watch shelf.
 *
 * LiveKit reporting `EGRESS_COMPLETE` only means ITS upload succeeded — it says
 * nothing about whether this app can later read the object back. A bucket that
 * is out of download quota, or has had its key rotated, or evicted the object
 * under a lifecycle rule, answers every GET with an error page long after the
 * upload itself went fine. Publishing a Material row on LiveKit's word alone is
 * how a "recording ready" notification ends up pointing at a broken player —
 * check the one thing that actually matters (can we read it back?) before
 * telling anyone it exists.
 *
 * A tiny ranged GET rather than a HEAD: R2 and B2 both support Range on GET,
 * and a HEAD is one more request shape to have tested against every provider
 * this ever runs on.
 */
export async function verifyRecordingObject(
  objectKey: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const storage = recordingStorage();
  if (!storage) return { ok: false, reason: "No recording storage configured" };

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

    const response = await aws.fetch(`${base}/${objectKey.replace(/^\/+/, "")}`, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
    });

    if (response.ok || response.status === 206) return { ok: true };

    const body = await response.text().catch(() => "");
    // Bucket error bodies are small XML/JSON. Keep only enough to diagnose —
    // this lands in `ClassRecording.error`, not a log built for megabytes.
    return { ok: false, reason: `Bucket returned ${response.status}: ${body.slice(0, 300) || response.statusText}` };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Unknown storage error" };
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
