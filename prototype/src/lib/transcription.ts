/**
 * Speech-to-text, for turning a class recording into words.
 *
 * `ai.ts` already owns every hosted TEXT call. This is deliberately separate:
 * an ASR request is a multipart file upload with its own size ceiling and
 * failure modes, not a JSON chat body, and the two should not share a
 * function whose contract quietly changes shape depending on what you're
 * asking it to do.
 *
 * Runs on Groq's hosted Whisper — the same account and key that already
 * powers `callGroq` in ai.ts, so this adds no new vendor and no new bill.
 * There is no self-hosted fallback: real diarised, forced-aligned ASR
 * (pyannote and friends) is a GPU workload this RAM-constrained office
 * machine cannot run, and Azure was already declined for the pronunciation
 * feature on cost grounds — see [[project-voice-coach-upgrade]]. Do not
 * re-suggest a paid ASR vendor here for the same reason unless Groq's
 * quality or limits turn out to be the actual blocker.
 *
 * NO SPEAKER DIARIZATION. Whisper transcribes; it does not tell tutor from
 * student. `segments` carries timestamps only. A future pass could ask the
 * summarizer to *infer* "tutor" vs "students" from phrasing (questions vs
 * explanations), but that is a heuristic on top of the text, not a real
 * diarization model, and callers should not present it as one.
 */

import { guardedFetch } from "@/lib/guarded-fetch";

export type TranscriptSegment = { start: number; end: number; text: string };

export type TranscriptionResult = {
  text: string;
  segments: TranscriptSegment[];
};

const GROQ_WHISPER_MODEL = process.env.GROQ_WHISPER_MODEL || "whisper-large-v3-turbo";

/**
 * Send the file to Groq and get a transcript back.
 *
 * Deliberately does not pre-guess Groq's request-size limit and refuse
 * early — that number moves with their pricing tiers and a wrong guess here
 * would either block recordings that would have worked or waste a call on
 * ones that never could. Instead this tries the upload and reports exactly
 * what Groq said if it refuses, which is a real, current answer rather than
 * a number copied from documentation that may already be stale.
 */
export async function transcribeAudio(
  buffer: Buffer,
  filename: string,
): Promise<TranscriptionResult | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  /**
   * Whisper's free-tier budget is audio-SECONDS, both an hourly and a daily
   * cap, account-wide — and there is no sibling model to fall over to the way
   * the chat models have one another. A class recording's backlog can easily
   * ask for more audio-seconds than the daily cap holds, and every fresh
   * function invocation (the self-kicking runner chief among them) would
   * otherwise re-learn that by spending a real upload on a request that was
   * always going to be refused. See lib/ai-cooldown.ts.
   */
  const { groqCoolingDown, markGroqCooldown, parseGroqRetrySeconds } = await import("@/lib/ai-cooldown");
  if (await groqCoolingDown("groq-asr")) {
    throw new Error("Groq's speech-to-text free-tier limit is in use — resuming automatically once it frees up.");
  }

  try {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buffer)]), filename);
    form.append("model", GROQ_WHISPER_MODEL);
    form.append("response_format", "verbose_json");

    // A full class recording is a big upload and a slow answer, and this runs in the 300s
    // cron function — so a long deadline, but still a deadline.
    const response = await guardedFetch(
      "groq",
      "https://api.groq.com/openai/v1/audio/transcriptions",
      { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form },
      { timeoutMs: 240_000 },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      if (response.status === 429) {
        const seconds = parseGroqRetrySeconds(detail);
        if (seconds) void markGroqCooldown("groq-asr", seconds);
      }
      throw new Error(`Groq transcription ${response.status}: ${detail.slice(0, 500)}`);
    }

    const data = (await response.json()) as {
      text?: string;
      segments?: Array<{ start?: number; end?: number; text?: string }>;
    };

    const text = (data.text || "").trim();
    if (!text) return null;

    const segments: TranscriptSegment[] = (data.segments || [])
      .map((segment) => ({
        start: Number(segment.start) || 0,
        end: Number(segment.end) || 0,
        text: (segment.text || "").trim(),
      }))
      .filter((segment) => segment.text.length > 0);

    return { text, segments };
  } catch (error) {
    // Re-thrown, not swallowed: the caller (class-transcription.ts) is the
    // one place that knows how to turn this into a `failed`/`skipped_too_large`
    // status a human can actually see, rather than a console line nobody reads.
    throw error instanceof Error ? error : new Error(String(error));
  }
}
