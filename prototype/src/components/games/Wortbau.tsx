"use client";

import { useCallback, useMemo, useState } from "react";
import { buildWortbauRounds, dailySeed, scoreWortbauWord, type PuzzleWord } from "@/lib/word-puzzles";

/**
 * Scrabble-style letter rack: tap tiles to rebuild a German noun.
 * Five rounds per sitting; completion is reported to the parent.
 */

export default function Wortbau({
  level,
  materialWords,
  onComplete,
}: {
  level: string | null;
  materialWords?: PuzzleWord[];
  onComplete?: (score: number) => void;
}) {
  const seed = useMemo(() => dailySeed(), []);
  const rounds = useMemo(
    () => buildWortbauRounds(level, seed, 5, materialWords),
    [level, seed, materialWords],
  );

  const [index, setIndex] = useState(0);
  const [built, setBuilt] = useState<number[]>([]);
  const [used, setUsed] = useState<Set<number>>(() => new Set());
  const [score, setScore] = useState(0);
  const [feedback, setFeedback] = useState<"idle" | "ok" | "bad">("idle");
  const [done, setDone] = useState(false);
  const [hint, setHint] = useState(false);

  const round = rounds[index];

  const resetRound = useCallback(() => {
    setBuilt([]);
    setUsed(new Set());
    setFeedback("idle");
    setHint(false);
  }, []);

  const tapTile = (tileIndex: number) => {
    if (!round || done || used.has(tileIndex) || feedback === "ok") return;
    setBuilt((prev) => [...prev, tileIndex]);
    setUsed((prev) => new Set(prev).add(tileIndex));
    setFeedback("idle");
  };

  const undo = () => {
    if (feedback === "ok") return;
    setBuilt((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.slice(0, -1);
      setUsed(new Set(next));
      return next;
    });
    setFeedback("idle");
  };

  const clear = () => {
    if (feedback === "ok") return;
    resetRound();
  };

  const check = () => {
    if (!round) return;
    const guess = built.map((i) => round.tiles[i]).join("");
    if (guess === round.target.word) {
      const gained = scoreWortbauWord(round.target.word);
      const nextScore = score + gained;
      setScore(nextScore);
      setFeedback("ok");
      window.setTimeout(() => {
        if (index + 1 >= rounds.length) {
          setDone(true);
          onComplete?.(nextScore);
        } else {
          setIndex((i) => i + 1);
          resetRound();
        }
      }, 700);
    } else {
      setFeedback("bad");
    }
  };

  if (!round) {
    return <p className="text-sm text-[var(--muted)]">No words available for your level yet.</p>;
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] p-5 text-center">
        <p className="text-lg font-bold text-[var(--foreground)]">Rack cleared</p>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {rounds.length} words · {score} points
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
          Wortbau · Round {index + 1}/{rounds.length}
        </p>
        <p className="text-sm font-semibold tabular-nums text-[var(--accent)]">{score} pts</p>
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-4">
        <p className="text-center text-xs text-[var(--muted)]">Build the German noun</p>
        <div
          className={`mt-3 flex min-h-[3rem] flex-wrap justify-center gap-1.5 rounded-xl border-2 border-dashed px-3 py-2 ${
            feedback === "ok"
              ? "border-emerald-500 bg-emerald-500/10"
              : feedback === "bad"
                ? "border-rose-400 bg-rose-500/10"
                : "border-[var(--border)] bg-[var(--surface)]"
          }`}
        >
          {built.length === 0 ? (
            <span className="self-center text-sm text-[var(--muted)]">Tap tiles below</span>
          ) : (
            built.map((tileIndex, i) => (
              <span
                key={`${tileIndex}-${i}`}
                className="grid h-10 w-10 place-items-center rounded-lg bg-[var(--accent)] text-sm font-black text-white shadow"
              >
                {round.tiles[tileIndex]}
              </span>
            ))
          )}
        </div>
        <button
          type="button"
          onClick={() => setHint(true)}
          className="mt-3 w-full text-center text-xs font-semibold text-[var(--muted)] hover:text-[var(--accent)]"
        >
          {hint ? (
            <span>
              {round.target.article} · {round.target.gloss}
            </span>
          ) : (
            "Need a hint?"
          )}
        </button>
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        {round.tiles.map((letter, tileIndex) => {
          const taken = used.has(tileIndex);
          return (
            <button
              key={tileIndex}
              type="button"
              disabled={taken || feedback === "ok"}
              onClick={() => tapTile(tileIndex)}
              className={`grid h-12 w-12 place-items-center rounded-xl text-base font-black shadow transition ${
                taken
                  ? "bg-[var(--surface-alt)] text-[var(--muted)] opacity-40"
                  : "bg-[var(--surface)] text-[var(--foreground)] ring-1 ring-[var(--border)] hover:-translate-y-0.5 hover:ring-[var(--accent)]"
              }`}
            >
              {letter}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={undo}
          className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--muted)]"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={clear}
          className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--muted)]"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={check}
          disabled={built.length === 0 || feedback === "ok"}
          className="ml-auto rounded-full bg-[var(--accent)] px-5 py-2 text-xs font-bold text-white disabled:opacity-50"
        >
          Check
        </button>
      </div>
    </div>
  );
}
