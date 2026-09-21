"use client";

import { useEffect, useState } from "react";

/** Same compromise as useLiveClass: fresh enough to matter, cheap enough for a metered line. */
const POLL_MS = 30_000;
/** Nobody is looking at a hidden tab. */
const HIDDEN_POLL_MS = 120_000;

/**
 * How many classes are on air, for the tutor and admin sidebars (see
 * /api/live/pulse). Students use `useLiveClass` instead — they also need the
 * join code and the ringing state, which this deliberately does not carry.
 *
 * A failed poll keeps the last known count: flipping the glow off because one
 * request timed out is the opposite of what it is for.
 */
export function useLiveCount(enabled = true): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const res = await fetch("/api/live/pulse", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { count?: number };
        if (!cancelled) setCount(Number(data.count) || 0);
      } catch {
        /* keep the last answer */
      }
    };

    const schedule = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        await poll();
        if (!cancelled) schedule();
      }, document.hidden ? HIDDEN_POLL_MS : POLL_MS);
    };

    void poll();
    schedule();

    const onVisible = () => {
      if (!document.hidden) {
        void poll();
        schedule();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (timer) window.clearTimeout(timer);
    };
  }, [enabled]);

  return count;
}
