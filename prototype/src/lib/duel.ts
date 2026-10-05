/**
 * WORTDUELL — the rules of a two-player der/die/das race.
 *
 * Eight nouns, three buttons, one clock. Both players get the identical list,
 * answer on their own phones in their own time, and whoever scores more wins.
 * Because nobody has to be looking at the same moment, a duel survives a
 * dropped signal, a locked screen and a bus ride — and because the server
 * scores each answer, there is nothing for a clever student to edit on their
 * phone.
 *
 * Pure: no I/O. The deck is in duel-deck.ts, the database half in
 * campus-server.ts. Unit-tested without a database.
 */

import { DECK, type Article } from "@/lib/duel-deck";

export type { Article } from "@/lib/duel-deck";
export type DeckLevel = keyof typeof DECK;

export const DUEL_QUESTIONS = 8;
export const ARTICLES: readonly Article[] = ["der", "die", "das"];

/** The only two numbers that decide a score. 100 for being right, up to 50 more for being quick. */
const BASE_POINTS = 100;
const SPEED_BONUS_MAX = 50;
/** A tap faster than this is a bot or a bounce; slower than this earns no bonus anyway. */
const MIN_MS = 250;
const MAX_MS = 15_000;

/** What a question looks like once frozen into a duel. */
export type DuelQuestion = { noun: string; gloss: string; article: Article };
/** What a client is allowed to see before it answers: never the article. */
export type PublicQuestion = { noun: string; gloss: string };
export type DuelAnswer = { i: number; choice: Article; correct: boolean; ms: number; points: number };

/** C1/C2 play the hardest deck there is; anything unreadable starts at the beginning. */
export function deckLevelOf(level: string | null | undefined): DeckLevel {
  const l = String(level ?? "").trim().toUpperCase();
  if (l === "A1" || l === "A2" || l === "B1" || l === "B2") return l;
  if (l === "C1" || l === "C2") return "B2";
  return "A1";
}

const ORDER: DeckLevel[] = ["A1", "A2", "B1", "B2"];

/** Two players of different levels play the lower one's words — it is a race, not an exam. */
export function lowerLevel(a: string | null | undefined, b: string | null | undefined): DeckLevel {
  const ia = ORDER.indexOf(deckLevelOf(a));
  const ib = ORDER.indexOf(deckLevelOf(b));
  return ORDER[Math.min(ia, ib)];
}

/** FNV-1a then xorshift — a small deterministic stream, so the same seed always gives the same duel. */
function stream(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = (h >>> 0) || 1;
  return (max: number) => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state % max;
  };
}

/**
 * Pick `n` distinct nouns for a level, seeded. Aims for a mix of articles so a
 * student who simply taps "der" every time cannot win by luck alone.
 */
export function pickQuestions(level: string | null | undefined, seed: string, n: number = DUEL_QUESTIONS): DuelQuestion[] {
  const pool = DECK[deckLevelOf(level)];
  const next = stream(seed);

  // Fisher–Yates over indices.
  const order = pool.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = next(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }

  const picked: DuelQuestion[] = [];
  const count: Record<Article, number> = { der: 0, die: 0, das: 0 };
  const cap = Math.ceil(n / 2); // no article may be more than half the round

  for (const index of order) {
    if (picked.length >= n) break;
    const [article, noun, gloss] = pool[index];
    if (count[article] >= cap) continue;
    count[article] += 1;
    picked.push({ noun, gloss, article });
  }
  // The cap can only leave us short on a tiny pool; top up rather than run a short round.
  for (const index of order) {
    if (picked.length >= n) break;
    const [article, noun, gloss] = pool[index];
    if (!picked.some((q) => q.noun === noun)) picked.push({ noun, gloss, article });
  }
  return picked;
}

export const publicQuestion = (q: DuelQuestion): PublicQuestion => ({ noun: q.noun, gloss: q.gloss });

export function pointsFor(correct: boolean, ms: number): number {
  if (!correct) return 0;
  const clamped = Math.min(MAX_MS, Math.max(MIN_MS, Number.isFinite(ms) ? ms : MAX_MS));
  const bonus = Math.max(0, SPEED_BONUS_MAX - Math.floor(clamped / 200));
  return BASE_POINTS + bonus;
}

export const isArticle = (value: unknown): value is Article => value === "der" || value === "die" || value === "das";

/**
 * Score one answer against the frozen question. The client says what it chose
 * and how long it took; the server decides whether that is right.
 */
export function scoreAnswer(question: DuelQuestion, i: number, choice: Article, ms: number): DuelAnswer {
  const correct = choice === question.article;
  const safeMs = Math.min(MAX_MS, Math.max(MIN_MS, Number.isFinite(ms) ? Math.round(ms) : MAX_MS));
  return { i, choice, correct, ms: safeMs, points: pointsFor(correct, safeMs) };
}

export const totalPoints = (answers: DuelAnswer[] | null | undefined): number =>
  (answers ?? []).reduce((sum, a) => sum + a.points, 0);

export const isFinished = (answers: DuelAnswer[] | null | undefined, questions: number = DUEL_QUESTIONS): boolean =>
  (answers ?? []).length >= questions;

export type DuelOutcome =
  | { done: false }
  | { done: true; winnerId: string | null; draw: boolean; pointsA: number; pointsB: number };

/** Both finished → a winner (or a draw). Otherwise the duel is still open. */
export function decideOutcome(input: {
  answersA: DuelAnswer[] | null;
  answersB: DuelAnswer[] | null;
  playerAId: string;
  playerBId: string;
  questions?: number;
}): DuelOutcome {
  const n = input.questions ?? DUEL_QUESTIONS;
  if (!isFinished(input.answersA, n) || !isFinished(input.answersB, n)) return { done: false };
  const pointsA = totalPoints(input.answersA);
  const pointsB = totalPoints(input.answersB);
  if (pointsA === pointsB) return { done: true, winnerId: null, draw: true, pointsA, pointsB };
  return { done: true, winnerId: pointsA > pointsB ? input.playerAId : input.playerBId, draw: false, pointsA, pointsB };
}
