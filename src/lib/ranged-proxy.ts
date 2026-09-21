import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A LOCAL, PARALLEL-DOWNLOADING WINDOW ONTO A REMOTE FILE, for programs (ffmpeg)
 * that can only read one URL one stream at a time.
 *
 * WHY THIS EXISTS. LiveKit writes a class recording as `ftyp, mdat, moov` — the
 * index is at the END of the file — so to pull out the audio, ffmpeg has to read
 * the file's index and then read the whole thing from the start. Over HTTP that
 * is ONE connection to the bucket. From a serverless function to a bucket on the
 * other side of the Atlantic, a single connection moves a few MB a second, so a
 * 1–2 GB recording (1080p at 3 Mbps) took longer than the function is allowed to
 * live: the platform killed it at 300 s, nothing was saved, and the next attempt
 * did the same. Measured: ffmpeg reads the entire file (66 MB of a 66 MB test
 * recording, 2 seeks) — so the fix is bandwidth, not cleverness.
 *
 * WHAT IT DOES. Starts a tiny HTTP server on 127.0.0.1 that answers `Range`
 * requests by fetching the upstream file in fixed-size pieces, several at a time,
 * and writing them out IN ORDER. To the caller it is an ordinary seekable file;
 * underneath it is a dozen connections instead of one. Memory is bounded to
 * `concurrency × chunkBytes` (~96 MB by default), and nothing touches disk.
 *
 * It never reads more than was asked for: when the caller seeks (ffmpeg jumps to
 * the index, then back to the start) the in-flight downloads for the abandoned
 * range are cancelled.
 */

export type RangedProxyOptions = {
  /** Size of each upstream request. Big enough to amortise the round trip. */
  chunkBytes?: number;
  /** How many pieces are in flight at once. */
  concurrency?: number;
  /** Retries per piece before the whole read is failed. */
  retries?: number;
};

export type RangedProxyStats = { bytesServed: number; upstreamRequests: number };

const DEFAULTS = { chunkBytes: 4 * 1024 * 1024, concurrency: 10, retries: 3 };

async function fetchPiece(url: string, start: number, end: number, signal: AbortSignal, retries: number): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal });
      // 206 is the answer to a range; 200 means the server ignored it and sent
      // the whole file, which we must not treat as this piece.
      if (res.status !== 206) throw new Error(`upstream answered ${res.status} to a range request`);
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length !== end - start + 1) throw new Error(`upstream sent ${body.length} bytes, expected ${end - start + 1}`);
      return body;
    } catch (error) {
      lastError = error;
      if (signal.aborted) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** The remote file's size, from a one-byte range request (works on a URL signed for GET). */
async function remoteSize(url: string): Promise<number> {
  let answered = "no answer";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { Range: "bytes=0-0" } });
      await res.arrayBuffer().catch(() => undefined);
      const total = Number(res.headers.get("content-range")?.match(/\/(\d+)$/)?.[1]);
      if (res.status === 206 && Number.isFinite(total) && total > 0) return total;
      answered = `upstream answered ${res.status}`;
      // A 4xx (an expired or wrong link) will say the same thing again; only a 5xx or a blip is worth another go.
      if (res.status >= 400 && res.status < 500) break;
    } catch (error) {
      answered = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
  }
  throw new Error(`could not read the recording's size (${answered})`);
}

/**
 * Run `work` with a local URL that serves `remoteUrl` fast. The server is torn
 * down when `work` settles, whether it resolved or threw.
 */
export async function withRangedProxy<T>(
  remoteUrl: string,
  work: (localUrl: string, stats: RangedProxyStats) => Promise<T>,
  options: RangedProxyOptions = {},
): Promise<T> {
  const { chunkBytes, concurrency, retries } = { ...DEFAULTS, ...options };
  const size = await remoteSize(remoteUrl);
  const stats: RangedProxyStats = { bytesServed: 0, upstreamRequests: 0 };

  const server = http.createServer((req, res) => {
    const range = String(req.headers.range ?? "").match(/^bytes=(\d*)-(\d*)$/);
    let start = 0;
    let end = size - 1;
    if (range) {
      if (range[1] === "" && range[2] !== "") {
        // "the last N bytes"
        start = Math.max(0, size - Number(range[2]));
      } else {
        start = range[1] === "" ? 0 : Number(range[1]);
        if (range[2] !== "") end = Math.min(size - 1, Number(range[2]));
      }
    }
    if (start > end || start >= size) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` });
      res.end();
      return;
    }

    res.writeHead(range ? 206 : 200, {
      "Accept-Ranges": "bytes",
      "Content-Type": "video/mp4",
      "Content-Length": String(end - start + 1),
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }

    // Cancelled the moment the reader goes away (ffmpeg seeking elsewhere).
    const abort = new AbortController();
    res.on("close", () => abort.abort());

    const pieces: Array<{ start: number; end: number }> = [];
    for (let at = start; at <= end; at += chunkBytes) pieces.push({ start: at, end: Math.min(end, at + chunkBytes - 1) });

    // A sliding window: piece i+concurrency is requested as soon as piece i is
    // written, so the pipe stays full but memory stays bounded.
    const inflight = new Map<number, Promise<Buffer>>();
    const request = (index: number) => {
      if (index >= pieces.length || inflight.has(index)) return;
      stats.upstreamRequests += 1;
      const promise = fetchPiece(remoteUrl, pieces[index].start, pieces[index].end, abort.signal, retries);
      promise.catch(() => undefined); // surfaced where it is awaited; never an unhandled rejection
      inflight.set(index, promise);
    };

    void (async () => {
      try {
        // RAMP UP, like TCP slow start. A reader that is about to seek elsewhere
        // (ffmpeg opens at byte 0, then jumps to the index at the end) abandons
        // whatever was in flight; opening ten streams for a read that lasts a
        // heartbeat wastes ten pieces of bandwidth. Two to start, one more for
        // every piece actually consumed, up to the cap.
        let window = Math.min(2, concurrency);
        for (let i = 0; i < Math.min(window, pieces.length); i += 1) request(i);
        for (let i = 0; i < pieces.length; i += 1) {
          const piece = await inflight.get(i)!;
          inflight.delete(i);
          window = Math.min(concurrency, window + 1);
          for (let j = i + 1; j < i + 1 + window; j += 1) request(j);
          stats.bytesServed += piece.length;
          if (!res.write(piece)) await new Promise<void>((resolve) => res.once("drain", resolve));
          if (abort.signal.aborted) return;
        }
        res.end();
      } catch (error) {
        if (!abort.signal.aborted) {
          console.error("[ranged-proxy] read failed:", error instanceof Error ? error.message : error);
        }
        res.destroy();
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  try {
    const { port } = server.address() as AddressInfo;
    return await work(`http://127.0.0.1:${port}/recording.mp4`, stats);
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
