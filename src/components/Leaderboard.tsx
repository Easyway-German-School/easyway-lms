"use client";

import { useCallback, useEffect, useState } from "react";
import { MedalIcon, TrophyIcon } from "@/components/icons";

/**
 * The cohort leaderboard.
 *
 * This component used to render three invented students — "Anna M., 4520 XP" —
 * from a hardcoded array, behind a comment saying a real endpoint would come
 * later. It was never mounted on a page, which is the only reason no student
 * was ever shown a classmate who does not exist beating them. It now reads
 * `/api/student/leaderboard`, which ranks the student's OWN cohort (branch,
 * level and sitting) using the same XP function their dashboard uses.
 */

type Entry = { name: string; xp: number; rank: number; isMe: boolean };
type You = { rank: number; xp: number; inTop: boolean };

export default function Leaderboard() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [you, setYou] = useState<You | null>(null);
  const [cohortSize, setCohortSize] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/student/leaderboard", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load the leaderboard");
      setEntries(data.entries ?? []);
      setYou(data.you ?? null);
      setCohortSize(data.cohortSize ?? 0);
    } catch (loadError) {
      // Says so, rather than silently rendering an empty board that reads as
      // "nobody in your class has done anything".
      setError(loadError instanceof Error ? loadError.message : "Could not load the leaderboard");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold text-[var(--foreground)]">Leaderboard</h3>
        {cohortSize > 0 ? (
          <span className="text-xs text-[var(--muted)]">your class · {cohortSize} students</span>
        ) : null}
      </div>

      <div className="mt-3 space-y-2">
        {loading ? (
          <div className="rounded-2xl bg-[var(--surface-alt)] p-4 text-sm text-[var(--muted)]">Loading…</div>
        ) : error ? (
          <div className="rounded-2xl bg-[var(--surface-alt)] p-4 text-sm text-[var(--muted)]">{error}</div>
        ) : entries.length === 0 ? (
          <div className="rounded-2xl bg-[var(--surface-alt)] p-4 text-sm text-[var(--muted)]">
            Nothing to rank yet. Attend a class or hand in some work and this fills up.
          </div>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.rank}
              className={`flex items-center justify-between rounded-lg p-3 ${
                entry.isMe ? "bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]" : "bg-[var(--surface-alt)]"
              }`}
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-[var(--foreground)]">
                  {entry.rank}. {entry.isMe ? "You" : entry.name}
                </p>
                <p className="text-xs text-[var(--muted)]">{entry.xp.toLocaleString()} XP</p>
              </div>
              <div className="shrink-0 text-[var(--accent)]">
                {entry.rank === 1 ? (
                  <TrophyIcon className="h-5 w-5" />
                ) : entry.rank <= 3 ? (
                  <MedalIcon className="h-5 w-5" />
                ) : null}
              </div>
            </div>
          ))
        )}

        {/*
          Somebody in 34th place still gets to see where they are. A board that
          only shows the top three tells a struggling student nothing except
          that they are not on it.
        */}
        {you && !you.inTop ? (
          <div className="flex items-center justify-between rounded-lg bg-[var(--accent-soft)] p-3 ring-1 ring-[var(--accent)]">
            <div>
              <p className="font-medium text-[var(--foreground)]">{you.rank}. You</p>
              <p className="text-xs text-[var(--muted)]">{you.xp.toLocaleString()} XP</p>
            </div>
          </div>
        ) : null}
      </div>

      <button
        onClick={() => void load()}
        disabled={loading}
        className="mt-3 w-full rounded-lg bg-[var(--surface)] px-3 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:brightness-95 disabled:opacity-50"
      >
        Refresh
      </button>
    </div>
  );
}
