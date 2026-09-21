import { beforeEach, describe, expect, it, vi } from "vitest";

const aiCache = { create: vi.fn(), updateMany: vi.fn() };
const prisma = {
  aiCache,
  classRecording: { count: vi.fn(async () => 0) },
  material: { count: vi.fn(async () => 0) },
};
const processTranscriptionQueue = vi.fn();
const processMaterialQueue = vi.fn();

vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/tenant/context", () => ({ runUnscoped: (_reason: string, fn: () => Promise<unknown>) => fn() }));
vi.mock("@/lib/class-transcription", () => ({
  MIN_RECORDING_START_MS: 100_000,
  processTranscriptionQueue,
  transcriptionBacklogWhere: () => ({}),
}));
vi.mock("@/lib/material-ai", () => ({ processMaterialQueue }));

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
