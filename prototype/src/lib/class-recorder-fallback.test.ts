import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The fallback policy, run through the REAL ensureRecordingStarted: when our own recorder cannot take a class,
 * does LiveKit (which costs money) get paid? Who is told? Each scenario below is a way the real world goes wrong.
 */

const h = vi.hoisted(() => ({
  startRecorder: vi.fn(),
  startEgress: vi.fn(async () => ({ egressId: "EG_livekit_1" })),
  notified: [] as { severity?: string; title: string; message?: string; dedupeKey: string }[],
  recordings: [] as Record<string, unknown>[],
  liveSession: null as { startedAt: Date } | null,
  hint: "",
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    classRecording: {
      findFirst: async ({ where }: { where: { roomName: string; status: string } }) => h.recordings.find((r) => r.roomName === where.roomName && r.status === where.status) ?? null,
      count: async () => 0,
      create: async ({ data }: { data: Record<string, unknown> }) => { h.recordings.push(data); return data; },
      upsert: async ({ create }: { create: Record<string, unknown> }) => { h.recordings.push(create); return create; },
      // The cap query: LiveKit-made rows (not "rec_…") this month.
      findMany: async () => h.recordings.filter((r) => !String(r.egressId).startsWith("rec_")).map((r) => ({ durationSeconds: (r.durationSeconds as number) ?? null, startedAt: (r.startedAt as Date) ?? new Date(), status: String(r.status) })),
    },
    liveClassSession: { findFirst: async () => h.liveSession },
  },
}));
vi.mock("@/lib/notify", () => ({ KIND: { recordingFailed: "rf", materialPublished: "mp" }, notifyInBackground: (n: { severity?: string; title: string; message?: string; dedupeKey: string }) => h.notified.push(n) }));
vi.mock("@/lib/recording-thumbnail", () => ({ createRecordingThumbnail: async () => null }));
vi.mock("@/lib/recording", () => ({
  AUDIO_ENCODING: {}, CLASS_ENCODING: {}, buildFileOutput: () => ({}),
  egressClient: () => ({ listEgress: async () => [], startRoomCompositeEgress: h.startEgress }),
  egressTemplateBaseUrl: () => null, recordingConfigured: () => true, recordingObjectKey: () => "recordings/x.mp4",
  recordingPublicUrl: (k: string) => k, recordingStorage: () => ({}), recordingVariant: () => "video", verifyRecordingObject: async () => ({ ok: true }),
}));
vi.mock("@/lib/recorder-control", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/recorder-control")>()), schedulerHint: async () => h.hint }));
vi.mock("@/lib/recorder", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/recorder")>()), startRecorderJob: h.startRecorder }));

import { ensureRecordingStarted } from "./class-recorder";

const input = { roomName: "ew-lagos-a1-morning-t-1", level: "a1", sessionSlot: "morning", tenantId: "t" };
const BASE = { RECORDING_BACKEND: "recorder", RECORDER_URL: "https://recorder.example", RECORDER_SHARED_SECRET: "s".repeat(40) };
const setEnv = (extra: Record<string, string> = {}) => {
  for (const k of ["RECORDING_BACKEND", "RECORDER_URL", "RECORDER_SHARED_SECRET", "RECORDER_FALLBACK", "RECORDER_FALLBACK_AFTER_MINUTES", "RECORDER_FALLBACK_MONTHLY_CAP_MINUTES", "RECORDER_FLEET"]) delete process.env[k];
  Object.assign(process.env, BASE, extra);
};
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);
const recorderRefuses = () => h.startRecorder.mockResolvedValue({ ok: false, reason: "at_capacity" });

beforeEach(() => {
  h.startRecorder.mockReset();
  h.startEgress.mockClear();
  h.notified.length = 0;
  h.recordings.length = 0;
  h.liveSession = null;
  h.hint = "";
  setEnv();
});

describe("our recorder takes the class", () => {
  it("LiveKit is not used and not paid, and nobody is bothered", async () => {
    h.startRecorder.mockResolvedValue({ ok: true, jobId: "s0a000001-abcdef0123456789", created: true });
    expect(await ensureRecordingStarted(input)).toBe("rec_s0a000001-abcdef0123456789");
    expect(h.startEgress).not.toHaveBeenCalled();
    expect(h.notified).toEqual([]);
  });
});

describe("our recorder cannot take the class", () => {
  it("immediate (the default): LiveKit steps in at once, and the admins are told it costs money", async () => {
    recorderRefuses();
    expect(await ensureRecordingStarted(input)).toBe("EG_livekit_1");
    expect(h.startEgress).toHaveBeenCalledTimes(1);
    expect(h.notified).toEqual([expect.objectContaining({ severity: "warning", title: expect.stringMatching(/costs money/) })]);
  });

  it("delayed: a young class WAITS (no LiveKit, no alarm) and is retried on the next heartbeat", async () => {
    setEnv({ RECORDER_FALLBACK: "delayed", RECORDER_FALLBACK_AFTER_MINUTES: "12" });
    recorderRefuses();
    h.liveSession = { startedAt: minutesAgo(3) };
    expect(await ensureRecordingStarted(input)).toBeNull();
    expect(h.startEgress).not.toHaveBeenCalled();
    expect(h.notified).toEqual([]);
  });

  it("delayed: and when a server turns up during the wait, the class is recorded by OUR recorder, LiveKit never paid", async () => {
    setEnv({ RECORDER_FALLBACK: "delayed" });
    h.liveSession = { startedAt: minutesAgo(3) };
    recorderRefuses();
    await ensureRecordingStarted(input); // first heartbeat: no server yet
    h.startRecorder.mockResolvedValue({ ok: true, jobId: "s0a000002-abcdef0123456789", created: true });
    expect(await ensureRecordingStarted(input)).toBe("rec_s0a000002-abcdef0123456789"); // a later heartbeat
    expect(h.startEgress).not.toHaveBeenCalled();
    expect(h.notified).toEqual([]);
  });

  it("delayed: after the wait with still no server, LiveKit steps in (and the admins are told)", async () => {
    setEnv({ RECORDER_FALLBACK: "delayed", RECORDER_FALLBACK_AFTER_MINUTES: "12" });
    recorderRefuses();
    h.liveSession = { startedAt: minutesAgo(13) };
    expect(await ensureRecordingStarted(input)).toBe("EG_livekit_1");
    expect(h.notified[0]).toMatchObject({ severity: "warning" });
  });

  it("the alert names the likely cause, so the office knows what to fix", async () => {
    h.hint = "The recorder scheduler has been silent for 25 minutes, so no server was started.";
    recorderRefuses();
    await ensureRecordingStarted(input);
    expect(h.notified[0]).toMatchObject({ message: expect.stringContaining("silent for 25 minutes") });
  });

  it("never: LiveKit is not used, and the admins are told the class is unrecorded", async () => {
    setEnv({ RECORDER_FALLBACK: "never" });
    recorderRefuses();
    h.liveSession = { startedAt: minutesAgo(30) };
    expect(await ensureRecordingStarted(input)).toBeNull();
    expect(h.startEgress).not.toHaveBeenCalled();
    expect(h.notified).toEqual([expect.objectContaining({ severity: "critical", title: expect.stringMatching(/without a recording/) })]);
  });

  it("recorder-only still means never", async () => {
    setEnv({ RECORDING_BACKEND: "recorder-only" });
    recorderRefuses();
    expect(await ensureRecordingStarted(input)).toBeNull();
    expect(h.startEgress).not.toHaveBeenCalled();
  });

  it("the monthly budget: LiveKit recording stops once it is used up, and the admins are told", async () => {
    setEnv({ RECORDER_FALLBACK_MONTHLY_CAP_MINUTES: "600" });
    h.recordings.push({ egressId: "EG_old", roomName: "other", status: "completed", durationSeconds: 610 * 60, startedAt: new Date() });
    recorderRefuses();
    expect(await ensureRecordingStarted(input)).toBeNull();
    expect(h.startEgress).not.toHaveBeenCalled();
    expect(h.notified).toEqual([expect.objectContaining({ severity: "critical", title: expect.stringMatching(/budget used up/) })]);
  });

  it("under budget, LiveKit still steps in", async () => {
    setEnv({ RECORDER_FALLBACK_MONTHLY_CAP_MINUTES: "600" });
    h.recordings.push({ egressId: "EG_old", roomName: "other", status: "completed", durationSeconds: 100 * 60, startedAt: new Date() });
    recorderRefuses();
    expect(await ensureRecordingStarted(input)).toBe("EG_livekit_1");
  });

  it("our own recorder's recordings do not count against the LiveKit budget", async () => {
    setEnv({ RECORDER_FALLBACK_MONTHLY_CAP_MINUTES: "60" });
    h.recordings.push({ egressId: "rec_s0a000001-aaaaaaaaaaaaaaaa", roomName: "other", status: "completed", durationSeconds: 5000 * 60, startedAt: new Date() });
    recorderRefuses();
    expect(await ensureRecordingStarted(input)).toBe("EG_livekit_1");
  });

  it("an unreachable recorder is treated the same as a full one", async () => {
    setEnv({ RECORDER_FALLBACK: "never" });
    h.startRecorder.mockResolvedValue({ ok: false, reason: "unreachable", detail: "ECONNREFUSED" });
    expect(await ensureRecordingStarted(input)).toBeNull();
  });
});

describe("with the recorder switched off entirely", () => {
  it("nothing changes: LiveKit records, exactly as before", async () => {
    setEnv({ RECORDING_BACKEND: "livekit" });
    expect(await ensureRecordingStarted(input)).toBe("EG_livekit_1");
    expect(h.startRecorder).not.toHaveBeenCalled();
    expect(h.notified).toEqual([]);
  });
});
