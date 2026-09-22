import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getFile, signedGetUrl } from "@/lib/storage";
import { transcribeAudio, type TranscriptSegment, type TranscriptionResult } from "@/lib/transcription";
import { extractAudioForAsr, extractAudioForAsrFromUrl } from "@/lib/audio-extract";
import { callModel, activeModelName, aiTextAvailable, promptCharBudget } from "@/lib/ai";
import { buildExtractiveNotes, condenseSegments } from "@/lib/extractive-notes";
import { cached } from "@/lib/ai-cache";
import { parseModelJson } from "@/lib/safe-json";
import { profileFor } from "@/lib/learner-intelligence";
import { notifyInBackground, KIND } from "@/lib/notify";
import { formatClock } from "@/lib/video-library";

/**
 * The Happy-Scribe layer: recording → transcript → notes a student would
 * actually open.
 *
 * Runs entirely in the background, driven by the same cron tick that already
 * summarises uploaded materials (see `material-ai.ts`) — never on a request
 * a student is waiting on. A class recording finishing encoding and its
 * transcript being ready are two separate, several-minutes-apart events;
 * this is the second one.
 *
 * Covers both group and private recordings, and treats them differently on
 * purpose. A group class transcript has, realistically, one tutor and a
 * roomful of student voices this pipeline cannot tell apart — Whisper has no
 * diarization, so anything claiming to attribute a specific line to a
 * specific student would be a guess dressed up as a fact. A private lesson
 * has exactly two participants, which is the one case this pipeline CAN
 * responsibly say more about: which corrections were given, and what
 * progress the tutor called out — see `buildPrivateNotesPrompt` and
 * `ClassTranscript.isPrivate`/`corrections`/`progressHighlights`.
 */

/**
 * The smallest transcript budget we will ever send: what fits in ONE request on
 * Groq's free tier (~8k tokens a minute, input and reply together). A talky
 * hour of class is 30-50k characters, so this is a selection of the class, not
 * all of it — see `condenseSegments`. A funded Claude gets a larger budget from
 * `promptCharBudget`.
 */
const SMALL_PROMPT_CHARS = 9_000;

/**
 * A transcript still marked transcribing/summarizing after this long was
 * abandoned mid-flight (the serverless function was killed at its time limit),
 * not "in progress" — nothing else would ever pick it up again.
 */
const STALE_IN_FLIGHT_MS = 10 * 60 * 1000;

/** How long to leave an auto-outline alone after a failed attempt to upgrade it. */
const UPGRADE_RETRY_MS = 60 * 60 * 1000;

/**
 * The least time worth starting another recording with. One is a stream out of
 * the bucket, an ffmpeg pass, a speech-to-text call and a summary — minutes, not
 * seconds — and starting one that cannot finish just leaves it half-done until
 * it is reclaimed (see STALE_IN_FLIGHT_MS).
 */
export const MIN_RECORDING_START_MS = 90_000;

/** Provider tag for notes written with no model at all. */
export const EXTRACTIVE_PROVIDER = "extractive";

/**
 * A memory-safety ceiling on this function, not a claim about Groq's own
 * upload limit — pulling an arbitrarily large file into a serverless
 * function's memory to hand to `fetch` is the actual risk here. Groq's own
 * limit is whatever it is on the day this runs; if it rejects a smaller file
 * too, `transcribeAudio` throws and that becomes a `failed` row with Groq's
 * real error message attached, which is more trustworthy than a number typed
 * into this file drifting stale.
 */
const MAX_FETCH_BYTES = 200 * 1024 * 1024;

export type SpeakerRange = { from: number; to: number; speaker: "tutor" | "student" };

export type ClassNotes = {
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  vocabulary: Array<{ de: string; en: string; note?: string }>;
  /** Private lessons only — see the module comment for why a group class cannot honestly get these. */
  corrections?: Array<{ mistake: string; correction: string; note?: string }>;
  progressHighlights?: string[];
  /**
   * Both group and private. A COARSE tutor-vs-everyone-else guess over
   * `segments`' indices — see the schema comment on
   * `ClassTranscript.speakerRanges` for why this is honest where a per-
   * student label would not be.
   */
  speakerRanges?: SpeakerRange[];
};

/**
 * `[12] (03:05-03:11) text` per line — what lets the model reference a
 * segment by index (for `speakerRanges`) while a human reading the prompt
 * (or debugging it) can still see real timestamps. Truncates at a segment
 * boundary rather than mid-string, since a cut mid-line would break the
 * `[index]` an index-based range needs to line up with.
 */
function formatIndexedTranscript(segments: TranscriptSegment[], maxChars: number): { text: string; truncated: boolean } {
  const lineOf = (segment: TranscriptSegment, index: number) =>
    `[${index}] (${formatClock(segment.start)}-${formatClock(segment.end)}) ${segment.text}`;
  // A class longer than the budget used to be cut off at the point the budget
  // ran out, which loses the END — homework and "next time we will…" — first.
  // `condenseSegments` keeps the opening and closing lines and the most
  // instructive segments between, and the `[index]` on each line stays the
  // segment's real position so `speakerRanges` still lines up.
  const { picked, truncated } = condenseSegments(segments, (segment, index) => lineOf(segment, index).length + 1, maxChars);
  return { text: picked.map((index) => lineOf(segments[index], index)).join("\n"), truncated };
}

function coerceNotes(raw: unknown, opts: { isPrivate: boolean }): ClassNotes | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;

  const summary = String(value.summary ?? "").trim();
  if (!summary) return null;

  const keyPoints = (Array.isArray(value.keyPoints) ? value.keyPoints : [])
    .map((point) => String(point ?? "").trim())
    .filter(Boolean)
    .slice(0, 8);

  const actionItems = (Array.isArray(value.actionItems) ? value.actionItems : [])
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, 8);

  const vocabulary = (Array.isArray(value.vocabulary) ? value.vocabulary : [])
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const item = entry as Record<string, unknown>;
      const de = String(item.de ?? "").trim();
      const en = String(item.en ?? "").trim();
      if (!de || !en) return null;
      const note = String(item.note ?? "").trim();
      return note ? { de, en, note } : { de, en };
    })
    .filter((entry): entry is { de: string; en: string; note?: string } => entry !== null)
    .slice(0, 20);

  const notes: ClassNotes = { summary, keyPoints, actionItems, vocabulary };

  notes.speakerRanges = (Array.isArray(value.speakerRanges) ? value.speakerRanges : [])
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const item = entry as Record<string, unknown>;
      const from = Number(item.from);
      const to = Number(item.to);
      const speaker = item.speaker === "tutor" || item.speaker === "student" ? item.speaker : null;
      if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < from || !speaker) return null;
      return { from: Math.round(from), to: Math.round(to), speaker };
    })
    .filter((entry): entry is SpeakerRange => entry !== null)
    // A run-away or malformed reply naming thousands of tiny ranges is a
    // rendering problem, not a feature — this is generous for a genuinely
    // long class while still being a real ceiling.
    .slice(0, 400);

  if (!opts.isPrivate) return notes;

  notes.corrections = (Array.isArray(value.corrections) ? value.corrections : [])
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const item = entry as Record<string, unknown>;
      const mistake = String(item.mistake ?? "").trim();
      const correction = String(item.correction ?? "").trim();
      if (!mistake || !correction) return null;
      const note = String(item.note ?? "").trim();
      return note ? { mistake, correction, note } : { mistake, correction };
    })
    .filter((entry): entry is { mistake: string; correction: string; note?: string } => entry !== null)
    .slice(0, 15);

  notes.progressHighlights = (Array.isArray(value.progressHighlights) ? value.progressHighlights : [])
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, 8);

  return notes;
}

/**
 * Group-class prompt: notes about the CLASS. There is no reliable way to say
 * whose mistake a given line was with fifteen students in the room, so this
 * never asks for corrections or per-person progress — see the module comment.
 */
function buildNotesPrompt(input: { level: string | null; title: string; segments: TranscriptSegment[]; maxChars: number }): string {
  const { text, truncated } = formatIndexedTranscript(input.segments, input.maxChars);
  return [
    `You are turning a raw speech-to-text transcript of a live German class into notes a student can review later.`,
    `Class: "${input.title}"${input.level ? `, level ${input.level}` : ""}.`,
    `Each line below is one ASR segment: "[index] (start-end) text". There is no real speaker labelling — you cannot`,
    `reliably tell which of several students spoke — but the TUTOR's voice is usually distinguishable by phrasing`,
    `(explaining, instructing, asking the class a question) versus a student's (answering, asking their own question).`,
    truncated ? `The transcript below is a SELECTION of the most instructive lines of a longer class (the gaps in the index numbers are stretches left out); work only from what is given.` : "",
    "",
    "Transcript:",
    "---",
    text,
    "---",
    "",
    "Produce, in English except for the German being taught:",
    '1. "summary" — 2-3 sentences: what this class actually covered.',
    '2. "keyPoints" — 3-6 short bullets, the things worth remembering.',
    '3. "actionItems" — concrete follow-ups actually mentioned in class (homework, "bring X Thursday", "practice Y"). Empty array if none were said.',
    '4. "vocabulary" — every new German word or phrase this class taught, each as {"de","en","note"}. "note" is optional: a usage tip or the grammar point it illustrates, only when genuinely useful. Empty array if none.',
    '5. "speakerRanges" — group consecutive segments into runs of ONE voice talking, each as {"from","to","speaker"} using the segment indices above and speaker being ONLY "tutor" or "student" (never a name — you cannot tell which student). Cover the whole transcript with runs in order. If you genuinely cannot tell, skip that stretch rather than guessing — an incomplete list is fine, a wrong one is not.',
    "",
    "Do not invent anything not supported by the transcript. Reply with ONLY this JSON:",
    '{"summary":"…","keyPoints":["…"],"actionItems":["…"],"vocabulary":[{"de":"…","en":"…","note":"…"}],"speakerRanges":[{"from":0,"to":4,"speaker":"tutor"}]}',
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Private-class prompt: notes about the STUDENT. Exactly two voices in the
 * room is what makes "the tutor corrected this" and "the tutor praised that"
 * an honest claim rather than a guess — the same transcript run through this
 * prompt for a group class would be attributing lines to whichever of
 * fifteen students the model guessed at, which is not a feature, it's a
 * fabrication with good formatting.
 */
function buildPrivateNotesPrompt(input: { level: string | null; title: string; segments: TranscriptSegment[]; maxChars: number }): string {
  const { text, truncated } = formatIndexedTranscript(input.segments, input.maxChars);
  return [
    `You are turning a raw speech-to-text transcript of a private one-to-one German lesson into notes for the student.`,
    `There are exactly two voices in this transcript: the tutor and this one student. Each line below is one ASR`,
    `segment: "[index] (start-end) text". There is no real speaker labelling, but unlike a group class, turn-taking`,
    `and phrasing (a question vs. an explanation, a mistake vs. a correction) is usually enough to tell which is`,
    `which — use that, but say so only where the transcript actually supports it.`,
    `Lesson: "${input.title}"${input.level ? `, level ${input.level}` : ""}.`,
    truncated ? `The transcript below is a SELECTION of the most instructive lines of a longer lesson (the gaps in the index numbers are stretches left out); work only from what is given.` : "",
    "",
    "Transcript:",
    "---",
    text,
    "---",
    "",
    "Produce, in English except for the German being taught:",
    '1. "summary" — 2-3 sentences: what this lesson actually covered for this student.',
    '2. "keyPoints" — 3-6 short bullets.',
    '3. "actionItems" — concrete follow-ups the tutor actually gave this student. Empty array if none.',
    '4. "vocabulary" — every new German word or phrase taught, each as {"de","en","note"}. Empty array if none.',
    '5. "corrections" — mistakes this student made that the tutor corrected, each as {"mistake","correction","note"}. Only include ones clearly audible in the transcript. Empty array if none.',
    '6. "progressHighlights" — moments the tutor praised, or a visible improvement across the lesson (e.g. getting a construction right the second time after missing it the first). Empty array if none.',
    '7. "speakerRanges" — group consecutive segments into runs of one voice talking, each as {"from","to","speaker"} using the segment indices above and speaker being "tutor" or "student". Cover the whole transcript in order; skip a stretch you genuinely cannot call rather than guessing.',
    "",
    "Do not invent a correction or a mistake that is not actually in the transcript — an empty array is a better answer than a guess. Reply with ONLY this JSON:",
    '{"summary":"…","keyPoints":["…"],"actionItems":["…"],"vocabulary":[{"de":"…","en":"…","note":"…"}],"corrections":[{"mistake":"…","correction":"…","note":"…"}],"progressHighlights":["…"],"speakerRanges":[{"from":0,"to":4,"speaker":"tutor"}]}',
  ]
    .filter(Boolean)
    .join("\n");
}

/** Segments stored on a transcript row, validated — the column is untyped JSON. */
function readStoredSegments(value: unknown): TranscriptSegment[] | null {
  if (!Array.isArray(value)) return null;
  const segments = value
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const item = row as Record<string, unknown>;
      const text = String(item.text ?? "").trim();
      if (!text) return null;
      return { start: Number(item.start) || 0, end: Number(item.end) || 0, text };
    })
    .filter((row): row is TranscriptSegment => row !== null);
  return segments.length > 0 ? segments : null;
}

/**
 * Turn a transcript into notes. A model first, plain extraction as the floor.
 *
 * Whisper (the transcript) and the summariser are separate services, and only
 * the second one costs money or runs out. When no model can be reached — the
 * Claude account is empty, Groq is rate-limiting, an outage — the school still
 * has the words of the class, so this falls back to `buildExtractiveNotes`
 * rather than leaving the recording stuck. `provider` says which one answered;
 * an extractive result is tagged so the queue can upgrade it later.
 *
 * `allowExtractive: false` is for that upgrade pass, which only wants a model's
 * answer and must not overwrite an outline with an identical outline.
 */
export async function summariseTranscript(
  input: {
    recordingId: string;
    isPrivate: boolean;
    level: string | null;
    title: string;
    segments: TranscriptSegment[];
    text: string;
  },
  options: { allowExtractive?: boolean } = {},
): Promise<{ notes: ClassNotes; provider: string } | null> {
  const { isPrivate } = input;

  const fromModel = await cached<ClassNotes>(
    "class_transcript_notes",
    input.recordingId,
    async () => {
      // The budget is a guess at which model will answer. If Claude turns out to
      // be unfunded, the first (large) prompt is refused by Groq's per-request
      // ceiling and a second, smaller one goes to the model that IS answering —
      // by then Claude has been marked down, so callModel routes straight there.
      const budgets = [...new Set([promptCharBudget("learning-content"), SMALL_PROMPT_CHARS])].sort((a, b) => b - a);
      for (const maxChars of budgets) {
        const build = isPrivate ? buildPrivateNotesPrompt : buildNotesPrompt;
        const prompt = build({ level: input.level, title: input.title, segments: input.segments, maxChars });
        // Higher than before `speakerRanges` existed — a long class can
        // legitimately need a few hundred short range entries to cover it.
        const raw = await callModel(prompt, isPrivate ? 2600 : 2300, "learning-content");
        const notes = raw ? coerceNotes(parseModelJson(raw), { isPrivate }) : null;
        if (notes) return notes;
      }
      return null;
    },
    { model: activeModelName("learning-content") },
  );
  if (fromModel) return { notes: fromModel, provider: activeModelName("learning-content") };

  if (options.allowExtractive === false) return null;
  const extracted = buildExtractiveNotes(input.text);
  if (!extracted) return null;
  return {
    notes: { ...extracted, ...(isPrivate ? { corrections: [], progressHighlights: [] } : {}) },
    provider: EXTRACTIVE_PROVIDER,
  };
}

/**
 * HOW MUCH OF A RECORDING ONE STEP BITES OFF.
 *
 * A class is transcribed a few minutes at a time, and progress is saved after
 * every step (`ClassTranscript.transcribedUntil`). The whole recording used to be
 * one indivisible job: read all of a 1–2 GB video, re-encode its audio, transcribe
 * it. When that took longer than the function may live the platform killed it,
 * NOTHING was kept, and the next attempt started from zero and died the same way
 * — which is why some classes never got notes however many times the queue ran.
 * Now a slow connection just means a recording takes more runs; it is never lost.
 *
 * Five minutes of a 1080p recording is ~110 MB to read, and ~2.4 MB of audio.
 */
export const SLICE_SECONDS = 300;
/** Speech-to-text plus saving, after ffmpeg has finished a slice. */
const SLICE_OVERHEAD_MS = 40_000;
/** The most one ffmpeg read of a slice may take, whatever time is left. */
const SLICE_READ_CAP_MS = 150_000;
/** When the caller gives no deadline (a direct call), how long this attempt may work. */
const DEFAULT_ATTEMPT_MS = 200_000;
/** Below this, an ffmpeg result is just the container header: there was no audio left. */
const MIN_AUDIO_BYTES = 2_000;

/** Whisper timestamps are relative to the slice it was given; put them on the recording's clock. */
export function offsetSegments(segments: TranscriptSegment[], seconds: number): TranscriptSegment[] {
  return segments.map((segment) => ({ ...segment, start: segment.start + seconds, end: segment.end + seconds }));
}

export type SliceResult =
  | { kind: "done"; text: string; segments: TranscriptSegment[] }
  /** Stopped before the end. `progressed` = at least one slice was finished this time. */
  | { kind: "partial"; progressed: boolean; reason: string | null };

/**
 * Transcribe a recording slice by slice from `until`, saving after each, until it
 * is finished or the time runs out. Never starts a slice it cannot finish.
 */
export async function transcribeInSlices(input: {
  classRecordingId: string;
  url: string;
  /** From the recording row; null when the file never reported one. */
  totalSeconds: number | null;
  until: number;
  text: string;
  segments: TranscriptSegment[];
  deadlineAt: number;
}): Promise<SliceResult> {
  let { until, text } = input;
  const segments = [...input.segments];
  let progressed = false;
  let reason: string | null = null;

  while (input.totalSeconds === null || until < input.totalSeconds) {
    const remaining = input.deadlineAt - Date.now();
    if (remaining < SLICE_OVERHEAD_MS + 45_000) break; // not enough left for another slice

    const length = input.totalSeconds === null ? SLICE_SECONDS : Math.min(SLICE_SECONDS, input.totalSeconds - until);
    const started = Date.now();
    const audio = await extractAudioForAsrFromUrl(input.url, {
      timeoutMs: Math.min(SLICE_READ_CAP_MS, remaining - SLICE_OVERHEAD_MS),
      startSeconds: until,
      durationSeconds: length,
    });
    if ("error" in audio) {
      reason = audio.error;
      break;
    }

    // Past the end of a recording whose length we did not know: that is "done".
    if (audio.buffer.length < MIN_AUDIO_BYTES && input.totalSeconds === null) {
      until = Number.POSITIVE_INFINITY;
      break;
    }

    if (audio.buffer.length >= MIN_AUDIO_BYTES) {
      // Never let a speech-to-text failure (most often Groq's free-tier quota,
      // which has no sibling model to fall back to) blow past this function and
      // mislabel the row `failed` — everything transcribed so far is real and
      // must be kept, parked as `partial`, exactly like a slow read is.
      let heard: TranscriptionResult | null;
      try {
        heard = await transcribeAudio(audio.buffer, audio.filename); // null = a silent stretch
      } catch (error) {
        reason = error instanceof Error ? error.message : String(error);
        break;
      }
      if (heard) {
        segments.push(...offsetSegments(heard.segments, until));
        text = text ? `${text} ${heard.text}` : heard.text;
      }
    }
    until += length;
    progressed = true;

    await prisma.classTranscript.update({
      where: { classRecordingId: input.classRecordingId },
      data: {
        status: "transcribing",
        transcribedUntil: Number.isFinite(until) ? until : input.totalSeconds,
        transcriptText: text,
        segments: segments as unknown as object[],
        error: null,
      },
    });
    console.log(
      `[class-notes] ${input.classRecordingId} slice to ${Math.round(until)}s of ${input.totalSeconds ?? "?"}s in ${Math.round((Date.now() - started) / 1000)}s`,
    );
  }

  const finished = input.totalSeconds === null ? until === Number.POSITIVE_INFINITY : until >= input.totalSeconds;
  if (finished) return { kind: "done", text, segments };
  return { kind: "partial", progressed, reason };
}

/**
 * Transcribe and summarise one recording. Idempotent: a row already `ready`
 * or mid-flight is left alone, so the queue below can call this freely
 * without tracking what it has already claimed.
 *
 * Three ways a row is worth another go, beyond "never attempted":
 *   - `failed` / `skipped_too_large` — most failures are a dropped connection
 *     or a rate limit, not an authoritative "this can never work";
 *   - `transcribing` / `summarizing` for longer than STALE_IN_FLIGHT_MS — the
 *     function was killed at its time limit and nothing else would ever
 *     resume it (this is how a class can sit "in progress" for weeks);
 *   - `ready` with an EXTRACTIVE provider, once a model is reachable again —
 *     the outline it got while the models were down is replaced by the real
 *     write-up. Never notifies a second time.
 */
export async function generateTranscriptForRecording(
  classRecordingId: string,
  options: { deadlineAt?: number } = {},
): Promise<"created" | "partial" | "already" | "skipped" | "failed"> {
  const recording = await prisma.classRecording.findUnique({
    where: { id: classRecordingId },
    select: {
      id: true,
      objectKey: true,
      level: true,
      sessionSlot: true,
      branchId: true,
      status: true,
      privateClassId: true,
      durationSeconds: true,
      transcript: {
        select: { status: true, provider: true, updatedAt: true, transcriptText: true, segments: true, transcribedUntil: true },
      },
      material: { select: { id: true, title: true } },
    },
  });
  if (!recording || recording.status !== "completed" || !recording.objectKey || !recording.material) return "skipped";
  const isPrivate = Boolean(recording.privateClassId);
  const existing = recording.transcript;

  // "failed" is retryable — most failures seen in practice are a dropped
  // connection reading the file back from the bucket, not an authoritative
  // "this can never work" answer. `skipped_too_large` is retryable now too:
  // it used to mean "this file is bigger than we can pull into memory and it
  // always will be", but the pipeline below no longer pulls the video into
  // memory at all — ffmpeg streams the audio track straight from the bucket —
  // so a row parked at that status before this change deserves another go.
  // `partial` = transcribed some of the way and parked (see transcribeInSlices).
  const RETRYABLE = new Set(["pending", "failed", "skipped_too_large", "partial"]);
  const inFlight = existing?.status === "transcribing" || existing?.status === "summarizing";
  const abandoned = inFlight && Date.now() - existing!.updatedAt.getTime() > STALE_IN_FLIGHT_MS;
  const upgrading = existing?.status === "ready" && existing.provider === EXTRACTIVE_PROVIDER;

  if (existing && !RETRYABLE.has(existing.status) && !abandoned && !upgrading) return "already";
  if (upgrading && !aiTextAvailable()) return "already";

  const title = recording.material.title;
  const storedSegments = readStoredSegments(existing?.segments);

  // UPGRADE: the words are already here, only a model's write-up is missing.
  // The row stays `ready` throughout, so a student reading the outline never
  // sees it disappear.
  if (upgrading) {
    if (!storedSegments || !existing?.transcriptText) return "already";
    const better = await summariseTranscript(
      { recordingId: classRecordingId, isPrivate, level: recording.level, title, segments: storedSegments, text: existing.transcriptText },
      { allowExtractive: false },
    );
    if (!better) {
      // Touch the row so the queue leaves it alone for a few hours.
      await prisma.classTranscript
        .update({ where: { classRecordingId }, data: { error: "Upgrade to a full write-up is waiting for an AI model." } })
        .catch(() => {});
      return "already";
    }
    await saveNotes(classRecordingId, better.notes, better.provider, isPrivate);
    return "created";
  }

  // CLAIM IT, atomically. The cron, the admin button and the after-a-class kick
  // can all reach the same recording; a blind upsert let two of them both
  // download, transcribe and summarise it. The row's own `updatedAt` is the
  // ticket: only the runner that still sees the row exactly as it read it wins.
  if (!existing) {
    try {
      await prisma.classTranscript.create({ data: { classRecordingId, status: "transcribing" } });
    } catch (error) {
      if ((error as { code?: string })?.code === "P2002") return "already"; // somebody else created it first
      throw error;
    }
  } else {
    const claimed = await prisma.classTranscript.updateMany({
      where: { classRecordingId, updatedAt: existing.updatedAt },
      data: { status: "transcribing", error: null },
    });
    if (claimed.count === 0) return "already";
  }

  try {
    const objectKey = recording.objectKey;
    const filename = objectKey.split("/").pop() || "class.mp4";

    // What is already transcribed. A row with segments but no progress marker was
    // transcribed in one go by the old pipeline and only failed later (summary),
    // so it is complete; a row WITH a marker is finished only once it reaches the end.
    const totalSeconds = recording.durationSeconds && recording.durationSeconds > 0 ? recording.durationSeconds : null;
    const legacyComplete = Boolean(storedSegments) && existing?.transcribedUntil == null;
    const progress = existing?.transcribedUntil ?? 0;
    const alreadyComplete =
      Boolean(storedSegments && existing?.transcriptText) &&
      (legacyComplete || (totalSeconds !== null && progress >= totalSeconds));

    let asr: { text: string; segments: TranscriptSegment[] } | null = alreadyComplete
      ? { text: existing!.transcriptText!, segments: storedSegments! }
      : null;

    if (!asr) {
      const url = await signedGetUrl(objectKey, 3600).catch(() => null);

      if (url) {
        /**
         * FIRST CHOICE: read the recording straight out of the bucket, a slice at
         * a time — see transcribeInSlices for why it is sliced. The video is never
         * held in this function's memory or on /tmp; only the audio of each slice
         * (a couple of MB) is.
         */
        const result = await transcribeInSlices({
          classRecordingId,
          url,
          totalSeconds,
          until: progress,
          text: existing?.transcriptText ?? "",
          segments: storedSegments ?? [],
          deadlineAt: options.deadlineAt ?? Date.now() + DEFAULT_ATTEMPT_MS,
        });

        if (result.kind === "partial") {
          // Park it, keeping everything transcribed so far, so the next run
          // resumes instead of starting over. `failed` only if this run got
          // nowhere at all — the reason says why (usually: the read was too slow).
          await prisma.classTranscript.update({
            where: { classRecordingId },
            data: { status: "partial", error: result.reason },
          });
          return result.progressed ? "partial" : "failed";
        }
        asr = { text: result.text, segments: result.segments };
      } else {
        // NO BUCKET (local dev): fetch the whole file and work on it in memory. Only
        // safe for a file a function can actually hold, so the size ceiling guards it.
        const file = await getFile(objectKey);
        if (!file) throw new Error("recording file not found in storage");

        const lengthHeader = file.headers.get("content-length");
        if (lengthHeader && Number(lengthHeader) > MAX_FETCH_BYTES) {
          await prisma.classTranscript.update({
            where: { classRecordingId },
            data: {
              status: "skipped_too_large",
              error: `No signed URL for the recording, and the ${Number(lengthHeader)}-byte file is too large to read into memory`,
            },
          });
          return "skipped";
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const extracted = await extractAudioForAsr(buffer, filename);
        const input = extracted ?? { buffer, filename };
        asr = await transcribeAudio(input.buffer, input.filename);
      }

      if (!asr || asr.segments.length === 0) {
        await prisma.classTranscript.update({
          where: { classRecordingId },
          data: { status: "none", error: "No speech detected" },
        });
        return "failed";
      }
    }

    await prisma.classTranscript.update({
      where: { classRecordingId },
      data: {
        status: "summarizing",
        transcriptText: asr.text,
        segments: asr.segments as unknown as object[],
        transcribedUntil: totalSeconds ?? existing?.transcribedUntil ?? null,
      },
    });

    const result = await summariseTranscript({
      recordingId: classRecordingId,
      isPrivate,
      level: recording.level,
      title,
      segments: asr.segments,
      text: asr.text,
    });

    if (!result) {
      // Not "the model failed" any more — the extractive floor also declined,
      // which means there was too little speech to be a class at all. That is a
      // verdict, not a blip: retrying would decline again, forever.
      await prisma.classTranscript.update({
        where: { classRecordingId },
        data: { status: "none", error: "Too little speech to summarise" },
      });
      return "failed";
    }

    await saveNotes(classRecordingId, result.notes, result.provider, isPrivate);

    if (isPrivate && recording.privateClassId) {
      const booking = await prisma.privateClass.findUnique({
        where: { id: recording.privateClassId },
        select: { student: { select: { userId: true } } },
      });
      if (booking?.student.userId) {
        notifyInBackground({
          to: { userIds: [booking.student.userId] },
          kind: KIND.classNotesReady,
          title: "Your private class notes are ready",
          message: `${recording.material.title} now has a summary, vocabulary, corrections and the full transcript.`,
          link: `/materials/watch/${recording.material.id}`,
          dedupeKey: `class-notes:${classRecordingId}`,
        });
      }
    } else if (recording.level) {
      notifyInBackground({
        to: { students: { branchId: recording.branchId, level: recording.level, sessionSlot: recording.sessionSlot } },
        kind: KIND.classNotesReady,
        title: "Class notes are ready",
        message: `${recording.material.title} now has a summary, vocabulary and full transcript.`,
        link: `/materials/watch/${recording.material.id}`,
        dedupeKey: `class-notes:${classRecordingId}`,
      });
    }

    return "created";
  } catch (error) {
    console.error(`[class-transcription] failed for recording ${classRecordingId}:`, error);
    const message = error instanceof Error ? error.message : String(error);
    // A 413 from Groq is a verdict, not a blip — the file will be exactly
    // this large on every retry, so marking it `failed` (retryable, see the
    // RETRYABLE set above) would just burn a call against the same rejection
    // every cron tick forever.
    const tooLarge = /\b413\b/.test(message);
    // A 429 is the free tier's hourly/daily audio allowance, not a defect in
    // this recording. Say so, so whoever reads the health panel does not chase
    // a bug that is really "come back later".
    const rateLimited = /\b429\b/.test(message);
    await prisma.classTranscript
      .update({
        where: { classRecordingId },
        data: {
          status: tooLarge ? "skipped_too_large" : "failed",
          error: (rateLimited ? `Speech-to-text rate limit reached — will retry later. ${message}` : message).slice(0, 500),
        },
      })
      .catch(() => {});
    return tooLarge ? "skipped" : "failed";
  }
}

async function saveNotes(classRecordingId: string, notes: ClassNotes, provider: string, isPrivate: boolean): Promise<void> {
  await prisma.classTranscript.update({
    where: { classRecordingId },
    data: {
      status: "ready",
      isPrivate,
      summary: notes.summary,
      keyPoints: notes.keyPoints,
      actionItems: notes.actionItems,
      vocabulary: notes.vocabulary as unknown as object[],
      corrections: (notes.corrections as unknown as object[]) ?? undefined,
      progressHighlights: notes.progressHighlights ?? undefined,
      speakerRanges: (notes.speakerRanges as unknown as object[]) ?? undefined,
      provider,
      generatedAt: new Date(),
      error: null,
    },
  });
}

/**
 * The recordings the queue should work on — one definition, shared by the cron
 * pass below and the admin "Drain the backlog" counter, so the number the
 * office is shown is exactly what the next press will chew on.
 *
 *   - never attempted, or failed / parked as too large (see RETRYABLE);
 *   - abandoned mid-flight (transcribing/summarizing for over 10 minutes);
 *   - an auto-outline written while no model was reachable, once one is again
 *     and it has been left alone for a few hours after a failed upgrade.
 */
export function transcriptionBacklogWhere(since: Date, now: Date = new Date()): Prisma.ClassRecordingWhereInput {
  const abandonedBefore = new Date(now.getTime() - STALE_IN_FLIGHT_MS);
  const upgradeBefore = new Date(now.getTime() - UPGRADE_RETRY_MS);
  return {
    status: "completed",
    materialId: { not: null },
    startedAt: { gte: since },
    OR: [
      { transcript: null },
      { transcript: { status: "failed" } },
      { transcript: { status: "skipped_too_large" } },
      // Started and parked part-way — finish what was begun.
      { transcript: { status: "partial" } },
      { transcript: { status: { in: ["transcribing", "summarizing"] }, updatedAt: { lt: abandonedBefore } } },
      ...(aiTextAvailable()
        ? [{ transcript: { status: "ready", provider: EXTRACTIVE_PROVIDER, updatedAt: { lt: upgradeBefore } } }]
        : []),
    ],
  };
}

/**
 * Work through completed recordings that have never been transcribed.
 *
 * Capped hard, same reasoning as `processMaterialQueue`: an ASR call plus a
 * summarisation call per recording, on the same box as the site, and unlike
 * a PDF this cannot be skimmed for readable text first — every eligible
 * recording costs a real call. Recordings are not urgent the way a mail
 * queue is, so a small number per tick clearing the backlog over a few runs
 * is the right trade.
 */
export async function processTranscriptionQueue(
  limit = 2,
  options: { deadlineAt?: number } = {},
): Promise<{ attempted: number; created: number; failed: number; partial: number }> {
  const where = transcriptionBacklogWhere(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

  // Finish what was started first: a recording that is half transcribed is worth
  // more done than another one begun. Then never-attempted (newest first), then
  // whichever other retryable row was touched longest ago — so one that keeps
  // failing cannot hog every slot and starve the ones queued behind it.
  const started = await prisma.classRecording.findMany({
    where: { AND: [where, { transcript: { status: "partial" } }] },
    orderBy: { transcript: { updatedAt: "asc" } },
    take: limit,
    select: { id: true },
  });
  const fresh =
    started.length < limit
      ? await prisma.classRecording.findMany({
          where: { AND: [where, { transcript: null }] },
          orderBy: { startedAt: "desc" },
          take: limit - started.length,
          select: { id: true },
        })
      : [];
  const taken = started.length + fresh.length;
  const retries =
    taken < limit
      ? await prisma.classRecording.findMany({
          where: { AND: [where, { transcript: { isNot: null } }, { NOT: { transcript: { status: "partial" } } }] },
          orderBy: { transcript: { updatedAt: "asc" } },
          take: limit - taken,
          select: { id: true },
        })
      : [];
  const pending = [...started, ...fresh, ...retries];

  let created = 0;
  let failed = 0;
  let partial = 0;
  let attempted = 0;
  for (const row of pending) {
    // A caller with a wall-clock limit (the admin button, the background runner)
    // must never be handed a recording it cannot make progress on: past this
    // point the rest simply wait for the next run.
    if (options.deadlineAt && options.deadlineAt - Date.now() < MIN_RECORDING_START_MS) break;
    attempted += 1;
    const outcome = await generateTranscriptForRecording(row.id, { deadlineAt: options.deadlineAt });
    if (outcome === "created") created += 1;
    else if (outcome === "partial") partial += 1;
    else if (outcome === "failed") failed += 1;
  }

  return { attempted, created, failed, partial };
}

/**
 * Becca's one line of personalisation for this student on this class — same
 * trick as `personalLine` in student-brief.ts: every fact (the vocabulary
 * list) is real and already generated, the model is only asked to frame it
 * against what the behaviour engine already knows about this student, so it
 * cannot invent a mistake they never made. Cached per (student, transcript),
 * so reopening the notes never costs a second call.
 */
export async function personalFocusLine(
  userId: string,
  transcript: {
    id: string;
    vocabulary: Array<{ de: string; en: string }>;
    summary: string;
    corrections?: Array<{ mistake: string; correction: string }>;
  },
): Promise<string | null> {
  const hasCorrections = (transcript.corrections?.length ?? 0) > 0;
  if (transcript.vocabulary.length === 0 && !hasCorrections) return null;

  return cached<string>(
    "class_note_personal_line",
    `${userId}:${transcript.id}`,
    async () => {
      let behaviour = "";
      try {
        behaviour = (await profileFor(userId)).summary;
      } catch {
        behaviour = "";
      }

      // A private lesson's own corrections are a more specific, more honest
      // thing to point at than "some word from the vocabulary list" — they
      // are literally the mistakes THIS student made, not a guess at what
      // might matter to them.
      const prompt = [
        `You are Becca, a warm but no-nonsense mascot for a Nigerian German-language school.`,
        hasCorrections
          ? `A student just finished reviewing their notes from a private lesson. Write ONE short sentence pointing`
            + ` them at whichever correction below is most worth practicing — never invent a mistake that isn't listed.`
          : `A student just finished reviewing their notes from a class. Write ONE short sentence pointing them at`
            + ` whichever part of THIS class's vocabulary is most worth their attention — never invent a word that`
            + ` isn't in the list below.`,
        "",
        `Class summary: ${transcript.summary}`,
        hasCorrections
          ? `Corrections given this lesson: ${transcript.corrections!.map((c) => `"${c.mistake}" → "${c.correction}"`).join("; ")}`
          : `Vocabulary taught: ${transcript.vocabulary.map((word) => `${word.de} (${word.en})`).join(", ")}`,
        behaviour ? `What we know about how this student learns: ${behaviour}` : "",
        "",
        "Under 25 words. Warm, direct, a little playful. No emoji, no quotation marks. Reply with ONLY the sentence.",
      ]
        .filter(Boolean)
        .join("\n");

      const raw = await callModel(prompt, 100, "student");
      if (!raw) return null;
      const clean = raw.trim().replace(/^["']|["']$/g, "").slice(0, 220);
      return clean || null;
    },
    { model: activeModelName("student") },
  );
}

export type { TranscriptSegment };
