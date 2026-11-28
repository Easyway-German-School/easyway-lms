/**
 * Solo German word puzzles — Wortbau (Scrabble-style tile build) and
 * Wortsuche (word search). Pure client-safe logic; vocab from the Wortduell
 * deck so answers stay certain and free to run.
 */

import { DECK, type DeckEntry } from "@/lib/duel-deck";
import { deckLevelOf } from "@/lib/duel";

export type PuzzleWord = {
  word: string;
  gloss: string;
  article: string;
};

export type WortbauRound = {
  target: PuzzleWord;
  tiles: string[];
};

export type WortsuchePuzzle = {
  size: number;
  grid: string[][];
  words: PuzzleWord[];
  /** row,col pairs for each word (for reveal / validation). */
  placements: Record<string, Array<{ r: number; c: number }>>;
};

type Rng = () => number;

function fnvStream(seed: string): Rng {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return (h >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function normalizeExtra(extras: PuzzleWord[] | undefined): PuzzleWord[] {
  if (!extras?.length) return [];
  const out: PuzzleWord[] = [];
  for (const item of extras) {
    const word = String(item.word ?? "")
      .trim()
      .toUpperCase()
      .replace(/[^A-ZÄÖÜß]/g, "");
    if (word.length < 3 || word.length > 12) continue;
    out.push({
      word,
      gloss: String(item.gloss ?? "").trim() || "from your materials",
      article: String(item.article ?? "").trim() || "",
    });
  }
  return out;
}

function pickWords(
  level: string | null | undefined,
  count: number,
  seed: string,
  extras?: PuzzleWord[],
): PuzzleWord[] {
  const deckLevel = deckLevelOf(level);
  const pool: DeckEntry[] = [...DECK[deckLevel]];
  // Fold in lower levels so A2+ still sees familiar A1 nouns.
  for (const lower of ["A1", "A2", "B1"] as const) {
    if (lower === deckLevel) break;
    pool.push(...DECK[lower]);
  }
  const rng = fnvStream(`${seed}:${deckLevel}`);
  const unique = new Map<string, PuzzleWord>();

  // Prefer words from the student's own materials / class notes first.
  for (const extra of shuffle(normalizeExtra(extras), rng)) {
    if (unique.has(extra.word)) continue;
    unique.set(extra.word, extra);
    if (unique.size >= count) break;
  }

  for (const [article, noun, gloss] of shuffle(pool, rng)) {
    if (unique.size >= count) break;
    const word = noun.toUpperCase();
    if (word.length < 3 || word.length > 12) continue;
    if (unique.has(word)) continue;
    unique.set(word, { word, gloss, article });
  }
  return [...unique.values()];
}

/** Scrabble-style rounds: shuffle the letters of a German noun. */
export function buildWortbauRounds(
  level: string | null | undefined,
  seed: string,
  rounds = 5,
  extras?: PuzzleWord[],
): WortbauRound[] {
  const words = pickWords(level, rounds, `wortbau:${seed}`, extras);
  const rng = fnvStream(`tiles:${seed}`);
  return words.map((target) => ({
    target,
    tiles: shuffle(target.word.split(""), rng),
  }));
}

const DIRS: Array<[number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [0, -1],
  [-1, 0],
  [-1, -1],
  [1, -1],
  [-1, 1],
];

function tryPlace(
  grid: (string | null)[][],
  word: string,
  r: number,
  c: number,
  dr: number,
  dc: number,
): Array<{ r: number; c: number }> | null {
  const size = grid.length;
  const cells: Array<{ r: number; c: number }> = [];
  for (let i = 0; i < word.length; i += 1) {
    const rr = r + dr * i;
    const cc = c + dc * i;
    if (rr < 0 || cc < 0 || rr >= size || cc >= size) return null;
    const existing = grid[rr][cc];
    if (existing && existing !== word[i]) return null;
    cells.push({ r: rr, c: cc });
  }
  for (let i = 0; i < word.length; i += 1) {
    grid[cells[i].r][cells[i].c] = word[i];
  }
  return cells;
}

/** Classic word search over level vocab (+ optional material words). */
export function buildWortsuche(
  level: string | null | undefined,
  seed: string,
  extras?: PuzzleWord[],
): WortsuchePuzzle {
  const size = 10;
  const words = pickWords(level, 6, `wortsuche:${seed}`, extras).sort(
    (a, b) => b.word.length - a.word.length,
  );
  const rng = fnvStream(`grid:${seed}`);
  const grid: (string | null)[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => null));
  const placements: Record<string, Array<{ r: number; c: number }>> = {};

  for (const item of words) {
    let placed = false;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const [dr, dc] = DIRS[Math.floor(rng() * DIRS.length)];
      const r = Math.floor(rng() * size);
      const c = Math.floor(rng() * size);
      const cells = tryPlace(grid, item.word, r, c, dr, dc);
      if (cells) {
        placements[item.word] = cells;
        placed = true;
        break;
      }
    }
    if (!placed) {
      // Fallback: place horizontally on first empty-ish row.
      for (let r = 0; r < size && !placed; r += 1) {
        const cells = tryPlace(grid, item.word, r, 0, 0, 1);
        if (cells) {
          placements[item.word] = cells;
          placed = true;
        }
      }
    }
  }

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ";
  const filled = grid.map((row) =>
    row.map((cell) => cell ?? alphabet[Math.floor(rng() * alphabet.length)]),
  );

  const placedWords = words.filter((w) => placements[w.word]);
  return { size, grid: filled, words: placedWords, placements };
}

export function dailySeed(now = new Date()): string {
  return `${now.getUTCFullYear()}-${now.getUTCMonth() + 1}-${now.getUTCDate()}`;
}

export function scoreWortbauWord(word: string): number {
  return Math.max(10, word.length * 12);
}

export function normalizeSelection(letters: string[]): string {
  return letters.join("").toUpperCase();
}
