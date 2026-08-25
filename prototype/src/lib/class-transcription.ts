import { prisma } from "@/lib/prisma";
import { getFile } from "@/lib/storage";
import { transcribeAudio, type TranscriptSegment } from "@/lib/transcription";
import { extractAudioForAsr } from "@/lib/audio-extract";
import { callModel, activeModelName } from "@/lib/ai";
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
 * What we hand the summarizer. A talky hour of class is realistically
 * 30-50k characters of transcript; this caps it well short of that rather
 * than truncate silently — the note below the constant is what a student
 * would actually see if a class ran long, not a guess.
 */
const MAX_TRANSCRIPT_PROMPT_CHARS = 22_000;

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
function formatIndexedTranscript(segments: TranscriptSegment[]): { text: string; truncated: boolean } {
  const lines: string[] = [];
  let length = 0;
  let truncated = false;
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const line = `[${i}] (${formatClock(segment.start)}-${formatClock(segment.end)}) ${segment.text}`;
    if (length + line.length + 1 > MAX_TRANSCRIPT_PROMPT_CHARS) {
      truncated = true;
      break;
    }
    lines.push(line);
    length += line.length + 1;
  }
  return { text: lines.join("\n"), truncated };
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
function buildNotesPrompt(input: { level: string | null; title: string; segments: TranscriptSegment[] }): string {
  const { text, truncated } = formatIndexedTranscript(input.segments);
  return [
    `You are turning a raw speech-to-text transcript of a live German class into notes a student can review later.`,
    `Class: "${input.title}"${input.level ? `, level ${input.level}` : ""}.`,
    `Each line below is one ASR segment: "[index] (start-end) text". There is no real speaker labelling — you cannot`,
    `reliably tell which of several students spoke — but the TUTOR's voice is usually distinguishable by phrasing`,
    `(explaining, instructing, asking the class a question) versus a student's (answering, asking their own question).`,
    truncated ? `The transcript below is the first part of a longer class; work only from what is given.` : "",
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
function buildPrivateNotesPrompt(input: { level: string | null; title: string; segments: TranscriptSegment[] }): string {
  const { text, truncated } = formatIndexedTranscript(input.segments);
  return [
    `You are turning a raw speech-to-text transcript of a private one-to-one German lesson into notes for the student.`,
    `There are exactly two voices in this transcript: the tutor and this one student. Each line below is one ASR`,
    `segment: "[index] (start-end) text". There is no real speaker labelling, but unlike a group class, turn-taking`,
    `and phrasing (a question vs. an explanation, a mistake vs. a correction) is usually enough to tell which is`,
    `which — use that, but say so only where the transcript actually supports it.`,
    `Lesson: "${input.title}"${input.level ? `, level ${input.level}` : ""}.`,
    truncated ? `The transcript below is the first part of a longer lesson; work only from what is given.` : "",
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

/**
 * Transcribe and summarise one recording. Idempotent: a row already `ready`
 * or mid-flight is left alone, so the queue below can call this freely
 * without tracking what it has already claimed.
 */
export async function generateTranscriptForRecording(classRecordingId: string): Promise<"created" | "already" | "skipped" | "failed"> {
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
      transcript: { select: { status: true } },
      material: { select: { id: true, title: true } },
    },
  });
  if (!recording || recording.status !== "completed" || !recording.objectKey || !recording.material) return "skipped";
  const isPrivate = Boolean(recording.privateClassId);
  // "failed" is retryable — most failures seen in practice are a dropped
  // connection reading the file back from the bucket, not an authoritative
  // "this can never work" answer. Only a status that already represents a
  // real outcome (ready, or a considered decision like skipped_too_large/none)
  // is left alone.
  const RETRYABLE = new Set(["pending", "failed"]);
  if (recording.transcript && !RETRYABLE.has(recording.transcript.status)) return "already";

  await prisma.classTranscript.upsert({
    where: { classRecordingId },
    create: { classRecordingId, status: "transcribing" },
    update: { status: "transcribing", error: null },
  });

  try {
    const file = await getFile(recording.objectKey);
    if (!file) throw new Error("recording file not found in storage");

    const lengthHeader = file.headers.get("content-length");
    if (lengthHeader && Number(lengthHeader) > MAX_FETCH_BYTES) {
      await prisma.classTranscript.update({
        where: { classRecordingId },
        data: { status: "skipped_too_large", error: `File is ${Number(lengthHeader)} bytes, over this pipeline's ${MAX_FETCH_BYTES}-byte safety ceiling` },
      });
      return "skipped";
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = recording.objectKey.split("/").pop() || "class.mp4";

    // Send the ASR call the audio track only, re-encoded down to speech
    // bitrate — see audio-extract.ts for why this is the difference between
    // "fits under Groq's request-size limit" and "413s on a 5-minute clip".
    // Falls back to the original file untouched if extraction fails for any
    // reason (ffmpeg missing, a corrupt input) — that is the exact behaviour
    // this pipeline already had before, not a new failure mode.
    const extracted = await extractAudioForAsr(buffer, filename);
    const asr = extracted
      ? await transcribeAudio(extracted.buffer, extracted.filename)
      : await transcribeAudio(buffer, filename);
    if (!asr) {
      await prisma.classTranscript.update({
        where: { classRecordingId },
        data: { status: "none", error: "No speech detected" },
      });
      return "failed";
    }

    await prisma.classTranscript.update({
      where: { classRecordingId },
      data: { status: "summarizing", transcriptText: asr.text, segments: asr.segments as unknown as object[] },
    });

    const notes = await cached<ClassNotes>(
      "class_transcript_notes",
      classRecordingId,
      async () => {
        const prompt = isPrivate
          ? buildPrivateNotesPrompt({ level: recording.level, title: recording.material!.title, segments: asr.segments })
          : buildNotesPrompt({ level: recording.level, title: recording.material!.title, segments: asr.segments });
        // Higher than before `speakerRanges` existed — a long class can
        // legitimately need a few hundred short range entries to cover it.
        const raw = await callModel(prompt, isPrivate ? 2600 : 2300, "learning-content");
        return coerceNotes(parseModelJson(raw), { isPrivate });
      },
      { model: activeModelName("learning-content") },
    );

    if (!notes) {
      await prisma.classTranscript.update({
        where: { classRecordingId },
        data: { status: "failed", error: "Model produced no usable notes" },
      });
      return "failed";
    }

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
        provider: activeModelName("learning-content"),
        generatedAt: new Date(),
        error: null,
      },
    });

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
    await prisma.classTranscript
      .update({
        where: { classRecordingId },
        data: { status: tooLarge ? "skipped_too_large" : "failed", error: message.slice(0, 500) },
      })
      .catch(() => {});
    return tooLarge ? "skipped" : "failed";
  }
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
export async function processTranscriptionQueue(limit = 2): Promise<{ attempted: number; created: number; failed: number }> {
  const pending = await prisma.classRecording.findMany({
    where: {
      status: "completed",
      materialId: { not: null },
      // No transcript yet, OR one that failed — see the RETRYABLE note in
      // generateTranscriptForRecording for why a failure gets another go
      // instead of being left for good the first time a fetch drops mid-stream.
      OR: [{ transcript: null }, { transcript: { status: "failed" } }],
      startedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    },
    orderBy: { startedAt: "desc" },
    take: limit,
    select: { id: true },
  });

  let created = 0;
  let failed = 0;
  for (const row of pending) {
    const outcome = await generateTranscriptForRecording(row.id);
    if (outcome === "created") created += 1;
    else if (outcome === "failed") failed += 1;
  }

  return { attempted: pending.length, created, failed };
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
