"use client";

import { useMemo, useState } from "react";
import { buildWortsuche, dailySeed, type PuzzleWord } from "@/lib/word-puzzles";

/**
 * German word search — two taps (start then end) on a straight line find a word.
 */

type Cell = { r: number; c: number };

function lineBetween(a: Cell, b: Cell): Cell[] | null {
  const dr = Math.sign(b.r - a.r);
  const dc = Math.sign(b.c - a.c);
  const stepsR = Math.abs(b.r - a.r);
  const stepsC = Math.abs(b.c - a.c);
  if (stepsR !== 0 && stepsC !== 0 && stepsR !== stepsC) return null;
  const steps = Math.max(stepsR, stepsC);
  if (steps === 0) return [a];
  const out: Cell[] = [];
  for (let i = 0; i <= steps; i += 1) {
    out.push({ r: a.r + dr * i, c: a.c + dc * i });
  }
  return out;
}

export default function Wortsuche({
  level,
  materialWords,
  onComplete,
}: {
  level: string | null;
  materialWords?: PuzzleWord[];
  onComplete?: (found: number) => void;
}) {
  const seed = useMemo(() => dailySeed(), []);
  const puzzle = useMemo(() => buildWortsuche(level, seed, materialWords), [level, seed, materialWords]);

  const [found, setFound] = useState<Set<string>>(() => new Set());
  const [anchor, setAnchor] = useState<Cell | null>(null);
  const [hover, setHover] = useState<Cell | null>(null);
  const [flash, setFlash] = useState<"idle" | "ok" | "bad">("idle");

  const preview = useMemo(() => {
    if (!anchor) return [] as Cell[];
    if (!hover) return [anchor];
    return lineBetween(anchor, hover) ?? [anchor];
  }, [anchor, hover]);

  const previewKey = useMemo(() => new Set(preview.map((c) => `${c.r}:${c.c}`)), [preview]);

  const foundCells = useMemo(() => {
    const set = new Set<string>();
    for (const word of found) {
      for (const cell of puzzle.placements[word] ?? []) {
        set.add(`${cell.r}:${cell.c}`);
      }
    }
    return set;
  }, [found, puzzle.placements]);

  const tryCommit = (end: Cell) => {
    if (!anchor) return;
    const path = lineBetween(anchor, end);
    setAnchor(null);
    setHover(null);
    if (!path || path.length < 2) {
      setFlash("bad");
      window.setTimeout(() => setFlash("idle"), 400);
      return;
    }
    const forward = path.map((c) => puzzle.grid[c.r][c.c]).join("");
    const backward = [...path]
      .reverse()
      .map((c) => puzzle.grid[c.r][c.c])
      .join("");
    const match = puzzle.words.find(
      (w) => !found.has(w.word) && (w.word === forward || w.word === backward),
    );
    if (match) {
      const next = new Set(found).add(match.word);
      setFound(next);
      setFlash("ok");
      if (next.size >= puzzle.words.length) onComplete?.(next.size);
    } else {
      setFlash("bad");
    }
    window.setTimeout(() => setFlash("idle"), 450);
  };

  const allFound = found.size >= puzzle.words.length && puzzle.words.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--muted)]">Wortsuche</p>
        <p className="text-sm font-semibold text-[var(--accent)]">
          {found.size}/{puzzle.words.length} found
        </p>
      </div>

      {allFound ? (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4 text-center text-sm font-semibold text-[var(--foreground)]">
          Grid cleared — every word found.
        </div>
      ) : (
        <p className="text-xs text-[var(--muted)]">
          Tap a start letter, then an end letter in a straight line (including diagonals).
        </p>
      )}

      <div
        className={`mx-auto grid w-fit gap-1 rounded-2xl p-2 ${
          flash === "ok"
            ? "bg-emerald-500/10"
            : flash === "bad"
              ? "bg-rose-500/10"
              : "bg-[var(--surface-alt)]"
        }`}
        style={{ gridTemplateColumns: `repeat(${puzzle.size}, minmax(0, 1.75rem))` }}
      >
        {puzzle.grid.map((row, r) =>
          row.map((letter, c) => {
            const key = `${r}:${c}`;
            const selected = previewKey.has(key);
            const marked = foundCells.has(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  if (allFound) return;
                  if (!anchor) {
                    setAnchor({ r, c });
                    setHover({ r, c });
                    return;
                  }
                  tryCommit({ r, c });
                }}
                onPointerEnter={() => {
                  if (anchor) setHover({ r, c });
                }}
                className={`grid h-7 w-7 place-items-center rounded text-[11px] font-bold sm:h-8 sm:w-8 sm:text-xs ${
                  marked
                    ? "bg-[var(--accent)] text-white"
                    : selected
                      ? "bg-[#FF6600] text-white"
                      : "bg-[var(--surface)] text-[var(--foreground)]"
                }`}
              >
                {letter}
              </button>
            );
          }),
        )}
      </div>

      <ul className="flex flex-wrap gap-2">
        {puzzle.words.map((word) => {
          const isFound = found.has(word.word);
          return (
            <li
              key={word.word}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                isFound
                  ? "bg-emerald-500/15 text-emerald-700 line-through"
                  : "bg-[var(--surface-alt)] text-[var(--foreground)]"
              }`}
            >
              {isFound ? word.word : "••••"}
              <span className="ml-1 font-normal text-[var(--muted)]">({word.gloss})</span>
            </li>
          );
        })}
      </ul>

      {anchor ? (
        <button
          type="button"
          onClick={() => {
            setAnchor(null);
            setHover(null);
          }}
          className="text-xs font-semibold text-[var(--muted)]"
        >
          Cancel selection
        </button>
      ) : null}
    </div>
  );
}
