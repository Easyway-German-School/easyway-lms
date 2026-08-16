"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useMoment } from "@/lib/moment-queue";
import { ChainIcon } from "@/components/icons";

/**
 * The games section, reduced to the one line that earns an interruption.
 *
 * Was a full dashboard card. Nothing on it changes hour to hour — a turn
 * either is or isn't waiting — so it belongs in the moment queue like every
 * other recurring nudge, not stapled to the page. Browsing stories, seeing
 * who is playing, starting one: all of that stays on /games. This is only
 * "someone needs a sentence from you," with a link to go write it.
 */
export default function GameTurnToast() {
  const { status } = useSession();
  const [waitingCount, setWaitingCount] = useState(0);
  const due = waitingCount > 0;
  const { open, close } = useMoment("game-turn", due);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/api/games", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        setWaitingCount(Array.isArray(data.waiting) ? data.waiting.length : 0);
      } catch {
        // A missed check just tries again on the next tick.
      }
    }

    void check();
    // Turns are already pushed by notify() — this is a slow background poll,
    // just enough to catch one arriving while the tab is open.
    const interval = window.setInterval(check, 90_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [status]);

  if (!open) return null;

  return (
    <div className="fixed bottom-6 left-1/2 z-50 w-[min(92vw,420px)] -translate-x-1/2 rounded-3xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4 text-sm text-[var(--foreground)] shadow-xl shadow-black/10">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-ink)]">
          <ChainIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {waitingCount === 1 ? "A turn is waiting for you" : `${waitingCount} turns are waiting for you`}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Your class is writing a story — one sentence, whenever you have a moment.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <Link
              href="/games"
              onClick={close}
              className="rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white"
            >
              Take my turn
            </Link>
            <button type="button" onClick={close} className="text-xs text-[var(--muted)]">
              Later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
