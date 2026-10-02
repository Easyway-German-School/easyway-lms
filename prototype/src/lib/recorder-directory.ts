/**
 * Which recorder servers exist right now: the LMS's half of the fleet directory.
 *
 * The fleet manager (a separate project) creates recorder servers shortly before classes and deletes them
 * afterwards, so their addresses keep changing. It keeps a small `fleet.json` in the private recordings bucket
 * listing the ones that are running, answering and open for work. The LMS reads that (cached for a few seconds),
 * sends each new recording to a server with free room, and falls back to LiveKit's recording when there is none.
 *
 * Each job id starts with its server's id (`s<8 hex digits>-...`, the server's IPv4 address in hex), so stopping
 * or checking a job later goes to the right machine with no extra database column.
 *
 * Pure parts first (testable), then the bucket read.
 */

import { randomBytes } from "node:crypto";

export const DIRECTORY_KEY = "recordings/_recorder-release/fleet.json";

export type DirectoryServer = { id: string; url: string; capacity: number; active: number };
export type RecorderDirectory = { version: 1; updatedAt: string; servers: DirectoryServer[] };

/** The fleet republishes every few minutes; a directory much older than that is not to be trusted. */
export const DIRECTORY_MAX_AGE_MS = 10 * 60_000;

export class DirectoryError extends Error {}

/** Check the file and refuse anything garbled, stale, or pointing somewhere odd. */
export function parseDirectory(value: unknown, now: Date = new Date()): RecorderDirectory {
  const d = value as Partial<RecorderDirectory> | null;
  if (!d || typeof d !== "object") throw new DirectoryError("not an object");
  if (d.version !== 1) throw new DirectoryError(`unsupported version ${String(d.version)}`);
  const updated = Date.parse(String(d.updatedAt));
  if (!Number.isFinite(updated)) throw new DirectoryError("no valid updatedAt");
  if (now.getTime() - updated > DIRECTORY_MAX_AGE_MS) throw new DirectoryError("directory is stale");
  if (!Array.isArray(d.servers)) throw new DirectoryError("no servers list");
  const servers: DirectoryServer[] = [];
  for (const s of d.servers) {
    if (!s || typeof s.id !== "string" || !/^[0-9a-f]{8}$/.test(s.id)) throw new DirectoryError("a server has a bad id");
    let url: URL;
    try { url = new URL(String(s.url)); } catch { throw new DirectoryError("a server has a bad url"); }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new DirectoryError("a server url is not http(s)");
    if (!Number.isInteger(s.capacity) || s.capacity < 1 || s.capacity > 50) throw new DirectoryError("a server has a bad capacity");
    if (!Number.isInteger(s.active) || s.active < 0 || s.active > 200) throw new DirectoryError("a server has a bad active count");
    servers.push({ id: s.id, url: url.origin, capacity: s.capacity, active: s.active });
  }
  return { version: 1, updatedAt: String(d.updatedAt), servers };
}

/** Servers with room, the roomiest first (ties by id so the order is stable). Full ones are not offered work. */
export function rankServers(directory: RecorderDirectory): DirectoryServer[] {
  return directory.servers
    .filter((s) => s.capacity - s.active > 0)
    .sort((a, b) => b.capacity - b.active - (a.capacity - a.active) || a.id.localeCompare(b.id));
}

/** A job id that carries its server: `s` + 8 hex + `-` + 16 random characters. (A legacy UUID never starts with "s".) */
export function jobIdForServer(server: Pick<DirectoryServer, "id">): string {
  return `s${server.id}-${randomBytes(8).toString("hex")}`;
}

export function serverIdFromJobId(jobId: string): string | null {
  return /^s([0-9a-f]{8})-[A-Za-z0-9_-]{8,}$/.exec(jobId)?.[1] ?? null;
}

export function serverForJobId(directory: RecorderDirectory | null, jobId: string): DirectoryServer | null {
  const id = serverIdFromJobId(jobId);
  return id && directory ? directory.servers.find((s) => s.id === id) ?? null : null;
}

/* -------------------------------------------------------------------------- */
/* Reading it from the bucket                                                 */
/* -------------------------------------------------------------------------- */

const CACHE_MS = 15_000;
let cache: { at: number; directory: RecorderDirectory | null } | null = null;

/** For tests. */
export function resetDirectoryCache(): void {
  cache = null;
}

export type DirectoryDeps = {
  /** A short-lived signed link to the directory object, or null if storage is not configured. */
  signedUrl?: () => Promise<string | null>;
  fetch?: typeof fetch;
  now?: () => Date;
};

/**
 * The current directory, or null if it cannot be read, is stale, or is garbled. Never throws: "no recorder
 * available" simply means the class is recorded the existing way. Cached briefly because every tutor
 * heartbeat could otherwise cause a bucket read.
 */
export async function loadDirectory(deps: DirectoryDeps = {}): Promise<RecorderDirectory | null> {
  const now = (deps.now ?? (() => new Date()))();
  if (cache && now.getTime() - cache.at < CACHE_MS) return cache.directory;
  let directory: RecorderDirectory | null = null;
  try {
    const signedUrl = deps.signedUrl ?? (async () => (await import("@/lib/storage")).signedGetUrl(DIRECTORY_KEY, 120));
    const url = await signedUrl();
    if (url) {
      const response = await (deps.fetch ?? fetch)(url, { signal: AbortSignal.timeout(5_000), cache: "no-store" });
      if (response.ok) directory = parseDirectory(await response.json(), now);
      else console.error("Recorder server list could not be read: the bucket answered HTTP", response.status);
    } else {
      console.error("Recorder server list could not be read: no storage configured for recordings");
    }
  } catch (error) {
    console.error("Recorder server list could not be read:", error instanceof Error ? error.message : String(error));
    directory = null;
  }
  cache = { at: now.getTime(), directory };
  return directory;
}

/**
 * A fresh, uncached read of the directory that SAYS what went wrong, for the admin diagnostics. `loadDirectory`
 * swallows errors on purpose (a class must never fail because of this); this one reports them.
 */
export async function probeDirectory(deps: DirectoryDeps = {}): Promise<{ ok: boolean; servers: number; open: number; ageSeconds: number | null; error: string | null }> {
  const now = (deps.now ?? (() => new Date()))();
  try {
    const signedUrl = deps.signedUrl ?? (async () => (await import("@/lib/storage")).signedGetUrl(DIRECTORY_KEY, 120));
    const url = await signedUrl();
    if (!url) return { ok: false, servers: 0, open: 0, ageSeconds: null, error: "no storage is configured for recordings" };
    const response = await (deps.fetch ?? fetch)(url, { signal: AbortSignal.timeout(5_000), cache: "no-store" });
    if (!response.ok) return { ok: false, servers: 0, open: 0, ageSeconds: null, error: `the bucket answered HTTP ${response.status} for the server list` };
    const raw = (await response.json()) as { updatedAt?: string };
    const age = raw?.updatedAt ? Math.round((now.getTime() - Date.parse(raw.updatedAt)) / 1000) : null;
    const directory = parseDirectory(raw, now);
    return { ok: true, servers: directory.servers.length, open: rankServers(directory).length, ageSeconds: age, error: null };
  } catch (error) {
    return { ok: false, servers: 0, open: 0, ageSeconds: null, error: error instanceof Error ? error.message : String(error) };
  }
}
