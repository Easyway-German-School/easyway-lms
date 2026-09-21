import { execFile } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { withRangedProxy } from "@/lib/ranged-proxy";

const run = promisify(execFile);

/**
 * `ffmpeg-static` ships the binary, but on a serverless deploy the copy that
 * lands next to the function routinely loses its execute bit — `execFile` then
 * fails with EACCES and every extraction silently falls back. Put the bit back
 * once, here, so both extract paths can rely on it.
 *
 * Returns a short reason string when ffmpeg genuinely cannot be used, so the
 * caller can record WHY instead of a generic "extraction unavailable".
 */
function ensureFfmpeg(): { path: string } | { error: string } {
  if (!ffmpegPath) return { error: "ffmpeg-static resolved no binary path for this platform" };
  if (!existsSync(ffmpegPath)) return { error: `ffmpeg binary is missing at ${ffmpegPath} (not bundled into the deploy)` };
  try {
    accessSync(ffmpegPath, constants.X_OK);
  } catch {
    try {
      chmodSync(ffmpegPath, 0o755);
    } catch (chmodError) {
      return { error: `ffmpeg binary at ${ffmpegPath} is not executable and chmod failed: ${chmodError instanceof Error ? chmodError.message : String(chmodError)}` };
    }
  }
  return { path: ffmpegPath };
}

/** For the admin diagnostic — does ffmpeg actually run here, and what version. */
export async function ffmpegHealth(): Promise<{ ok: boolean; detail: string }> {
  const ready = ensureFfmpeg();
  if ("error" in ready) return { ok: false, detail: ready.error };
  try {
    const { stdout } = await run(ready.path, ["-version"], { timeout: 8000, maxBuffer: 1024 * 1024 });
    return { ok: true, detail: String(stdout).split("\n")[0] || "ffmpeg ran" };
  } catch (error) {
    return { ok: false, detail: `ffmpeg -version failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Strip a class recording down to what the ASR call actually needs: mono,
 * 16kHz (Whisper's own working rate — anything higher is thrown away
 * internally anyway), Opus at 32kbps.
 *
 * Why this exists: Groq's transcription endpoint rejects a request over a
 * size ceiling that measurement showed a real ~5-6 minute class clip already
 * exceeds at this app's video encoding (~696kbps combined) — see
 * [[project-class-notes-pipeline]]. Speech at 32kbps mono is roughly
 * 14MB/hour, comfortably under that ceiling for any class length this school
 * actually runs. The full-quality video is untouched — this only ever feeds
 * the ASR call, never playback.
 *
 * Returns null on any failure (binary missing, ffmpeg exits non-zero,
 * timeout) rather than throwing: the caller's fallback is simply to send the
 * original file to Groq as before, which is a real, already-tested code path,
 * not a broken one — losing the size reduction is a worse outcome than an
 * ASR call, not a broken feature.
 */
export async function extractAudioForAsr(
  input: Buffer,
  sourceFilename: string,
): Promise<{ buffer: Buffer; filename: string } | null> {
  const ready = ensureFfmpeg();
  if ("error" in ready) {
    console.error("[audio-extract]", ready.error);
    return null;
  }

  const dir = await mkdtemp(path.join(tmpdir(), "easyway-asr-"));
  const ext = path.extname(sourceFilename) || ".mp4";
  const inPath = path.join(dir, `in${ext}`);
  const outPath = path.join(dir, "out.ogg");

  try {
    await writeFile(inPath, input);

    // -vn: drop video entirely. -ac 1 -ar 16000: mono 16kHz, Whisper's own
    // native rate. -b:a 32k: plenty for intelligible speech, nowhere near
    // enough for music or ambience — irrelevant for a classroom recording.
    // A hard 10-minute timeout: a stuck ffmpeg process must not hang a cron
    // tick that has other recordings waiting behind it.
    await run(ready.path, ["-y", "-nostats", "-loglevel", "error", "-i", inPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "32k", outPath], {
      timeout: 10 * 60 * 1000,
      maxBuffer: 16 * 1024 * 1024,
    });

    const buffer = await readFile(outPath);
    if (buffer.length === 0) return null;
    return { buffer, filename: "audio.ogg" };
  } catch (error) {
    console.error("[audio-extract] falling back to the original file:", error);
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * The same strip-to-speech pass, but ffmpeg reads the source straight from a
 * URL (a presigned bucket link) instead of a local file.
 *
 * This is what makes a multi-GB class video transcribable on a serverless
 * function at all: ffmpeg range-requests the container, keeps the audio track,
 * throws away every video frame, and seeks to the `moov` atom over HTTP as
 * needed — so the video is never pulled into this process's memory or written
 * to /tmp. Output is the identical ~14MB/hour Opus `extractAudioForAsr`
 * produces. Returns null on any failure so the caller can fall back to the
 * in-memory path (which only works for a file small enough to hold).
 */
export type UrlExtractResult =
  | { buffer: Buffer; filename: string }
  | { error: string };

/**
 * How long ffmpeg may take when the caller does not say. Deliberately UNDER the
 * platform's 300 s function limit: the old 12-minute allowance was longer than
 * the function could live, so a slow recording was killed by the platform
 * (nothing saved, no reason recorded) instead of failing with a message.
 */
const DEFAULT_EXTRACT_TIMEOUT_MS = 200_000;

export async function extractAudioForAsrFromUrl(
  url: string,
  options: {
    timeoutMs?: number;
    /** Only this stretch of the recording: seek to `startSeconds`, keep `durationSeconds`. */
    startSeconds?: number;
    durationSeconds?: number;
  } = {},
): Promise<UrlExtractResult> {
  const ready = ensureFfmpeg();
  if ("error" in ready) return { error: ready.error };

  const timeout = Math.max(15_000, options.timeoutMs ?? DEFAULT_EXTRACT_TIMEOUT_MS);
  const dir = await mkdtemp(path.join(tmpdir(), "easyway-asr-url-"));
  const outPath = path.join(dir, "out.ogg");

  const extract = (input: string) =>
    run(
      ready.path,
      [
        "-y",
        "-nostdin",
        "-nostats",
        "-loglevel", "error",
        // Survive a CDN hiccup mid-download rather than failing the whole run.
        "-reconnect", "1",
        "-reconnect_streamed", "1",
        "-reconnect_delay_max", "30",
        // INPUT options (before -i): jump straight to the stretch using the
        // recording's index, so only that stretch is read instead of everything
        // before it.
        ...(options.startSeconds ? ["-ss", String(options.startSeconds)] : []),
        ...(options.durationSeconds ? ["-t", String(options.durationSeconds)] : []),
        "-i", input,
        "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "32k",
        outPath,
      ],
      { timeout, maxBuffer: 16 * 1024 * 1024 },
    );

  const started = Date.now();
  let served = 0;
  try {
    try {
      // The recording's index is at the END of the file, so ffmpeg reads the whole
      // thing — over one connection that was slower than the function may live.
      // Through the local parallel window it is a dozen connections.
      await withRangedProxy(url, async (localUrl, stats) => {
        try {
          await extract(localUrl);
        } finally {
          served = stats.bytesServed;
        }
      });
    } catch (error) {
      // Only a failure to SET UP the window (no size, no port) falls back to the
      // single connection; a real ffmpeg failure or timeout is reported as itself.
      const setup = error instanceof Error && /could not read the recording's size|EADDRINUSE|listen/i.test(error.message);
      if (!setup) throw error;
      console.error("[audio-extract] parallel window unavailable, reading directly:", error.message);
      await extract(url);
    }

    const buffer = await readFile(outPath);
    // A slice that starts at or past the end of the recording legitimately yields
    // (almost) nothing — an empty buffer, not an error. The caller decides.
    if (buffer.length === 0 && !options.startSeconds) return { error: "ffmpeg produced an empty audio file" };
    return { buffer, filename: "audio.ogg" };
  } catch (error) {
    // execFile's error carries ffmpeg's own stderr on `.stderr`.
    const err = error as { message?: string; stderr?: string; killed?: boolean; code?: number | string };
    const detail =
      (err.stderr && String(err.stderr).trim().split("\n").slice(-3).join(" | ")) ||
      err.message ||
      String(error);
    const seconds = Math.round((Date.now() - started) / 1000);
    const megabytes = Math.round(served / 1e6);
    const reason = err.killed
      ? `Reading the recording took longer than the ${Math.round(timeout / 1000)}s available (${megabytes} MB in ${seconds}s) — will retry with more time`
      : `ffmpeg failed (code ${err.code ?? "?"}) after ${megabytes} MB: ${detail}`;
    console.error("[audio-extract] URL extraction failed:", reason);
    return { error: reason.slice(0, 400) };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
