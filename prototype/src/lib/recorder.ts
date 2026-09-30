/**
 * The LMS's side of the self-hosted class recorder (the separate
 * `EduPrime-Recorder` service).
 *
 * WHY THIS EXISTS: recording every class through LiveKit Cloud Egress is
 * billed per transcoded minute and grows with every class and school. The
 * recorder is a small service we run ourselves: it joins the room as a hidden
 * viewer, films it, uploads the MP4 to the same bucket, and calls us back. LiveKit
 * stays for the live class itself.
 *
 * SAFE BY DEFAULT. Nothing in here changes behaviour until `RECORDING_BACKEND`
 * is set on purpose:
 *
 *   (unset) / "livekit"  today's behaviour — LiveKit Cloud Egress.
 *   "recorder"           our recorder first; if it is down or full, fall back to
 *                        LiveKit Egress so a class is never left unrecorded.
 *   "recorder-only"      our recorder only; no fallback (no LiveKit egress bill).
 *
 * WHAT THE LMS NEVER GIVES AWAY: the LiveKit API secret. The LMS mints a
 * short-lived, hidden, subscribe-only token for the recorder and hands over just
 * that.
 *
 * This file is pure decisions plus small HTTP calls. The database work
 * (creating the ClassRecording row, finalising) stays in class-recorder.ts.
 */

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { AccessToken, EgressStatus } from "livekit-server-sdk";

export const RECORDER_SIGNATURE_HEADER = "x-recorder-signature";
export const RECORDER_TIMESTAMP_HEADER = "x-recorder-timestamp";
const MAX_SKEW_MS = 5 * 60 * 1000;

/* -------------------------------------------------------------------------- */
/* Which backend?                                                             */
/* -------------------------------------------------------------------------- */

/** Any bag of strings: process.env fits, and so does a literal in a test. */
export type Env = Record<string, string | undefined>;

export type RecordingBackend = "livekit" | "recorder" | "recorder-only";

export function recordingBackend(env: Env = process.env): RecordingBackend {
  const value = String(env.RECORDING_BACKEND ?? "").trim().toLowerCase();
  return value === "recorder" || value === "recorder-only" ? value : "livekit";
}

export type RecorderConfig = { url: string; secret: string };

/**
 * The shared secret alone, or null unless it is a real (32+ char) one. The
 * inbound callback route needs only this: it never calls the recorder, so it
 * must not also demand the recorder's URL to decide whether it can check a
 * signature.
 */
export function recorderSecret(env: Env = process.env): string | null {
  const secret = String(env.RECORDER_SHARED_SECRET ?? "").trim();
  return secret.length >= 32 ? secret : null;
}

/** null unless BOTH the URL and a real (32+ char) shared secret are set. Needed to CALL the recorder. */
export function recorderConfig(env: Env = process.env): RecorderConfig | null {
  const url = String(env.RECORDER_URL ?? "").trim().replace(/\/+$/, "");
  const secret = recorderSecret(env);
  if (!url || !secret) return null;
  return { url, secret };
}

/**
 * True when a recording should be attempted through our recorder. Asking for
 * the recorder without configuring it quietly stays on LiveKit — a half-set env
 * must never mean "no recording at all".
 */
export function recorderSelected(env: Env = process.env): boolean {
  return recordingBackend(env) !== "livekit" && recorderConfig(env) !== null;
}

/** The public origin the recorder's browser and callbacks must reach. Never localhost. */
export function recorderAppBase(env: Env = process.env): string | null {
  const base = String(env.NEXT_PUBLIC_APP_URL || env.NEXTAUTH_URL || "").trim().replace(/\/+$/, "");
  if (!base || /localhost|127\.0\.0\.1/.test(base)) return null;
  return base;
}

/* -------------------------------------------------------------------------- */
/* Ids                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * `ClassRecording.egressId` is where LiveKit's egress id lives. A recorder job
 * has no such thing, so its id goes in the same column with a `rec_` prefix.
 * That keeps the whole existing pipeline (finalise, library, thumbnails,
 * retention) working on the same row shape with no schema change — and lets the
 * LiveKit-only code (limit restarts, `listEgress` reconcile) recognise and skip
 * these rows instead of mistaking them for a lost egress.
 */
const EGRESS_PREFIX = "rec_";

export const newRecorderJobId = (): string => randomUUID();
export const recorderEgressId = (jobId: string): string => `${EGRESS_PREFIX}${jobId}`;
export const isRecorderEgressId = (egressId: string | null | undefined): boolean =>
  typeof egressId === "string" && egressId.startsWith(EGRESS_PREFIX);
export const jobIdFromEgressId = (egressId: string): string => egressId.slice(EGRESS_PREFIX.length);

/* -------------------------------------------------------------------------- */
/* Signing — the same scheme the recorder uses in both directions             */
/* -------------------------------------------------------------------------- */

export function signRecorderBody(secret: string, timestamp: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function verifyRecorderRequest(input: {
  secret: string;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
  body: string;
  now?: number;
}): { ok: true } | { ok: false; reason: string } {
  const { secret, timestamp, signature, body } = input;
  if (!timestamp || !signature) return { ok: false, reason: "missing signature headers" };
  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) return { ok: false, reason: "bad timestamp" };
  // The timestamp is part of what is signed, so a captured request cannot be replayed later.
  if (Math.abs((input.now ?? Date.now()) - sentAt) > MAX_SKEW_MS) return { ok: false, reason: "stale request" };
  const expected = Buffer.from(signRecorderBody(secret, timestamp, body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "signature mismatch" };
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* The recorder's room pass                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A pass into ONE room: hidden (never appears in the participant list), can
 * only listen and watch, cannot speak, publish or send data. Six hours covers
 * the longest class plus slack; it is worthless afterwards and worthless in any
 * other room.
 */
export async function mintRecorderToken(input: { roomName: string; jobId: string }, env: Env = process.env): Promise<string> {
  const apiKey = env.LIVEKIT_API_KEY;
  const apiSecret = env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) throw new Error("LiveKit is not configured");
  const token = new AccessToken(apiKey, apiSecret, { identity: `recorder-${input.jobId}`, name: "Recorder", ttl: "6h" });
  token.addGrant({
    roomJoin: true,
    room: input.roomName,
    canSubscribe: true,
    canPublish: false,
    canPublishData: false,
    hidden: true,
  });
  return token.toJwt();
}

/* -------------------------------------------------------------------------- */
/* Talking to the recorder                                                    */
/* -------------------------------------------------------------------------- */

async function callRecorder(config: RecorderConfig, method: "GET" | "POST", path: string, payload?: unknown, timeoutMs = 8_000): Promise<Response> {
  const body = payload === undefined ? "" : JSON.stringify(payload);
  const timestamp = String(Date.now());
  return fetch(`${config.url}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      [RECORDER_TIMESTAMP_HEADER]: timestamp,
      [RECORDER_SIGNATURE_HEADER]: signRecorderBody(config.secret, timestamp, body),
    },
    body: method === "POST" ? body : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export type StartRecorderResult =
  | { ok: true; jobId: string; created: boolean }
  | { ok: false; reason: "not_configured" | "at_capacity" | "rejected" | "unreachable"; detail?: string };

/**
 * Ask the recorder to film a room.
 *
 * The recorder answers "already recording this room" with the EXISTING job's id,
 * so the id it returns — not the one we proposed — is the one to store. That is
 * what makes the tutor's 45-second heartbeat (which calls start every time) safe.
 */
export async function startRecorderJob(
  input: { roomName: string; objectKey: string; jobId: string },
  env: Env = process.env,
): Promise<StartRecorderResult> {
  const config = recorderConfig(env);
  const base = recorderAppBase(env);
  const livekitUrl = env.LIVEKIT_URL;
  if (!config || !base || !livekitUrl) return { ok: false, reason: "not_configured" };

  try {
    const response = await callRecorder(config, "POST", "/v1/jobs", {
      jobId: input.jobId,
      roomName: input.roomName,
      pageUrl: `${base}/live/egress-template`,
      livekitUrl,
      token: await mintRecorderToken({ roomName: input.roomName, jobId: input.jobId }, env),
      objectKey: input.objectKey,
      callbackUrl: `${base}/api/recorder/callback`,
    });
    if (response.status === 503) return { ok: false, reason: "at_capacity" };
    if (!response.ok) return { ok: false, reason: "rejected", detail: `HTTP ${response.status}` };
    const json = (await response.json()) as { created?: boolean; job?: { request?: { jobId?: string } } };
    const jobId = json.job?.request?.jobId;
    if (!jobId) return { ok: false, reason: "rejected", detail: "no job id in response" };
    return { ok: true, jobId, created: Boolean(json.created) };
  } catch (error) {
    return { ok: false, reason: "unreachable", detail: String(error) };
  }
}

export async function stopRecorderJob(jobId: string, env: Env = process.env): Promise<boolean> {
  const config = recorderConfig(env);
  if (!config) return false;
  try {
    const response = await callRecorder(config, "POST", `/v1/jobs/${encodeURIComponent(jobId)}/stop`, {});
    return response.ok;
  } catch {
    return false;
  }
}

export type RecorderJobView = {
  status: "queued" | "starting" | "recording" | "finalising" | "uploading" | "done" | "failed";
  reason?: string;
  durationSeconds?: number;
  sizeBytes?: number;
  request?: { jobId?: string; roomName?: string; objectKey?: string };
};

/** null = the recorder does not know this job (never started, or its disk was wiped). */
export async function getRecorderJob(jobId: string, env: Env = process.env): Promise<RecorderJobView | null | "unreachable"> {
  const config = recorderConfig(env);
  if (!config) return "unreachable";
  try {
    const response = await callRecorder(config, "GET", `/v1/jobs/${encodeURIComponent(jobId)}`);
    if (response.status === 404) return null;
    if (!response.ok) return "unreachable";
    return ((await response.json()) as { job: RecorderJobView }).job;
  } catch {
    return "unreachable";
  }
}

/* -------------------------------------------------------------------------- */
/* Recorder result -> the shape `finaliseRecording` already understands       */
/* -------------------------------------------------------------------------- */

export type RecorderCallback = {
  jobId: string;
  roomName?: string;
  status: "completed" | "failed";
  objectKey: string;
  durationSeconds?: number;
  sizeBytes?: number;
  reason?: string;
};

/** Validate an inbound callback body by hand (no schema library needed for six fields). */
export function parseRecorderCallback(value: unknown): RecorderCallback | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.jobId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(v.jobId)) return null;
  if (v.status !== "completed" && v.status !== "failed") return null;
  if (typeof v.objectKey !== "string" || !v.objectKey) return null;
  const number = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : undefined);
  return {
    jobId: v.jobId,
    roomName: typeof v.roomName === "string" ? v.roomName : undefined,
    status: v.status,
    objectKey: v.objectKey,
    durationSeconds: number(v.durationSeconds),
    sizeBytes: number(v.sizeBytes),
    reason: typeof v.reason === "string" ? v.reason.slice(0, 500) : undefined,
  };
}

/**
 * Dress a recorder result as a LiveKit egress result. `finaliseRecording`
 * already knows how to verify the file exists, discard too-short takes, make the
 * thumbnail, write the Watch-shelf entry and notify the cohort — so the
 * recorder gets all of that for free by speaking the same shape.
 * (LiveKit reports duration in nanoseconds as a bigint; we match.)
 */
export function callbackToEgress(callback: RecorderCallback) {
  const egressId = recorderEgressId(callback.jobId);
  if (callback.status === "failed") {
    return { egressId, status: EgressStatus.EGRESS_FAILED, error: callback.reason || "The recorder could not finish this class" };
  }
  return {
    egressId,
    status: EgressStatus.EGRESS_COMPLETE,
    fileResults: [
      {
        filename: callback.objectKey,
        duration: BigInt(Math.round(callback.durationSeconds ?? 0)) * BigInt(1_000_000_000),
        size: BigInt(Math.round(callback.sizeBytes ?? 0)),
      },
    ],
  };
}

/** When a callback was lost, the recorder's own job record says the same thing. Null while it is still running. */
export function jobViewToCallback(jobId: string, job: RecorderJobView): RecorderCallback | null {
  if (job.status !== "done" && job.status !== "failed") return null;
  return {
    jobId,
    roomName: job.request?.roomName,
    status: job.status === "done" ? "completed" : "failed",
    objectKey: job.request?.objectKey ?? "",
    durationSeconds: job.durationSeconds,
    sizeBytes: job.sizeBytes,
    reason: job.reason,
  };
}
