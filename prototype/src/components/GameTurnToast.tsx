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
/**
 * How long "Later" buys. Every other queued moment owns a longer-than-one-
 * visit memory of its own (a server stamp, a per-level localStorage key) —
 * this one didn't, and `StudentShell` (and the queue inside it) remounts on
 * every single page navigation, not once per session. So a real waiting turn
 * re-claimed the toast, and won the queue, on the very next page the student
 * opened — "Later" was answered by the same popup a click away. A few hours'
 * snooze is what the other moments get in spirit; the turn itself is still
 * exactly where it was in the game.
 */
const SNOOZE_KEY = "ew-game-turn-snoozed-until";
const SNOOZE_MS = 3 * 60 * 60 * 1000;

function isSnoozed(): boolean {
  try {
    const until = Number(window.localStorage.getItem(SNOOZE_KEY) ?? 0);
    return Date.now() < until;
  } catch {
    return false;
  }
}

function snooze() {
  try {
    window.localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
  } catch {
    // Private browsing can refuse storage — worst case the toast reappears
    // sooner than intended, which is the behaviour before this fix existed.
  }
}

function clearSnooze() {
  try {
    window.localStorage.removeItem(SNOOZE_KEY);
  } catch {
    // See snooze() above.
  }
}

export default function GameTurnToast() {
  const { status } = useSession();
  const [waitingCount, setWaitingCount] = useState(0);
  const [snoozed, setSnoozed] = useState(true); // starts true so SSR/first paint never flashes it before the localStorage check below runs
  const due = waitingCount > 0 && !snoozed;
  const { open, close } = useMoment("game-turn", due);

  useEffect(() => {
    setSnoozed(isSnoozed());
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/api/games", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const count = Array.isArray(data.waiting) ? data.waiting.length : 0;
        setWaitingCount(count);
        // Re-checked on the same poll rather than left as whatever it was on
        // mount, so a snooze that expires while the tab stays open quietly
        // lifts itself instead of needing a reload to notice.
        setSnoozed(isSnoozed());
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

  const handleLater = () => {
    snooze();
    setSnoozed(true);
    close();
  };
  const handleTakeTurn = () => {
    clearSnooze();
    close();
  };

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
              onClick={handleTakeTurn}
              className="rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white"
            >
              Take my turn
            </Link>
            <button type="button" onClick={handleLater} className="text-xs text-[var(--muted)]">
              Later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
