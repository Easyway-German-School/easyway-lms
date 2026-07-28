"use client";

import { useEffect, useState } from "react";

type Entry = { name: string; xp: number; rank: number };

export default function Leaderboard() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchLeaderboard = async () => {
    setLoading(true);
    try {
      // Fallback mock: if no API, show local sample leaderboard
      // In future, swap to `/api/admin/leaderboard`.
      const mock: Entry[] = [
        { name: "Anna M.", xp: 4520, rank: 1 },
        { name: "Lukas K.", xp: 4210, rank: 2 },
        { name: "You", xp: 3980, rank: 3 },
      ];
      setEntries(mock);
    } catch (err) {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaderboard();
  }, []);

  return (
    <div>
      <h3 className="text-lg font-semibold text-[var(--foreground)]">Leaderboard</h3>
      <div className="mt-3 space-y-2">
        {loading ? (
          <div className="rounded-2xl bg-[var(--surface-alt)] p-4 text-[var(--muted)]">Loading leaderboard...</div>
        ) : (
          entries.map((e) => (
            <div key={e.rank} className="flex items-center justify-between rounded-lg bg-[var(--surface-alt)] p-3">
              <div>
                <p className="font-medium text-[var(--foreground)]">{e.rank}. {e.name}</p>
                <p className="text-xs text-[var(--muted)]">{e.xp} XP</p>
              </div>
              <div className="text-sm font-semibold text-[var(--accent)]">{e.rank === 1 ? "🏆" : e.rank === 2 ? "🥈" : e.rank === 3 ? "🥉" : ""}</div>
            </div>
          ))
        )}
      </div>
      <button onClick={fetchLeaderboard} className="mt-3 w-full rounded-lg bg-[var(--surface)] px-3 py-2 text-sm font-semibold text-[var(--foreground)] hover:brightness-95">Refresh</button>
    </div>
  );
}
