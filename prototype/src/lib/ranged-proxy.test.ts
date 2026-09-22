import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { withRangedProxy } from "./ranged-proxy";

/**
 * A fake bucket: serves a known buffer and honours `Range` like B2/S3 do (206 +
 * Content-Range), optionally failing the first request for a piece.
 */
function startBucket(file: Buffer, options: { failFirstPieceRequests?: boolean } = {}) {
  const seen = new Set<string>();
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    const range = String(req.headers.range ?? "").match(/^bytes=(\d+)-(\d*)$/);
    requests.push(String(req.headers.range));
    if (!range) {
      res.writeHead(200, { "Content-Length": String(file.length) });
      res.end(file);
      return;
    }
    if (options.failFirstPieceRequests && !seen.has(range[0])) {
      seen.add(range[0]);
      res.writeHead(503);
      res.end();
      return;
    }
    const start = Number(range[1]);
    const end = range[2] === "" ? file.length - 1 : Math.min(file.length - 1, Number(range[2]));
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${file.length}`,
      "Content-Length": String(end - start + 1),
    });
    res.end(file.subarray(start, end + 1));
  });
  return new Promise<{ url: string; requests: string[]; close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/file.mp4`,
        requests,
        close: () => new Promise<void>((done) => { server.closeAllConnections?.(); server.close(() => done()); }),
      });
    });
  });
}

const FILE = Buffer.alloc(3 * 1024 * 1024 + 12_345);
for (let i = 0; i < FILE.length; i += 1) FILE[i] = (i * 31 + (i >> 8)) & 0xff;

async function read(localUrl: string, range?: string): Promise<{ status: number; body: Buffer; contentRange: string | null }> {
  const res = await fetch(localUrl, range ? { headers: { Range: range } } : {});
  return { status: res.status, body: Buffer.from(await res.arrayBuffer()), contentRange: res.headers.get("content-range") };
}

describe("withRangedProxy", () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    await close?.();
    close = null;
  });

  it("serves the whole file byte-for-byte, fetched in pieces", async () => {
    const bucket = await startBucket(FILE);
    close = bucket.close;
    const out = await withRangedProxy(
      bucket.url,
      async (local, stats) => ({ result: await read(local), stats }),
      { chunkBytes: 256 * 1024, concurrency: 6 },
    );
    expect(out.result.status).toBe(200);
    expect(out.result.body.equals(FILE)).toBe(true);
    // 3.1 MB in 256 KB pieces is a dozen-odd requests, not one — that is the point.
    expect(out.stats.upstreamRequests).toBeGreaterThan(10);
  });

  it("answers a range from the middle exactly, with the right Content-Range", async () => {
    const bucket = await startBucket(FILE);
    close = bucket.close;
    const start = 1_000_003;
    const out = await withRangedProxy(bucket.url, (local) => read(local, `bytes=${start}-`), { chunkBytes: 200_000 });
    expect(out.status).toBe(206);
    expect(out.contentRange).toBe(`bytes ${start}-${FILE.length - 1}/${FILE.length}`);
    expect(out.body.equals(FILE.subarray(start))).toBe(true);
  });

  it("answers a bounded range and a 'last N bytes' range (where an mp4's index lives)", async () => {
    const bucket = await startBucket(FILE);
    close = bucket.close;
    await withRangedProxy(bucket.url, async (local) => {
      const bounded = await read(local, "bytes=100-4999");
      expect(bounded.body.equals(FILE.subarray(100, 5000))).toBe(true);
      const tail = await read(local, "bytes=-777");
      expect(tail.body.equals(FILE.subarray(FILE.length - 777))).toBe(true);
    });
  });

  it("retries a piece the bucket refuses once", async () => {
    const bucket = await startBucket(FILE, { failFirstPieceRequests: true });
    close = bucket.close;
    const out = await withRangedProxy(bucket.url, (local) => read(local), { chunkBytes: 512 * 1024, concurrency: 3, retries: 3 });
    expect(out.body.equals(FILE)).toBe(true);
  });

  it("does not open all its streams at once for a read that is about to be abandoned", async () => {
    const bucket = await startBucket(FILE);
    close = bucket.close;
    await withRangedProxy(
      bucket.url,
      async (local) => {
        // Start a read and walk away after the first bytes — what ffmpeg does when it seeks.
        const controller = new AbortController();
        const res = await fetch(local, { signal: controller.signal });
        const reader = res.body!.getReader();
        await reader.read();
        controller.abort();
      },
      { chunkBytes: 128 * 1024, concurrency: 10 },
    );
    // Ramped: nowhere near the 25 pieces the file has (or the ten a flat window would open).
    const pieceRequests = bucket.requests.filter((r) => r !== "bytes=0-0");
    expect(pieceRequests.length).toBeLessThan(8);
  });

  it("refuses cleanly when the file's size cannot be read (an expired link)", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(403);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    close = () => new Promise<void>((done) => server.close(() => done()));
    const { port } = server.address() as AddressInfo;
    await expect(withRangedProxy(`http://127.0.0.1:${port}/expired`, async () => "unreachable")).rejects.toThrow(
      /could not read the recording's size/,
    );
  });
});
