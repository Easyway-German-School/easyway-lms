import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";

const run = promisify(execFile);

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
  if (!ffmpegPath) return null;

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
    await run(ffmpegPath, ["-y", "-i", inPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "32k", outPath], {
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
