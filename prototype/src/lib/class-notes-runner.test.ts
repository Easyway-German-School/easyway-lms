import { beforeEach, describe, expect, it, vi } from "vitest";

const aiCache = { create: vi.fn(), updateMany: vi.fn() };
const prisma = {
  aiCache,
  classRecording: { count: vi.fn(async () => 0) },
  material: { count: vi.fn(async () => 0) },
};
const processTranscriptionQueue = vi.fn();
const processMaterialQueue = vi.fn();
const groqCooldownUntil = vi.fn(async (_kind: string) => 0); // 0 = not cooling down, the default in every test unless overridden

vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/tenant/context", () => ({ runUnscoped: (_reason: string, fn: () => Promise<unknown>) => fn() }));
vi.mock("@/lib/class-transcription", () => ({
  MIN_RECORDING_START_MS: 100_000,
  processTranscriptionQueue,
  transcriptionBacklogWhere: () => ({}),
}));
vi.mock("@/lib/material-ai", () => ({ processMaterialQueue }));
vi.mock("@/lib/ai-cooldown", () => ({ groqCooldownUntil }));

// The first import pulls in Prisma's real error class; give a cold, busy machine room.
vi.setConfig({ testTimeout: 30_000 });

describe("runClassNotes", () => {
  beforeEach(() => {
    vi.resetModules();
    Object.values(aiCache).forEach((fn) => fn.mockReset());
    processTranscriptionQueue.mockReset();
    processMaterialQueue.mockReset();
    aiCache.create.mockResolvedValue({});
    aiCache.updateMany.mockResolvedValue({ count: 1 });
    processMaterialQueue.mockResolvedValue({ attempted: 0, ready: 0, skipped: 0 });
    groqCooldownUntil.mockReset();
    groqCooldownUntil.mockResolvedValue(0);
  });

  it("works recordings one at a time until the queue is empty, then releases the lease", async () => {
    processTranscriptionQueue
      .mockResolvedValueOnce({ attempted: 1, created: 1, failed: 0, partial: 0 })
      .mockResolvedValueOnce({ attempted: 1, created: 1, failed: 0, partial: 0 })
      .mockResolvedValueOnce({ attempted: 0, created: 0, failed: 0, partial: 0 });

    const { runClassNotes } = await import("./class-notes-runner");
    const summary = await runClassNotes({ budgetMs: 240_000 });

    expect(summary).toMatchObject({ ran: true, progressed: true });
    expect(summary.recordings.created).toBe(2);
    expect(processTranscriptionQueue).toHaveBeenCalledTimes(3);
    // Every call is handed the deadline so it can refuse a recording it cannot finish.
    expect(processTranscriptionQueue.mock.calls[0]).toEqual([1, { deadlineAt: expect.any(Number) }]);
    // Lease released (back-dated) at the end.
    const released = aiCache.updateMany.mock.calls.find(([arg]) => arg.data?.updatedAt);
    expect(released).toBeTruthy();
  });

  it("stops after three rounds that produced nothing instead of hammering a rate limit", async () => {
    processTranscriptionQueue.mockResolvedValue({ attempted: 1, created: 0, failed: 1, partial: 0 });

    const { runClassNotes } = await import("./class-notes-runner");
    const summary = await runClassNotes({ budgetMs: 240_000 });

    // Three empty rounds in a row is "stuck", not "slow".
    expect(processTranscriptionQueue).toHaveBeenCalledTimes(3);
    expect(summary.progressed).toBe(false);
  });

  it("counts getting further into a recording as progress, even before it is finished", async () => {
    processTranscriptionQueue
      .mockResolvedValueOnce({ attempted: 1, created: 0, failed: 0, partial: 1 })
      .mockResolvedValueOnce({ attempted: 1, created: 0, failed: 0, partial: 1 })
      .mockResolvedValueOnce({ attempted: 1, created: 0, failed: 0, partial: 1 })
      .mockResolvedValueOnce({ attempted: 0, created: 0, failed: 0, partial: 0 });

    const { runClassNotes } = await import("./class-notes-runner");
    const summary = await runClassNotes({ budgetMs: 240_000 });

    expect(processTranscriptionQueue).toHaveBeenCalledTimes(4); // did not stall out after three
    expect(summary).toMatchObject({ progressed: true });
    expect(summary.recordings.partial).toBe(3);
  });

  it("does not start a recording when the time left is too short to finish one", async () => {
    const { runClassNotes } = await import("./class-notes-runner");
    const summary = await runClassNotes({ budgetMs: 30_000 });

    expect(processTranscriptionQueue).not.toHaveBeenCalled();
    expect(summary.ran).toBe(true);
  });

  it("does nothing while another run holds the lease", async () => {
    const { Prisma } = await import("@prisma/client");
    aiCache.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }));
    aiCache.updateMany.mockResolvedValue({ count: 0 });

    const { runClassNotes } = await import("./class-notes-runner");
    const summary = await runClassNotes({ budgetMs: 240_000 });

    expect(summary.ran).toBe(false);
    expect(summary.reason).toMatch(/already/);
    expect(processTranscriptionQueue).not.toHaveBeenCalled();
  });

  it("takes over a lease left behind by a run that died", async () => {
    const { Prisma } = await import("@prisma/client");
    aiCache.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }));
    aiCache.updateMany.mockResolvedValue({ count: 1 });
    processTranscriptionQueue.mockResolvedValue({ attempted: 0, created: 0, failed: 0, partial: 0 });

    const { runClassNotes } = await import("./class-notes-runner");
    const summary = await runClassNotes({ budgetMs: 240_000 });

    expect(summary.ran).toBe(true);
    // The steal is conditional on the lease being older than the run could last.
    const steal = aiCache.updateMany.mock.calls[0][0];
    expect(steal.where.updatedAt.lt).toBeInstanceOf(Date);
  });

  it("skips recordings entirely while Whisper's free-tier quota is out — there is no sibling model to fall back to", async () => {
    const until = Date.now() + 5 * 60_000;
    groqCooldownUntil.mockImplementation(async (kind: string) => (kind === "groq-asr" ? until : 0));
    processMaterialQueue.mockResolvedValueOnce({ attempted: 1, ready: 1, skipped: 0 }).mockResolvedValue({ attempted: 0, ready: 0, skipped: 0 });

    const { runClassNotes } = await import("./class-notes-runner");
    const summary = await runClassNotes({ budgetMs: 240_000 });

    expect(processTranscriptionQueue).not.toHaveBeenCalled();
    expect(summary.coolingDown.asrUntil).toBe(until);
    // Handouts still get worked — the chat models have a fallback ASR does not.
    expect(processMaterialQueue).toHaveBeenCalled();
    expect(summary.documents.ready).toBe(1);
  });

  it("skips handouts while the chat models' quota is out, but still works recordings", async () => {
    const until = Date.now() + 5 * 60_000;
    groqCooldownUntil.mockImplementation(async (kind: string) => (kind === "groq-chat" ? until : 0));
    processTranscriptionQueue
      .mockResolvedValueOnce({ attempted: 1, created: 1, failed: 0, partial: 0 })
      .mockResolvedValue({ attempted: 0, created: 0, failed: 0, partial: 0 });

    const { runClassNotes } = await import("./class-notes-runner");
    const summary = await runClassNotes({ budgetMs: 240_000 });

    expect(processMaterialQueue).not.toHaveBeenCalled();
    expect(summary.coolingDown.chatUntil).toBe(until);
    expect(summary.recordings.created).toBe(1);
  });

  it("notices a quota going out mid-run and stops trying more recordings against the same wall", async () => {
    let cooling = false;
    groqCooldownUntil.mockImplementation(async (kind: string) => (kind === "groq-asr" && cooling ? Date.now() + 60_000 : 0));
    processTranscriptionQueue.mockImplementation(async () => {
      cooling = true; // the first attempt is what discovers the 429 and marks the flag
      return { attempted: 1, created: 0, failed: 1, partial: 0 };
    });

    const { runClassNotes } = await import("./class-notes-runner");
    await runClassNotes({ budgetMs: 240_000 });

    // One attempt — not the usual three failed rounds — because the second
    // check saw the quota was now known to be out and stopped immediately.
    expect(processTranscriptionQueue).toHaveBeenCalledTimes(1);
  });
});

describe("kickClassNotes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("refuses without a secret or an address (so callers can fall back)", async () => {
    delete process.env.CRON_SECRET;
    const { kickClassNotes } = await import("./class-notes-runner");
    expect(await kickClassNotes("https://example.test")).toBe(false);
  });

  it("calls the notes route with the secret", async () => {
    process.env.CRON_SECRET = "s3cret";
    const fetchMock = vi.fn(async () => new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const { kickClassNotes } = await import("./class-notes-runner");

    expect(await kickClassNotes("https://easyway.test/")).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toBe("https://easyway.test/api/cron/class-notes");
    expect(init.headers.authorization).toBe("Bearer s3cret");
  });

  it("never throws when the site cannot be reached", async () => {
    process.env.CRON_SECRET = "s3cret";
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const { kickClassNotes } = await import("./class-notes-runner");
    expect(await kickClassNotes("https://easyway.test")).toBe(false);
  });
});
