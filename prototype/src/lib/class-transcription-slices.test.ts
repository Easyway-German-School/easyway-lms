import { beforeEach, describe, expect, it, vi } from "vitest";

const update = vi.fn(async () => ({}));
const extract = vi.fn();
const transcribe = vi.fn();

vi.mock("@/lib/prisma", () => ({ prisma: { classTranscript: { update } } }));
vi.mock("@/lib/ai-cache", () => ({ cached: async (_t: string, _k: string, gen: () => Promise<unknown>) => gen() }));
vi.mock("@/lib/storage", () => ({ getFile: async () => null, signedGetUrl: async () => null }));
vi.mock("@/lib/audio-extract", () => ({ extractAudioForAsr: async () => null, extractAudioForAsrFromUrl: extract }));
vi.mock("@/lib/transcription", () => ({ transcribeAudio: transcribe }));
vi.mock("@/lib/notify", () => ({ notifyInBackground: () => {}, KIND: {} }));
vi.mock("@/lib/learner-intelligence", () => ({ profileFor: async () => ({ summary: "" }) }));

// The first import pulls in a lot of modules; give a cold, busy machine room.
vi.setConfig({ testTimeout: 30_000 });

const AUDIO = { buffer: Buffer.alloc(50_000), filename: "audio.ogg" };
const soon = () => Date.now() + 240_000;

/**
 * A class recording used to be one indivisible job. When reading it took longer than
 * the function may live, the platform killed the run and nothing was kept, so the
 * next attempt started from zero and died the same way. These pin the slicing that
 * makes a slow read just "more runs".
 */
describe("transcribeInSlices", () => {
  beforeEach(() => {
    update.mockClear();
    extract.mockReset();
    transcribe.mockReset();
    extract.mockResolvedValue(AUDIO);
    transcribe.mockImplementation(async () => ({ text: "Hallo Klasse.", segments: [{ start: 0, end: 4, text: "Hallo Klasse." }] }));
  });

  it("walks the recording slice by slice and puts every timestamp on the recording's own clock", async () => {
    const { transcribeInSlices, SLICE_SECONDS } = await import("./class-transcription");
    const result = await transcribeInSlices({
      classRecordingId: "r1", url: "https://bucket/x", totalSeconds: SLICE_SECONDS * 2 + 60,
      until: 0, text: "", segments: [], deadlineAt: soon(),
    });

    expect(result.kind).toBe("done");
    if (result.kind !== "done") return;
    expect(extract.mock.calls.map(([, opts]) => [opts.startSeconds, opts.durationSeconds])).toEqual([
      [0, SLICE_SECONDS],
      [SLICE_SECONDS, SLICE_SECONDS],
      [SLICE_SECONDS * 2, 60], // the last slice is only as long as what is left
    ]);
    expect(result.segments.map((s) => s.start)).toEqual([0, SLICE_SECONDS, SLICE_SECONDS * 2]);
    expect(result.text).toBe("Hallo Klasse. Hallo Klasse. Hallo Klasse.");
  });

  it("saves progress after every slice, so nothing is lost if the run is cut off", async () => {
    const { transcribeInSlices, SLICE_SECONDS } = await import("./class-transcription");
    // Snapshot at call time: the row is serialised when it is written, so what matters is
    // what it held THEN (the same array keeps growing afterwards).
    const saved: Array<{ until: number; count: number }> = [];
    (update as unknown as { mockImplementation: (fn: (arg: { data: { transcribedUntil: number; segments: unknown[] } }) => Promise<object>) => void })
      .mockImplementation(async (arg) => {
        saved.push({ until: arg.data.transcribedUntil, count: arg.data.segments.length });
        return {};
      });
    await transcribeInSlices({
      classRecordingId: "r1", url: "u", totalSeconds: SLICE_SECONDS * 2,
      until: 0, text: "", segments: [], deadlineAt: soon(),
    });

    expect(saved).toEqual([
      { until: SLICE_SECONDS, count: 1 },
      { until: SLICE_SECONDS * 2, count: 2 },
    ]);
  });

  it("resumes from where it stopped instead of starting over", async () => {
    const { transcribeInSlices, SLICE_SECONDS } = await import("./class-transcription");
    const already = [{ start: 0, end: 4, text: "schon da" }];
    const result = await transcribeInSlices({
      classRecordingId: "r1", url: "u", totalSeconds: SLICE_SECONDS * 2,
      until: SLICE_SECONDS, text: "schon da", segments: already, deadlineAt: soon(),
    });

    expect(extract).toHaveBeenCalledTimes(1);
    expect(extract.mock.calls[0][1].startSeconds).toBe(SLICE_SECONDS);
    if (result.kind === "done") expect(result.segments).toHaveLength(2); // the old one kept, one added
  });

  it("stops before a slice it cannot finish, keeps what it has, and says it made progress", async () => {
    const { transcribeInSlices, SLICE_SECONDS } = await import("./class-transcription");
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const deadlineAt = Date.now() + 100_000; // room for about one slice
      extract.mockImplementation(async () => {
        vi.advanceTimersByTime(60_000); // reading that slice took a minute
        return AUDIO;
      });

      const result = await transcribeInSlices({
        classRecordingId: "r1", url: "u", totalSeconds: SLICE_SECONDS * 6,
        until: 0, text: "", segments: [], deadlineAt,
      });

      expect(result).toMatchObject({ kind: "partial", progressed: true });
      expect(extract).toHaveBeenCalledTimes(1); // it did NOT start a second it could not finish
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports WHY when the very first read is too slow, and did not progress", async () => {
    const { transcribeInSlices } = await import("./class-transcription");
    extract.mockResolvedValue({ error: "Reading the recording took longer than the 150s available (40 MB in 150s)" });

    const result = await transcribeInSlices({
      classRecordingId: "r1", url: "u", totalSeconds: 3600, until: 0, text: "", segments: [], deadlineAt: soon(),
    });

    expect(result).toEqual({ kind: "partial", progressed: false, reason: expect.stringContaining("took longer") });
    expect(update).not.toHaveBeenCalled(); // nothing to save
  });

  it("skips a silent stretch but still moves on", async () => {
    const { transcribeInSlices, SLICE_SECONDS } = await import("./class-transcription");
    transcribe.mockResolvedValueOnce(null); // whisper heard nothing in slice one
    const result = await transcribeInSlices({
      classRecordingId: "r1", url: "u", totalSeconds: SLICE_SECONDS * 2, until: 0, text: "", segments: [], deadlineAt: soon(),
    });

    expect(result.kind).toBe("done");
    if (result.kind === "done") expect(result.segments).toHaveLength(1);
  });

  it("finishes a recording of unknown length when it runs off the end", async () => {
    const { transcribeInSlices } = await import("./class-transcription");
    extract
      .mockResolvedValueOnce(AUDIO)
      .mockResolvedValueOnce({ buffer: Buffer.alloc(300), filename: "audio.ogg" }); // just a container header

    const result = await transcribeInSlices({
      classRecordingId: "r1", url: "u", totalSeconds: null, until: 0, text: "", segments: [], deadlineAt: soon(),
    });

    expect(result.kind).toBe("done");
    expect(extract).toHaveBeenCalledTimes(2);
  });
});

describe("offsetSegments", () => {
  it("shifts both ends without touching the text", async () => {
    const { offsetSegments } = await import("./class-transcription");
    expect(offsetSegments([{ start: 1, end: 3.5, text: "x" }], 600)).toEqual([{ start: 601, end: 603.5, text: "x" }]);
  });
});
