"use client";

/**
 * The Games tab.
 *
 * Turns you owe are at the top and nothing competes with them. Everything below
 * is browsing; that first block is the reason the tab exists, and burying it
 * under a grid of cards would trade the one mechanic that works for the
 * appearance of having more content.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import StudentShell from "@/components/StudentShell";
import { AlertIcon, ChainIcon, ClockIcon } from "@/components/icons";

type Waiting = {
  turnId: string;
  matchId: string;
  matchTitle: string;
  position: number;
  targetTurns: number;
  state: "pending" | "open";
  isMine: boolean;
  deadline: string;
  rule: string | null;
};

type Match = {
  id: string;
  title: string;
  prompt: string | null;
  status: string;
  targetTurns: number;
  turnCount: number;
  completedAt: string | null;
};

export default function GamesPage() {
  const { status } = useSession();
  const router = useRouter();

  const [waiting, setWaiting] = useState<Waiting[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/games", { cache: "no-store" });
      if (!res.ok) throw new Error("Could not load your games");
      const data = await res.json();
      setWaiting(data.waiting ?? []);
      setMatches(data.matches ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/auth/signin");
    if (status === "authenticated") void load();
  }, [status, router, load]);

  const active = matches.filter((match) => match.status === "active");
  const finished = matches.filter((match) => match.status === "completed");

  return (
    <StudentShell>
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <header className="mb-6">
          <h1 className="flex items-center gap-3 text-2xl font-bold text-[var(--foreground)] sm:text-3xl">
            <ChainIcon className="h-7 w-7 text-[var(--accent)]" />
            Games
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
            Your class writes a story together, one sentence each. You get a turn, you
            write one line in German, and it passes on. No rush — take your turn whenever
            you pick up your phone.
          </p>
        </header>

        {error ? (
          <p className="mb-4 flex items-center gap-2 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]">
            <AlertIcon className="h-4 w-4" /> {error}
          </p>
        ) : null}

        {loading ? (
          <p className="text-sm text-[var(--muted)]">Loading…</p>
        ) : (
          <div className="space-y-8">
            {waiting.length > 0 ? (
              <section>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Waiting on you
                </h2>
                <div className="space-y-3">
                  {waiting.map((turn) => (
                    <button
                      key={turn.turnId}
                      type="button"
                      onClick={() => router.push(`/games/${turn.matchId}`)}
                      className="w-full rounded-2xl border-2 border-[var(--accent)] bg-[var(--accent-soft)] px-5 py-4 text-left transition hover:brightness-105"
                    >
                      <p className="text-base font-bold text-[var(--foreground)]">
                        {turn.isMine ? "Your turn" : "A turn is going spare"} —{" "}
                        {turn.matchTitle}
                      </p>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        Sentence {turn.position} of {turn.targetTurns}
                        {turn.rule ? ` · ${turn.rule}` : ""}
                      </p>
                      {/* Said plainly rather than as a countdown. A ticking clock
                          on a writing task makes people write worse German, and
                          nothing bad happens at the deadline anyway — the turn
                          just stops being exclusively theirs. */}
                      <p className="mt-2 text-xs text-[var(--muted)]">
                        {turn.isMine
                          ? "Yours for a day, then anyone in the class can take it."
                          : "Nobody took this one in time. First there writes it."}
                      </p>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
                Your class is writing
              </h2>
              {active.length === 0 ? (
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
                  <p className="text-sm text-[var(--foreground)]">
                    Nothing on the go right now.
                  </p>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    Your tutor starts these. When one opens you will get a turn and a
                    notification — you do not have to keep checking.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {active.map((match) => (
                    <StoryCard key={match.id} match={match} onOpen={() => router.push(`/games/${match.id}`)} />
                  ))}
                </div>
              )}
            </section>

            {finished.length > 0 ? (
              <section>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Finished
                </h2>
                <div className="space-y-3">
                  {finished.map((match) => (
                    <StoryCard
                      key={match.id}
                      match={match}
                      onOpen={() => router.push(`/games/${match.id}`)}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        )}
      </div>
    </StudentShell>
  );
}

function StoryCard({ match, onOpen }: { match: Match; onOpen: () => void }) {
  const done = match.status === "completed";
  const written = Math.min(match.turnCount, match.targetTurns);
  const pct = Math.round((written / Math.max(1, match.targetTurns)) * 100);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4 text-left transition hover:border-[var(--border-strong)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-[var(--foreground)]">
            {match.title}
          </p>
          {match.prompt ? (
            <p className="mt-0.5 line-clamp-2 text-sm text-[var(--muted)]">{match.prompt}</p>
          ) : null}
        </div>
        {done ? null : <ClockIcon className="mt-1 h-4 w-4 shrink-0 text-[var(--muted)]" />}
      </div>

      <div className="mt-3">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-alt)]">
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-1.5 text-xs text-[var(--muted)]">
          {done
            ? `Finished — ${match.targetTurns} sentences`
            : `${written} of ${match.targetTurns} sentences`}
        </p>
      </div>
    </button>
  );
}
