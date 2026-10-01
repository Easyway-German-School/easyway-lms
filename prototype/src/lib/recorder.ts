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

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { AccessToken, EgressStatus } from "livekit-server-sdk";
import {
  jobIdForServer,
  loadDirectory,
  rankServers,
  serverForJobId,
  serverIdFromJobId,
  type DirectoryDeps,
} from "@/lib/recorder-directory";

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
 * Fleet mode (`RECORDER_FLEET=1`): the recorder servers are created and deleted on demand by the fleet manager,
 * so there is no fixed `RECORDER_URL`; the LMS reads the current servers from the directory instead
 * (see recorder-directory.ts). Off by default: with it unset everything behaves as before.
 */
export function recorderFleetMode(env: Env = process.env): boolean {
  return String(env.RECORDER_FLEET ?? "").trim() === "1";
}

/**
 * True when a recording should be attempted through our recorder. Asking for
 * the recorder without configuring it quietly stays on LiveKit — a half-set env
 * must never mean "no recording at all".
 */
export function recorderSelected(env: Env = process.env): boolean {
  if (recordingBackend(env) === "livekit") return false;
  return recorderConfig(env) !== null || (recorderFleetMode(env) && recorderSecret(env) !== null);
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

/* -------------------------------------------------------------------------- */
/* Sealing the room token — recorder servers are reached over plain http      */
/* -------------------------------------------------------------------------- */

/**
 * The request is signed, so nobody can change it, but on plain http anyone on the path could READ the LiveKit
 * room token inside it. Sealing it (AES-256-GCM, key derived from the shared secret, job id bound in) means only
 * this app and the recorder can. Format `enc1.<iv>.<ciphertext>.<tag>` (base64url): identical code and a fixed test
 * vector live in the EduPrime-Recorder repository (src/seal.ts). RECORDER_SEAL_TOKENS=0 turns it off, for a
 * recorder server that predates sealing.
 */
const sealKey = (secret: string): Buffer => Buffer.from(hkdfSync("sha256", secret, "eduprime-recorder", "job-token-v1", 32));

export function sealRecorderToken(secret: string, jobId: string, token: string, iv: Buffer = randomBytes(12)): string {
  const cipher = createCipheriv("aes-256-gcm", sealKey(secret), iv);
  cipher.setAAD(Buffer.from(jobId));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["enc1", iv.toString("base64url"), ciphertext.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

export function openRecorderToken(secret: string, jobId: string, sealed: string): string | null {
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== "enc1") return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", sealKey(secret), Buffer.from(parts[1]!, "base64url"));
    decipher.setAAD(Buffer.from(jobId));
    decipher.setAuthTag(Buffer.from(parts[3]!, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(parts[2]!, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export const sealingEnabled = (env: Env = process.env): boolean => String(env.RECORDER_SEAL_TOKENS ?? "").trim() !== "0";

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

async function sealedRoomToken(secret: string, jobId: string, roomName: string, env: Env): Promise<string> {
  const token = await mintRecorderToken({ roomName, jobId }, env);
  return sealingEnabled(env) ? sealRecorderToken(secret, jobId, token) : token;
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
/** In fleet mode: at most this many servers are tried, each with a short timeout, before the class falls back to LiveKit. */
const FLEET_MAX_ATTEMPTS = 3;
const FLEET_ATTEMPT_TIMEOUT_MS = 4_000;

export async function startRecorderJob(
  input: { roomName: string; objectKey: string; jobId: string },
  env: Env = process.env,
  deps: DirectoryDeps = {},
): Promise<StartRecorderResult> {
  const secret = recorderSecret(env);
  const base = recorderAppBase(env);
  const livekitUrl = env.LIVEKIT_URL;
  if (!secret || !base || !livekitUrl) return { ok: false, reason: "not_configured" };

  // Where to try, in order. One fixed recorder (the original setup), or the fleet's servers that have room,
  // each with a job id that names its server so a later stop/status call finds the same machine.
  const fleet = recorderFleetMode(env);
  const targets: { url: string; jobId: string }[] = [];
  if (fleet) {
    const directory = await loadDirectory(deps);
    for (const server of directory ? rankServers(directory) : []) targets.push({ url: server.url, jobId: jobIdForServer(server) });
    if (targets.length === 0) return { ok: false, reason: "at_capacity", detail: "no recorder server is open for work right now" };
  } else {
    const config = recorderConfig(env);
    if (!config) return { ok: false, reason: "not_configured" };
    targets.push({ url: config.url, jobId: input.jobId });
  }

  let last: StartRecorderResult = { ok: false, reason: "unreachable" };
  for (const target of targets.slice(0, fleet ? FLEET_MAX_ATTEMPTS : 1)) {
    try {
      const response = await callRecorder({ url: target.url, secret }, "POST", "/v1/jobs", {
        jobId: target.jobId,
        roomName: input.roomName,
        pageUrl: `${base}/live/egress-template`,
        livekitUrl,
        token: await sealedRoomToken(secret, target.jobId, input.roomName, env),
        objectKey: input.objectKey,
        callbackUrl: `${base}/api/recorder/callback`,
      }, fleet ? FLEET_ATTEMPT_TIMEOUT_MS : undefined);
      if (response.status === 503) { last = { ok: false, reason: "at_capacity" }; continue; }
      if (!response.ok) { last = { ok: false, reason: "rejected", detail: `HTTP ${response.status}` }; continue; }
      const json = (await response.json()) as { created?: boolean; job?: { request?: { jobId?: string } } };
      const jobId = json.job?.request?.jobId;
      if (!jobId) { last = { ok: false, reason: "rejected", detail: "no job id in response" }; continue; }
      return { ok: true, jobId, created: Boolean(json.created) };
    } catch (error) {
      last = { ok: false, reason: "unreachable", detail: String(error) };
    }
  }
  return last;
}

/**
 * Which server holds this job. A fleet job id names its server; look that server up in the directory. Jobs
 * from the original single-recorder setup (UUIDs) go to the fixed URL. `gone` means the job belongs to a server
 * that no longer exists, which is a different answer from "could not reach it right now".
 */
async function serverFor(jobId: string, env: Env, deps: DirectoryDeps): Promise<{ config: RecorderConfig } | "gone" | null> {
  const secret = recorderSecret(env);
  if (!secret) return null;
  if (serverIdFromJobId(jobId)) {
    const server = serverForJobId(await loadDirectory(deps), jobId);
    return server ? { config: { url: server.url, secret } } : "gone";
  }
  const config = recorderConfig(env);
  return config ? { config } : null;
}

export async function stopRecorderJob(jobId: string, env: Env = process.env, deps: DirectoryDeps = {}): Promise<boolean> {
  const target = await serverFor(jobId, env, deps);
  if (!target || target === "gone") return false;
  const config = target.config;
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
export async function getRecorderJob(jobId: string, env: Env = process.env, deps: DirectoryDeps = {}): Promise<RecorderJobView | null | "unreachable"> {
  const target = await serverFor(jobId, env, deps);
  if (target === "gone") return null; // its server has been switched off: the recorder has no record of it
  if (!target) return "unreachable";
  const config = target.config;
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
