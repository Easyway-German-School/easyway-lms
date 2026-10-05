"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import Avatar from "@/components/Avatar";
import { CheckCircleIcon, CoinIcon, CrossCircleIcon } from "@/components/icons";
import type { DuelView } from "@/lib/campus-server";

/**
 * A WORTDUELL, from one player's phone.
 *
 * Eight words, three buttons. Each answer goes to the server, which says right
 * or wrong (so there is no answer on the phone to peek at) and the colour
 * flashes straight away — that instant yes/no is most of why quiz games are
 * hard to put down. When you finish you wait, at most a few minutes, for the
 * other player; nothing is lost if you leave, because the result is kept.
 */

// Defined here, not imported from lib/duel: that module carries the answer deck, which must never ship to a browser.
const ARTICLES = ["der", "die", "das"] as const;

const FEEDBACK_MS = 850;
const WAIT_POLL_MS = 4000;
const WAIT_GIVE_UP_MS = 3 * 60_000;

const ARTICLE_STYLE: Record<string, string> = {
  der: "bg-[#E6F1FB] text-[#0C447C]",
  die: "bg-[#FBEAF0] text-[#72243E]",
  das: "bg-[#EAF3DE] text-[#27500A]",
};

export default function DuelView({ id }: { id: string }) {
  const [view, setView] = useState<DuelView | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<{ choice: string; correct: boolean; article: string } | null>(null);
  const [coins, setCoins] = useState(0);
  const [giveUp, setGiveUp] = useState(false);
  const shownAt = useRef(Date.now());

  const load = useCallback(async () => {
    const res = await fetch(`/api/campus/duel/${id}`, { cache: "no-store" });
    if (!res.ok) {
      setError(res.status === 404 ? "This duel doesn't exist." : "Couldn't load the duel.");
      return null;
    }
    const data = (await res.json()) as DuelView;
    setView(data);
    return data;
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const index = view ? view.mine.length : 0;
  const finished = Boolean(view && index >= view.total);

  // Each new word starts its own clock.
  useEffect(() => {
    shownAt.current = Date.now();
  }, [index]);

  // After my last answer, wait for the other player — gently, and not forever.
  useEffect(() => {
    if (!view || !finished || view.result || view.status !== "active") return;
    const started = Date.now();
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - started > WAIT_GIVE_UP_MS) {
        setGiveUp(true);
        window.clearInterval(timer);
        return;
      }
      await load();
    }, WAIT_POLL_MS);
    return () => window.clearInterval(timer);
  }, [view, finished, load]);

  async function answer(choice: string) {
    if (!view || picked || finished) return;
    const ms = Date.now() - shownAt.current;
    const i = index;
    try {
      const res = await fetch(`/api/campus/duel/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ i, choice, ms }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Couldn't save that answer.");
        return;
      }
      setPicked({ choice, correct: data.correct, article: data.article });
      if (data.coins) setCoins((c) => c + data.coins);
      window.setTimeout(async () => {
        setPicked(null);
        // Reload from the server so my score, the opponent's progress and the result are all the real ones.
        await load();
      }, FEEDBACK_MS);
    } catch {
      setError("Lost connection. Your answers so far are saved — try again.");
    }
  }

  if (error && !view) {
    return (
      <>
        <div className="mx-auto max-w-md px-4 py-16 text-center">
          <p className="text-lg font-extrabold">{error}</p>
          <Link href="/campus/arena" className="mt-4 inline-block rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-extrabold text-white">
            Back to the Arena
          </Link>
        </div>
      </>
    );
  }

  if (!view) {
    return (
      <>
        <p className="px-4 py-16 text-center text-sm text-[var(--muted)]">Getting your duel ready…</p>
      </>
    );
  }

  const q = view.questions[Math.min(index, view.total - 1)];

  return (
    <>
      <div className="mx-auto max-w-md px-4 pb-10 pt-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Avatar config={view.opponent.avatar} seed={view.opponent.name} size={36} />
            <div>
              <p className="text-sm font-extrabold leading-tight">vs {view.opponent.name}</p>
              <p className="text-xs text-[var(--muted)]">{view.level} words</p>
            </div>
          </div>
          <span className="rounded-full bg-[var(--surface-alt)] px-3 py-1.5 text-sm font-extrabold tabular-nums">{view.myPoints} pts</span>
        </div>

        <div className="mt-4 flex gap-1.5" aria-label={`Word ${Math.min(index + 1, view.total)} of ${view.total}`}>
          {Array.from({ length: view.total }, (_, i) => {
            const done = view.mine[i];
            return (
              <span
                key={i}
                className={`h-2 flex-1 rounded-full ${done ? (done.correct ? "bg-emerald-500" : "bg-rose-500") : i === index ? "bg-[var(--accent)]" : "bg-[var(--surface-alt)]"}`}
              />
            );
          })}
        </div>

        {!finished && view.status === "active" ? (
          <>
            <div className="mt-8 rounded-[2rem] border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-[var(--muted)]">
                Word {index + 1} of {view.total}
              </p>
              <p className="mt-4 text-5xl font-black tracking-tight">{q.noun}</p>
              <p className="mt-2 text-sm text-[var(--muted)]">{q.gloss}</p>

              {picked ? (
                <p className={`mt-5 inline-flex items-center gap-2 text-lg font-extrabold ${picked.correct ? "text-emerald-600" : "text-rose-600"}`}>
                  {picked.correct ? <CheckCircleIcon className="h-6 w-6" /> : <CrossCircleIcon className="h-6 w-6" />}
                  {picked.correct ? "Richtig!" : `Es heißt ${picked.article} ${q.noun}`}
                </p>
              ) : (
                <p className="mt-5 text-sm font-semibold text-[var(--muted)]">Which article?</p>
              )}
            </div>

            <div className="mt-5 grid grid-cols-3 gap-3">
              {ARTICLES.map((article) => {
                const isPicked = picked?.choice === article;
                const isRight = picked && picked.article === article;
                return (
                  <button
                    key={article}
                    type="button"
                    disabled={Boolean(picked)}
                    onClick={() => answer(article)}
                    className={`rounded-3xl py-6 text-2xl font-black transition active:scale-95 ${ARTICLE_STYLE[article]} ${
                      picked ? (isRight ? "ring-4 ring-emerald-500" : isPicked ? "opacity-60 ring-4 ring-rose-500" : "opacity-40") : ""
                    }`}
                  >
                    {article}
                  </button>
                );
              })}
            </div>
            {error ? <p className="mt-3 text-center text-sm font-semibold text-[var(--danger)]">{error}</p> : null}
          </>
        ) : view.result ? (
          <ResultCard view={view} coins={coins} />
        ) : view.status === "expired" ? (
          <div className="mt-8 rounded-[2rem] border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
            <p className="text-lg font-extrabold">This duel timed out</p>
            <p className="mt-1 text-sm text-[var(--muted)]">The other player didn&apos;t finish in time. Your coins for playing are safe.</p>
            <ArenaLink />
          </div>
        ) : (
          <div className="mt-8 rounded-[2rem] border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-[var(--muted)]">You&apos;re done</p>
            <p className="mt-3 text-4xl font-black">{view.myPoints} pts</p>
            {coins > 0 ? <CoinLine coins={coins} /> : null}
            <p className="mt-4 text-sm font-semibold">
              {view.opponent.name} is on word {Math.min(view.opponent.answered + 1, view.total)} of {view.total}
            </p>
            <div className="mx-auto mt-2 h-2 max-w-[12rem] overflow-hidden rounded-full bg-[var(--surface-alt)]">
              <div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${(view.opponent.answered / view.total) * 100}%` }} />
            </div>
            <p className="mt-3 text-xs text-[var(--muted)]">
              {giveUp ? "Taking a while — you can leave. The result will be waiting in the Arena." : "Waiting for them to finish…"}
            </p>
            {giveUp ? <ArenaLink /> : null}
          </div>
        )}
      </div>
    </>
  );
}

function CoinLine({ coins }: { coins: number }) {
  return (
    <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[var(--warning-soft)] px-3 py-1 text-sm font-extrabold text-[var(--warning)]">
      <CoinIcon className="h-4 w-4" strokeWidth={2.2} /> +{coins} coins
    </p>
  );
}

function ArenaLink() {
  return (
    <Link href="/campus/arena" className="mt-5 inline-block rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-extrabold text-white">
      Back to the Arena
    </Link>
  );
}

function ResultCard({ view, coins }: { view: DuelView; coins: number }) {
  const r = view.result!;
  const headline = r.winner === "me" ? "You won!" : r.winner === "draw" ? "It's a draw" : `${view.opponent.name} won`;
  const tint = r.winner === "me" ? "#EAF3DE" : r.winner === "draw" ? "#FAEEDA" : "#EEEDFE";
  const ink = r.winner === "me" ? "#27500A" : r.winner === "draw" ? "#633806" : "#3C3489";
  return (
    <div className="mt-8 rounded-[2rem] p-8 text-center" style={{ background: tint, color: ink }}>
      <p className="text-xs font-bold uppercase tracking-[0.25em]">Result</p>
      <p className="mt-2 text-3xl font-black">{headline}</p>
      <p className="mt-3 text-lg font-extrabold tabular-nums">
        {r.myPoints} <span className="opacity-60">vs</span> {r.theirPoints}
      </p>
      {coins > 0 ? <CoinLine coins={coins} /> : null}
      <p className="mt-3 text-sm opacity-80">
        {view.mine.filter((a) => a.correct).length} of {view.total} right
      </p>
      <ArenaLink />
    </div>
  );
}
