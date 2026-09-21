import type { TranscriptSegment } from "@/lib/transcription";

/**
 * CLASS NOTES WITH NO AI AT ALL.
 *
 * The summariser in class-transcription.ts needs a model. Models go away: the
 * Claude account runs out of credit, Groq's free tier answers 429 for a
 * minute, an outage lasts an afternoon. Whisper (which produces the transcript)
 * is a separate, free service, so in every one of those cases the school still
 * HAS the words of the class — what it lacks is somebody to tidy them.
 *
 * This is that somebody, built from nothing but string handling: it scores each
 * sentence of the transcript for how much teaching it carries, and lifts the
 * best ones out verbatim. It is honest about what it is —
 *
 *   summary      the two or three sentences of the class that say the most
 *   keyPoints    the next best few, in the order they were said
 *   actionItems  sentences that sound like homework or a next-class request
 *   vocabulary   ONLY where the tutor said the pair out loud ("X means Y",
 *                "the German for Y is X") — never a guess at a translation
 *
 * — and it never invents. There is no translation step, so a German word the
 * tutor used but did not gloss aloud simply is not listed. A reader gets a
 * thinner page than the AI would write, not a wrong one, and the notes panel
 * says so (see ClassNotesPanel). When a model is reachable again the queue
 * re-runs those classes and replaces this (class-transcription.ts,
 * `upgradeExtractive`).
 */

export type ExtractiveNotes = {
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  vocabulary: Array<{ de: string; en: string; note?: string }>;
};

/** Below this many words there is no class to summarise — a mic check, a dropped call. */
const MIN_WORDS = 80;

const SUMMARY_SENTENCES = 3;
const KEY_POINTS = 5;
const MAX_ACTION_ITEMS = 5;
const MAX_VOCABULARY = 20;
const MAX_SENTENCE_CHARS = 240;

/** Pure pleasantries and audio housekeeping — never a note-worthy sentence. */
const CHATTER =
  /^(?:(?:ok(?:ay)?|yes|no|yeah|hello|hi|hey|good (?:morning|afternoon|evening)|thank(?:s| you)(?: very much)?|can you (?:hear|see) me|is (?:my|the) (?:mic|audio|sound|screen)[^.?!]*|hallo|guten (?:morgen|tag|abend)|danke|bitte|ja|nein|genau|gut|sehr gut|alright|right|so|um+|uh+|mm+|hmm+|please|welcome|everyone|everybody|class|guys|students)[\s,.!?]*)+$/i;

/** Wording a tutor uses when they are actually teaching a rule or a word. */
const TEACHING_CUE =
  /\b(means?|meaning|bedeutet|heißt|translat\w+|in german|auf deutsch|in english|auf englisch|for example|zum beispiel|e\.g\.|remember|merkt|note that|rule|regel|grammar|grammatik|verbs?|nouns?|nomen|articles?|artikel|adjectives?|adjektiv\w*|plural|singular|accusative|dative|nominative|genitive|akkusativ|dativ|nominativ|genitiv|perfekt|präteritum|präsens|konjunktiv|modal\w*|separable|trennbar\w*|conjugat\w+|konjugier\w+|sentences?|satz|pronunciation|aussprache|tense|word order|wortstellung|preposition\w*|pronoun\w*|important|wichtig|difference|unterschied)\b/gi;

/** Wording a tutor uses when they are setting work or asking for something next time. */
const ACTION_CUE =
  /\b(homework|hausaufgabe\w*|for next (?:class|time|week|lesson|session)|next (?:class|time|week|lesson|session)|by (?:tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|please (?:read|practi[sc]e|write|learn|do|complete|prepare|revise|review|submit|bring|memori[sz]e|watch|listen|send)|you (?:need|have|must|should) to (?:read|practi[sc]e|write|learn|do|complete|prepare|revise|review|submit|bring|memori[sz]e|watch|listen)|bring (?:your|the|a)\b|submit|assignment|memori[sz]e|revise|üb(?:t|en)\b|lernt|schreibt)\b/i;

/** Frequent German function words — a cheap "this sentence is German" signal. */
const GERMAN_FUNCTION_WORDS = new Set([
  "der", "die", "das", "und", "ist", "nicht", "ich", "sie", "wir", "ein", "eine", "einen", "mit", "für", "auf", "zu",
  "von", "den", "dem", "des", "im", "in", "es", "er", "wie", "was", "wo", "wer", "haben", "habe", "hat", "bin",
  "sind", "war", "aber", "auch", "noch", "sehr", "kein", "keine", "mein", "meine", "dein", "ihr", "uns", "euch",
]);

const ENGLISH_STOPWORDS = new Set([
  "the", "a", "an", "it", "this", "that", "is", "are", "of", "to", "and", "or", "in", "on", "for", "you", "we", "i",
  "so", "then", "here", "there", "what", "which", "word", "words", "phrase", "german", "english",
]);

function words(text: string): string[] {
  return text.match(/[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß'’-]*/g) ?? [];
}

/** Share of the words that look German — umlaut/ß or a frequent German function word. */
function germanShare(text: string): number {
  const list = words(text);
  if (list.length === 0) return 0;
  const hits = list.filter((word) => /[äöüßÄÖÜ]/.test(word) || GERMAN_FUNCTION_WORDS.has(word.toLowerCase())).length;
  return hits / list.length;
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?…])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function scoreSentence(sentence: string): number {
  const list = words(sentence);
  const count = list.length;
  if (count < 5 || CHATTER.test(sentence)) return -10;

  let score = 0;
  const cues = sentence.match(TEACHING_CUE)?.length ?? 0;
  score += Math.min(cues, 3) * 3;
  // A full German example sentence is exactly what a student wants to re-read.
  if (count >= 4 && germanShare(sentence) >= 0.25) score += 2;
  if (count >= 8 && count <= 40) score += 2;
  else if (count > 60) score -= 2;
  if (sentence.includes("?")) score += 1;
  return score;
}

function tidy(sentence: string): string {
  const clean = sentence.replace(/\s+/g, " ").trim();
  if (clean.length <= MAX_SENTENCE_CHARS) return clean;
  // Cut at a word boundary, not mid-word.
  return `${clean.slice(0, MAX_SENTENCE_CHARS).replace(/\s+\S*$/, "")}…`;
}

// ---------------------------------------------------------------------------
// Vocabulary — only what the tutor said out loud as a pair.
// ---------------------------------------------------------------------------

const W = "[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß'’-]*";
const phrase = (max: number) => `${W}(?:\\s+${W}){0,${max}}`;
const Q = `["“”'‘’]?`;

type PairPattern = { re: RegExp; de: 1 | 2; en: 1 | 2 };

const PAIR_PATTERNS: PairPattern[] = [
  // "Haus means house" / "Haus bedeutet house" / "Haus heißt house"
  { re: new RegExp(`${Q}(${phrase(3)})${Q}\\s+(?:means|bedeutet|heißt|translates (?:to|as)|is translated as)\\s+${Q}(${phrase(5)})${Q}`, "gi"), de: 1, en: 2 },
  // "the German for house is Haus" / "the German word for house is das Haus"
  { re: new RegExp(`german\\s+(?:word\\s+|phrase\\s+)?(?:for|of)\\s+${Q}(${phrase(4)})${Q}\\s+is\\s+${Q}(${phrase(3)})${Q}`, "gi"), en: 1, de: 2 },
  // "house in German is Haus" / "house auf Deutsch heißt Haus"
  { re: new RegExp(`${Q}(${phrase(4)})${Q}\\s+(?:in|auf)\\s+(?:german|deutsch)\\s+(?:is|ist|heißt|=)\\s+${Q}(${phrase(3)})${Q}`, "gi"), en: 1, de: 2 },
  // "Haus is house in English"
  { re: new RegExp(`${Q}(${phrase(3)})${Q}\\s+is\\s+${Q}(${phrase(5)})${Q}\\s+in\\s+english`, "gi"), de: 1, en: 2 },
];

function clean(term: string): string {
  return term.replace(/^[\s"“”'‘’]+|[\s"“”'‘’.,;:!?]+$/g, "").replace(/\s+/g, " ");
}

/** Drop a leading English filler so "so Haus" / "the word Haus" reduces to "Haus". */
function stripLeadIn(term: string): string {
  return term.replace(/^(?:so|and|then|now|the|a|an|this|that|word|words|phrase|is|it)\s+/i, "");
}

function usableTerm(term: string): boolean {
  if (!term || term.length > 60) return false;
  const list = words(term);
  if (list.length === 0) return false;
  return !list.every((word) => ENGLISH_STOPWORDS.has(word.toLowerCase()));
}

function extractVocabulary(text: string): ExtractiveNotes["vocabulary"] {
  const seen = new Set<string>();
  const found: ExtractiveNotes["vocabulary"] = [];

  for (const { re, de, en } of PAIR_PATTERNS) {
    for (const match of text.matchAll(re)) {
      let german = clean(stripLeadIn(clean(match[de])));
      let english = clean(stripLeadIn(clean(match[en])));
      // A pair like "Haus means Haus" or two obviously-English sides is noise.
      if (!usableTerm(german) || !usableTerm(english)) continue;
      if (german.toLowerCase() === english.toLowerCase()) continue;
      // The side we are calling German should look at least as German as the other.
      if (germanShare(german) < germanShare(english) && !/[äöüßÄÖÜ]/.test(german) && /[äöüßÄÖÜ]/.test(english)) {
        [german, english] = [english, german];
      }
      const key = german.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ de: german, en: english });
      if (found.length >= MAX_VOCABULARY) return found;
    }
  }
  return found;
}

// ---------------------------------------------------------------------------

/**
 * Build notes from the words alone. Returns null when there is too little
 * speech to be a class — the caller reports that rather than filing a summary
 * of "can you hear me?".
 */
export function buildExtractiveNotes(transcriptText: string): ExtractiveNotes | null {
  const text = (transcriptText ?? "").trim();
  if (words(text).length < MIN_WORDS) return null;

  const sentences = splitSentences(text);
  const scored = sentences.map((sentence, index) => ({ sentence, index, score: scoreSentence(sentence) }));

  // Best first; ties go to whichever was said earlier so the result is stable.
  const ranked = scored.filter((row) => row.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  if (ranked.length === 0) return null;

  const chronological = (rows: typeof ranked) => [...rows].sort((a, b) => a.index - b.index);

  const summaryRows = ranked.slice(0, SUMMARY_SENTENCES);
  const summaryIndexes = new Set(summaryRows.map((row) => row.index));
  const keyRows = ranked.filter((row) => !summaryIndexes.has(row.index)).slice(0, KEY_POINTS);

  const actionItems = scored
    .filter((row) => row.score > -10 && ACTION_CUE.test(row.sentence))
    .slice(0, MAX_ACTION_ITEMS)
    .map((row) => tidy(row.sentence));

  return {
    summary: chronological(summaryRows)
      .map((row) => tidy(row.sentence))
      .join(" "),
    keyPoints: chronological(keyRows).map((row) => tidy(row.sentence)),
    actionItems,
    vocabulary: extractVocabulary(text),
  };
}

/**
 * Pick the segments worth sending to a model when the whole transcript will
 * not fit in one request — the free Groq tier caps a request at roughly 8k
 * tokens, input and output together, which is a fraction of a real class.
 *
 * The old approach was to keep the START of the class and drop the rest, which
 * is the wrong end to lose: homework and "next time we will…" are said last.
 * This keeps the opening and closing few lines always, fills the remaining
 * budget with the highest-scoring segments, and returns them in their original
 * order WITH their original indices, so `speakerRanges` (which refers to
 * segments by index) still lines up and gaps are simply skipped.
 */
export function condenseSegments(
  segments: TranscriptSegment[],
  lineCost: (segment: TranscriptSegment, index: number) => number,
  maxChars: number,
): { picked: number[]; truncated: boolean } {
  const total = segments.reduce((sum, segment, index) => sum + lineCost(segment, index), 0);
  if (total <= maxChars) return { picked: segments.map((_, index) => index), truncated: false };

  const chosen = new Set<number>();
  let used = 0;
  const take = (index: number) => {
    if (chosen.has(index)) return true;
    const cost = lineCost(segments[index], index);
    if (used + cost > maxChars) return false;
    chosen.add(index);
    used += cost;
    return true;
  };

  // Bookends first: how the class opened and, above all, how it closed.
  const edge = Math.min(4, Math.floor(segments.length / 4));
  for (let i = 0; i < edge; i += 1) take(i);
  for (let i = segments.length - 1; i >= segments.length - edge; i -= 1) take(i);

  const ranked = segments
    .map((segment, index) => ({ index, score: scoreSentence(segment.text) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  for (const row of ranked) take(row.index);

  return { picked: [...chosen].sort((a, b) => a - b), truncated: true };
}
