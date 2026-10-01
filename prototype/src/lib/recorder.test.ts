import { EgressStatus } from "livekit-server-sdk";
import { describe, expect, it } from "vitest";
import {
  openRecorderToken,
  sealRecorderToken,
  sealingEnabled,
  callbackToEgress,
  isRecorderEgressId,
  jobIdFromEgressId,
  jobViewToCallback,
  mintRecorderToken,
  parseRecorderCallback,
  recorderAppBase,
  recorderConfig,
  recorderEgressId,
  recorderSecret,
  recorderSelected,
  recordingBackend,
  signRecorderBody,
  verifyRecorderRequest,
} from "./recorder";

const secret = "s".repeat(40);

describe("which backend records", () => {
  it("is LiveKit unless someone opts in", () => {
    expect(recordingBackend({})).toBe("livekit");
    expect(recordingBackend({ RECORDING_BACKEND: "" })).toBe("livekit");
    expect(recordingBackend({ RECORDING_BACKEND: "nonsense" })).toBe("livekit");
  });

  it("understands the two recorder modes, case-insensitively", () => {
    expect(recordingBackend({ RECORDING_BACKEND: "Recorder" })).toBe("recorder");
    expect(recordingBackend({ RECORDING_BACKEND: "recorder-only" })).toBe("recorder-only");
  });

  it("asking for the recorder without configuring it stays on LiveKit (never 'no recording')", () => {
    expect(recorderSelected({ RECORDING_BACKEND: "recorder" })).toBe(false);
    expect(recorderSelected({ RECORDING_BACKEND: "recorder", RECORDER_URL: "https://r.example", RECORDER_SHARED_SECRET: "short" })).toBe(false);
  });

  it("is selected only with the opt-in AND a full config", () => {
    const env = { RECORDER_URL: "https://r.example/", RECORDER_SHARED_SECRET: secret };
    expect(recorderSelected({ ...env, RECORDING_BACKEND: "recorder" })).toBe(true);
    expect(recorderSelected({ ...env })).toBe(false); // configured but not opted in
    expect(recorderConfig(env)?.url).toBe("https://r.example"); // trailing slash trimmed
  });

  it("the callback only needs the secret, not the recorder's URL", () => {
    expect(recorderSecret({ RECORDER_SHARED_SECRET: secret })).toBe(secret);
    expect(recorderSecret({ RECORDER_SHARED_SECRET: "short" })).toBeNull();
    expect(recorderSecret({})).toBeNull();
    // ...whereas CALLING the recorder needs both
    expect(recorderConfig({ RECORDER_SHARED_SECRET: secret })).toBeNull();
  });

  it("never hands the recorder a localhost origin", () => {
    expect(recorderAppBase({ NEXTAUTH_URL: "http://localhost:3000" })).toBeNull();
    expect(recorderAppBase({ NEXT_PUBLIC_APP_URL: "https://school.example/" })).toBe("https://school.example");
  });
});

describe("recorder ids", () => {
  it("round-trips and is recognisable, so LiveKit-only code can skip these rows", () => {
    const id = recorderEgressId("abc-123-def-456");
    expect(isRecorderEgressId(id)).toBe(true);
    expect(jobIdFromEgressId(id)).toBe("abc-123-def-456");
    expect(isRecorderEgressId("EG_realLiveKitId")).toBe(false);
    expect(isRecorderEgressId(null)).toBe(false);
  });
});

describe("request signing (must match the recorder service exactly)", () => {
  it("has a fixed, known signature — if this changes, the recorder stops trusting us", () => {
    // sha256 HMAC of "1700000000000.{\"a\":1}" keyed with 40 x 's'
    expect(signRecorderBody(secret, "1700000000000", '{"a":1}')).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signRecorderBody(secret, "1700000000000", '{"a":1}')).toBe(signRecorderBody(secret, "1700000000000", '{"a":1}'));
  });

  it("signs exactly as the recorder fleet manager does (fixed vector, asserted in the recorder repo too)", () => {
    expect(signRecorderBody("s".repeat(40), "1790000000000", "hours=48")).toBe("sha256=f8ab0218f27e7c59fe58bc3b879f428abe421deb22eeb3b68a06f1b93ad5c784");
  });

  it("accepts a fresh signed request and refuses tampering, wrong secret and replays", () => {
    const ts = String(Date.now());
    const body = '{"jobId":"job-12345678"}';
    const signature = signRecorderBody(secret, ts, body);
    expect(verifyRecorderRequest({ secret, timestamp: ts, signature, body }).ok).toBe(true);
    expect(verifyRecorderRequest({ secret, timestamp: ts, signature, body: body + " " }).ok).toBe(false);
    expect(verifyRecorderRequest({ secret: "x".repeat(40), timestamp: ts, signature, body }).ok).toBe(false);
    const old = String(Date.now() - 6 * 60_000);
    expect(verifyRecorderRequest({ secret, timestamp: old, signature: signRecorderBody(secret, old, body), body })).toEqual({ ok: false, reason: "stale request" });
    expect(verifyRecorderRequest({ secret, timestamp: null, signature: null, body }).ok).toBe(false);
  });
});

describe("callback parsing", () => {
  const good = { jobId: "job-12345678", status: "completed", objectKey: "recordings/a/b.mp4", durationSeconds: 3600, sizeBytes: 1000 };

  it("accepts a well-formed callback", () => {
    expect(parseRecorderCallback(good)?.objectKey).toBe("recordings/a/b.mp4");
  });

  it("rejects junk", () => {
    expect(parseRecorderCallback(null)).toBeNull();
    expect(parseRecorderCallback({ ...good, jobId: "../etc" })).toBeNull();
    expect(parseRecorderCallback({ ...good, status: "weird" })).toBeNull();
    expect(parseRecorderCallback({ ...good, objectKey: "" })).toBeNull();
  });

  it("drops nonsense numbers instead of trusting them", () => {
    const parsed = parseRecorderCallback({ ...good, durationSeconds: -5, sizeBytes: "big" });
    expect(parsed?.durationSeconds).toBeUndefined();
    expect(parsed?.sizeBytes).toBeUndefined();
  });
});

describe("recorder result -> egress result (so finaliseRecording can be reused as-is)", () => {
  it("a completed job becomes a COMPLETE egress with duration in nanoseconds", () => {
    const egress = callbackToEgress({ jobId: "job-12345678", status: "completed", objectKey: "recordings/x.mp4", durationSeconds: 2700, sizeBytes: 5_000_000 });
    expect(egress.egressId).toBe("rec_job-12345678");
    expect(egress.status).toBe(EgressStatus.EGRESS_COMPLETE);
    expect("fileResults" in egress && egress.fileResults?.[0]).toEqual({ filename: "recordings/x.mp4", duration: BigInt(2_700_000_000_000), size: BigInt(5_000_000) });
  });

  it("a failed job becomes a FAILED egress with a readable reason", () => {
    const egress = callbackToEgress({ jobId: "job-12345678", status: "failed", objectKey: "recordings/x.mp4", reason: "start-failed" });
    expect(egress.status).toBe(EgressStatus.EGRESS_FAILED);
    expect("error" in egress && egress.error).toBe("start-failed");
  });

  it("a job still running yields nothing to finalise; a finished one matches its callback", () => {
    expect(jobViewToCallback("job-12345678", { status: "recording" })).toBeNull();
    expect(jobViewToCallback("job-12345678", { status: "uploading" })).toBeNull();
    const done = jobViewToCallback("job-12345678", { status: "done", durationSeconds: 60, sizeBytes: 10, request: { objectKey: "k.mp4", roomName: "r" } });
    expect(done).toMatchObject({ status: "completed", objectKey: "k.mp4", durationSeconds: 60 });
    expect(jobViewToCallback("job-12345678", { status: "failed", reason: "boom", request: { objectKey: "k.mp4" } })?.status).toBe("failed");
  });
});

describe("the recorder's room pass", () => {
  it("is hidden, listen-only, and scoped to one room", async () => {
    const jwt = await mintRecorderToken({ roomName: "a1-morning", jobId: "job-12345678" }, { LIVEKIT_API_KEY: "key", LIVEKIT_API_SECRET: "x".repeat(40) });
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
    expect(payload.sub).toBe("recorder-job-12345678");
    expect(payload.video).toMatchObject({ room: "a1-morning", roomJoin: true, canSubscribe: true, canPublish: false, canPublishData: false, hidden: true });
  });

  it("refuses to mint when LiveKit is not configured", async () => {
    await expect(mintRecorderToken({ roomName: "r", jobId: "job-12345678" }, {})).rejects.toThrow(/not configured/);
  });
});

describe("sealing the room token for plain-http recorder servers", () => {
  const secret = "s".repeat(40);
  const jobId = "s0a000001-abcdef0123456789";
  const token = "eyJhbGciOiJIUzI1NiJ9.eyJ2aWRlbyI6e319.signature-part-here";

  it("round-trips, and hides the token", () => {
    const sealed = sealRecorderToken(secret, jobId, token);
    expect(sealed).not.toContain("eyJhbGci");
    expect(openRecorderToken(secret, jobId, sealed)).toBe(token);
  });

  it("is bound to the job and the secret", () => {
    const sealed = sealRecorderToken(secret, jobId, token);
    expect(openRecorderToken(secret, "s0a000002-abcdef0123456789", sealed)).toBeNull();
    expect(openRecorderToken("t".repeat(40), jobId, sealed)).toBeNull();
  });

  it("matches the recorder service byte for byte (the same fixed vector is in EduPrime-Recorder/test/seal.test.ts)", () => {
    expect(sealRecorderToken(secret, jobId, token, Buffer.alloc(12, 7))).toBe(
      "enc1.BwcHBwcHBwcHBwcH.i-jzZQ-xq-PrOZ7iyFKhrqxNEeWcBck0Q4X5f8z7LQKT_7FByAUzEnTKOcbMWU9uiPOBRWkdVfAE.olqgGIO2dAKCza4VeVDhRw",
    );
  });

  it("can be switched off for a server that predates it", () => {
    expect(sealingEnabled({})).toBe(true);
    expect(sealingEnabled({ RECORDER_SEAL_TOKENS: "0" })).toBe(false);
  });
});
