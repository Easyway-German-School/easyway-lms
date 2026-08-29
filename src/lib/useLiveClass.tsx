"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * "Is my class live?", asked once for the whole portal.
 *
 * Every surface that reacts to a live class — the ringing overlay in the shell,
 * the dashboard banner, the sidebar dot — reads from this. They must agree: a
 * banner saying the class is on while the overlay has given up is worse than
 * either one alone, and two components polling the same endpoint on two
 * timers is exactly how that happens.
 */

export type LiveClassState = {
  id: string;
  title: string;
  joinCode: string;
  kind: string;
  startedAt: string;
  tutorName: string | null;
  /** The tutor rang this student by name, not the room. */
  personal: boolean;
  inviteStatus: string | null;
};

/**
 * How often we ask.
 *
 * Twenty seconds, and the number is a compromise with a real cost on each side.
 * Faster means a student on a metered Nigerian line pays for polling all day to
 * shave seconds off a notification their phone already buzzed for. Slower and
 * the overlay arrives after the tutor has given up on them. Twenty seconds
 * keeps the worst case under half a minute at roughly 180 requests over a
 * one-hour session, each one two indexed lookups.
 */
const POLL_MS = 20_000;

/** Backed off to this once the tab is hidden. Nobody is looking. */
const HIDDEN_POLL_MS = 90_000;

export type LiveClassValue = {
  live: LiveClassState | null;
  loading: boolean;
  refresh: () => void;
};

/**
 * ONE POLL FOR THE WHOLE PORTAL.
 *
 * The shell's sidebar dot, the dashboard banner and the ringing overlay all
 * want the same answer, and if each called the hook directly they would each
 * open their own twenty-second timer. That is three times the requests for a
 * strictly worse result: the three would drift out of step, so the dot could
 * still be lit while the overlay had already given up. Provider at the top of
 * the shell, everyone else reads the context.
 */
const LiveClassContext = createContext<LiveClassValue | null>(null);

export function LiveClassProvider({ enabled = true, children }: { enabled?: boolean; children: ReactNode }) {
  const value = useLiveClassPoll(enabled);
  return <LiveClassContext.Provider value={value}>{children}</LiveClassContext.Provider>;
}

/**
 * Read the shared state. Safe to call outside the provider — a component that
 * ends up on a page without the student shell gets "nothing is live" rather
 * than a crash, which is the correct answer there anyway.
 */
export function useLiveClass(): LiveClassValue {
  return useContext(LiveClassContext) ?? { live: null, loading: false, refresh: () => {} };
}

function useLiveClassPoll(enabled = true): LiveClassValue {
  const [live, setLive] = useState<LiveClassState | null>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<number | null>(null);
  const alive = useRef(true);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/live/state", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (!alive.current) return;
      setLive(data.live ?? null);
    } catch {
      // A failed poll leaves the last known state alone. Flipping the overlay
      // off because one request timed out on a bad line is the opposite of
      // what this is for.
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    // No poll to wait for, so there is nothing to report as loading. Derived
    // below rather than written here — an effect that only exists to correct a
    // piece of state is a render where the state was wrong.
    if (!enabled) return;

    void poll();

    function schedule() {
      if (timer.current) window.clearTimeout(timer.current);
      const delay = document.hidden ? HIDDEN_POLL_MS : POLL_MS;
      timer.current = window.setTimeout(async () => {
        await poll();
        schedule();
      }, delay);
    }

    schedule();

    // Coming back to the tab is the moment a student is most likely to want an
    // answer, and the moment the answer is most likely to be stale.
    const onVisible = () => {
      if (!document.hidden) {
        void poll();
        schedule();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      alive.current = false;
      document.removeEventListener("visibilitychange", onVisible);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [enabled, poll]);

  return useMemo(
    () => ({ live, loading: enabled && loading, refresh: poll }),
    [live, enabled, loading, poll],
  );
}
