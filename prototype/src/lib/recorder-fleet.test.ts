import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DirectoryError,
  jobIdForServer,
  loadDirectory,
  parseDirectory,
  rankServers,
  resetDirectoryCache,
  serverForJobId,
  serverIdFromJobId,
  type RecorderDirectory,
} from "./recorder-directory";
import { getRecorderJob, recorderFleetMode, recorderSelected, startRecorderJob, stopRecorderJob } from "./recorder";

const NOW = new Date("2026-10-05T09:00:00Z");
const SECRET = "s".repeat(40);

const server = (id: string, capacity: number, active: number, url = `http://10.0.0.${parseInt(id.slice(-2), 16)}:8787`) => ({ id, url, capacity, active });
const dir = (...servers: ReturnType<typeof server>[]): RecorderDirectory => ({ version: 1, updatedAt: NOW.toISOString(), servers });

const A = "0a000001"; // 10.0.0.1
const B = "0a000002"; // 10.0.0.2
const C = "0a000003";

describe("reading the directory", () => {
  it("accepts a good one and keeps only each server's origin", () => {
    const d = parseDirectory({ version: 1, updatedAt: NOW.toISOString(), servers: [{ id: A, url: "http://10.0.0.1:8787/some/path", capacity: 5, active: 1 }] }, NOW);
    expect(d.servers).toEqual([{ id: A, url: "http://10.0.0.1:8787", capacity: 5, active: 1 }]);
  });

  it.each([
    ["a stale one", { version: 1, updatedAt: "2026-10-05T08:00:00Z", servers: [] }],
    ["the wrong version", { version: 2, updatedAt: NOW.toISOString(), servers: [] }],
    ["a bad server id", { version: 1, updatedAt: NOW.toISOString(), servers: [{ id: "nope", url: "http://x:1", capacity: 5, active: 0 }] }],
    ["a non-http address", { version: 1, updatedAt: NOW.toISOString(), servers: [{ id: A, url: "ftp://10.0.0.1", capacity: 5, active: 0 }] }],
    ["an address that is not a URL", { version: 1, updatedAt: NOW.toISOString(), servers: [{ id: A, url: "10.0.0.1", capacity: 5, active: 0 }] }],
    ["a silly capacity", { version: 1, updatedAt: NOW.toISOString(), servers: [{ id: A, url: "http://10.0.0.1:8787", capacity: 0, active: 0 }] }],
    ["no servers list", { version: 1, updatedAt: NOW.toISOString() }],
    ["garbage", "<html>"],
  ])("refuses %s", (_name, bad) => {
    expect(() => parseDirectory(bad, NOW)).toThrow(DirectoryError);
  });

  it("an empty directory is valid: simply no servers right now", () => {
    expect(parseDirectory(dir(), NOW).servers).toEqual([]);
  });
});

describe("choosing a server", () => {
  it("roomiest first; full ones are not offered work", () => {
    const ranked = rankServers(dir(server(A, 5, 4), server(B, 5, 0), server(C, 2, 2)));
    expect(ranked.map((s) => s.id)).toEqual([B, A]);
  });
  it("equal room is ordered by id, so the choice is stable", () => {
    expect(rankServers(dir(server(B, 5, 0), server(A, 5, 0))).map((s) => s.id)).toEqual([A, B]);
  });
});

describe("job ids that name their server", () => {
  it("round-trip", () => {
    const id = jobIdForServer({ id: A });
    expect(id).toMatch(/^s0a000001-[0-9a-f]{16}$/);
    expect(serverIdFromJobId(id)).toBe(A);
    expect(serverForJobId(dir(server(A, 5, 0)), id)?.id).toBe(A);
  });
  it("a server that is not in the directory (any more) is not found", () => {
    expect(serverForJobId(dir(server(B, 5, 0)), jobIdForServer({ id: A }))).toBeNull();
    expect(serverForJobId(null, jobIdForServer({ id: A }))).toBeNull();
  });
  it("an original-setup UUID job id names no server", () => {
    expect(serverIdFromJobId("e0857884-3081-4c8a-9f3b-1d5c7a2b9e10")).toBeNull();
    expect(serverIdFromJobId("garbage")).toBeNull();
  });
});

describe("loading the directory from the bucket", () => {
  beforeEach(resetDirectoryCache);
  const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
  const deps = (f: typeof fetch, at = NOW) => ({ signedUrl: async () => "https://bucket.example/fleet.json?sig=1", fetch: f, now: () => at });

  it("reads and validates it", async () => {
    expect((await loadDirectory(deps(reply(dir(server(A, 5, 0)))))!)?.servers).toHaveLength(1);
  });

  it("caches briefly so a burst of heartbeats is one read", async () => {
    const f = reply(dir(server(A, 5, 0)));
    await loadDirectory(deps(f));
    await loadDirectory(deps(f, new Date(NOW.getTime() + 5_000)));
    expect(f).toHaveBeenCalledTimes(1);
    await loadDirectory(deps(f, new Date(NOW.getTime() + 20_000)));
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("is null (never an exception) when the bucket fails, answers rubbish, or the file is stale", async () => {
    expect(await loadDirectory(deps(reply({}, 500)))).toBeNull();
    resetDirectoryCache();
    expect(await loadDirectory(deps(reply({ nope: true })))).toBeNull();
    resetDirectoryCache();
    expect(await loadDirectory(deps(reply({ version: 1, updatedAt: "2026-10-05T08:00:00Z", servers: [] })))).toBeNull();
    resetDirectoryCache();
    expect(await loadDirectory(deps((async () => { throw new Error("network"); }) as unknown as typeof fetch))).toBeNull();
  });

  it("is null when storage is not configured", async () => {
    expect(await loadDirectory({ signedUrl: async () => null, now: () => NOW })).toBeNull();
  });
});

describe("sending a recording to the fleet", () => {
  const env = {
    RECORDING_BACKEND: "recorder", RECORDER_FLEET: "1", RECORDER_SHARED_SECRET: SECRET,
    NEXT_PUBLIC_APP_URL: "https://school.example", LIVEKIT_URL: "wss://lk.example", LIVEKIT_API_KEY: "key", LIVEKIT_API_SECRET: "x".repeat(40),
  };
  const input = { roomName: "ew-lagos-a1-morning-t-1", objectKey: "recordings/a.mp4", jobId: "ignored-in-fleet-mode" };
  let posts: { url: string; body: { jobId: string; token: string } }[];

  /** Pretend recorders keyed by origin: each answers with a status. */
  function recorders(answers: Record<string, number | "down">) {
    posts = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
      const origin = new URL(url).origin;
      const body = init.body ? JSON.parse(String(init.body)) : {};
      posts.push({ url, body });
      const answer = answers[origin];
      if (answer === "down" || answer === undefined) throw new Error("connect ECONNREFUSED");
      if (answer === 202) return new Response(JSON.stringify({ created: true, job: { request: { jobId: body.jobId } } }), { status: 202 });
      return new Response(JSON.stringify({ error: "x" }), { status: answer });
    }));
  }
  const deps = (d: RecorderDirectory) => ({ signedUrl: async () => "https://b.example/f.json", fetch: (async () => new Response(JSON.stringify(d))) as unknown as typeof fetch, now: () => NOW });

  beforeEach(resetDirectoryCache);
  afterEach(() => vi.unstubAllGlobals());

  it("goes to the server with the most room, and the job id names it", async () => {
    recorders({ "http://10.0.0.1:8787": 202, "http://10.0.0.2:8787": 202 });
    const result = await startRecorderJob(input, env, deps(dir(server(A, 5, 4), server(B, 5, 0))));
    expect(result).toMatchObject({ ok: true, created: true });
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toBe("http://10.0.0.2:8787/v1/jobs");
    expect(posts[0]!.body.jobId).toMatch(/^s0a000002-/);
    expect((result as { jobId: string }).jobId).toBe(posts[0]!.body.jobId);
  });

  it("the room pass is minted for THAT job id", async () => {
    recorders({ "http://10.0.0.1:8787": 202 });
    await startRecorderJob(input, env, deps(dir(server(A, 5, 0))));
    const payload = JSON.parse(Buffer.from(posts[0]!.body.token.split(".")[1]!, "base64url").toString());
    expect(payload.sub).toBe(`recorder-${posts[0]!.body.jobId}`);
  });

  it("moves on to the next server when one is full (503)", async () => {
    recorders({ "http://10.0.0.1:8787": 503, "http://10.0.0.2:8787": 202 });
    const result = await startRecorderJob(input, env, deps(dir(server(A, 5, 0), server(B, 5, 1))));
    expect(result).toMatchObject({ ok: true });
    expect(posts.map((p) => new URL(p.url).origin)).toEqual(["http://10.0.0.1:8787", "http://10.0.0.2:8787"]);
  });

  it("moves on when a server cannot be reached", async () => {
    recorders({ "http://10.0.0.1:8787": "down", "http://10.0.0.2:8787": 202 });
    expect(await startRecorderJob(input, env, deps(dir(server(A, 5, 0), server(B, 5, 1))))).toMatchObject({ ok: true });
  });

  it("tries at most three servers, then reports why it failed (the class falls back to LiveKit)", async () => {
    recorders({ "http://10.0.0.1:8787": 503, "http://10.0.0.2:8787": 503, "http://10.0.0.3:8787": 503, "http://10.0.0.4:8787": 202 });
    const four = dir(server(A, 5, 0), server("0a000002", 5, 0), server("0a000003", 5, 0), server("0a000004", 5, 0));
    const result = await startRecorderJob(input, env, deps(four));
    expect(result).toEqual({ ok: false, reason: "at_capacity" });
    expect(posts).toHaveLength(3);
  });

  it("with no server open, does not even try the network", async () => {
    recorders({});
    expect(await startRecorderJob(input, env, deps(dir()))).toMatchObject({ ok: false, reason: "at_capacity" });
    expect(posts).toHaveLength(0);
  });

  it("with the directory unreadable, behaves the same (LiveKit takes the class)", async () => {
    recorders({});
    const broken = { signedUrl: async () => "https://b.example/f.json", fetch: (async () => new Response("no", { status: 500 })) as unknown as typeof fetch, now: () => NOW };
    expect(await startRecorderJob(input, env, broken)).toMatchObject({ ok: false, reason: "at_capacity" });
  });

  it("the original single-server mode is untouched: fixed URL, the caller's job id", async () => {
    recorders({ "https://recorder.example": 202 });
    const single = { ...env, RECORDER_FLEET: undefined, RECORDER_URL: "https://recorder.example" };
    const result = await startRecorderJob({ ...input, jobId: "11111111-2222-3333-4444-555555555555" }, single);
    expect(result).toMatchObject({ ok: true, jobId: "11111111-2222-3333-4444-555555555555" });
    expect(posts[0]!.url).toBe("https://recorder.example/v1/jobs");
  });
});

describe("stopping and checking a fleet job", () => {
  const env = { RECORDING_BACKEND: "recorder", RECORDER_FLEET: "1", RECORDER_SHARED_SECRET: SECRET };
  const deps = (d: RecorderDirectory) => ({ signedUrl: async () => "https://b.example/f.json", fetch: (async () => new Response(JSON.stringify(d))) as unknown as typeof fetch, now: () => NOW });
  beforeEach(resetDirectoryCache);
  afterEach(() => vi.unstubAllGlobals());

  it("go to the server the job id names", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { seen.push(url); return new Response(JSON.stringify({ job: { status: "recording" } })); }));
    const jobId = jobIdForServer({ id: B });
    expect(await stopRecorderJob(jobId, env, deps(dir(server(A, 5, 0), server(B, 5, 1))))).toBe(true);
    expect(await getRecorderJob(jobId, env, deps(dir(server(A, 5, 0), server(B, 5, 1))))).toMatchObject({ status: "recording" });
    expect(seen.every((u) => u.startsWith("http://10.0.0.2:8787/v1/jobs/"))).toBe(true);
  });

  it("a job whose server has been switched off: stop does nothing, status is 'the recorder has no record'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("must not be called"); }));
    const jobId = jobIdForServer({ id: C });
    expect(await stopRecorderJob(jobId, env, deps(dir(server(A, 5, 0))))).toBe(false);
    expect(await getRecorderJob(jobId, env, deps(dir(server(A, 5, 0))))).toBeNull();
  });

  it("an original-setup UUID job still goes to the fixed recorder", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { seen.push(url); return new Response(JSON.stringify({ job: { status: "done" } })); }));
    const withUrl = { ...env, RECORDER_URL: "https://recorder.example" };
    await getRecorderJob("11111111-2222-3333-4444-555555555555", withUrl, deps(dir()));
    expect(seen).toEqual(["https://recorder.example/v1/jobs/11111111-2222-3333-4444-555555555555"]);
  });
});

describe("which backend is selected", () => {
  it("fleet mode needs only the secret (there is no fixed address)", () => {
    expect(recorderSelected({ RECORDING_BACKEND: "recorder", RECORDER_FLEET: "1", RECORDER_SHARED_SECRET: SECRET })).toBe(true);
    expect(recorderFleetMode({ RECORDER_FLEET: "1" })).toBe(true);
  });
  it("is off unless asked for: unset flag, LiveKit backend, or a missing secret", () => {
    expect(recorderSelected({ RECORDING_BACKEND: "recorder", RECORDER_SHARED_SECRET: SECRET })).toBe(false);
    expect(recorderSelected({ RECORDING_BACKEND: "livekit", RECORDER_FLEET: "1", RECORDER_SHARED_SECRET: SECRET })).toBe(false);
    expect(recorderSelected({ RECORDING_BACKEND: "recorder", RECORDER_FLEET: "1" })).toBe(false);
    expect(recorderFleetMode({})).toBe(false);
  });
});
