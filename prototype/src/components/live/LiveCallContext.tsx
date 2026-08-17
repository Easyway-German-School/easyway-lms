"use client";

/**
 * The one place a live class's connection lives, independent of which page
 * is on screen.
 *
 * Before this existed, `LiveKitClassroom` was mounted directly by `/live`'s
 * page component. That meant navigating anywhere else — materials, the
 * dashboard, community — unmounted it, which tore the LiveKit room down
 * (`disconnectOnPageLeave` plus the connect effect's own cleanup both do
 * this). A student who tapped away to check a chat message lost their seat
 * in the lesson.
 *
 * The fix is to own the call one layer up, in the root layout, which Next
 * does not remount on client-side navigation. `/live` becomes a page that
 * ASKS this context to start a call; `LiveCallDock` (mounted once, in
 * `app/layout.tsx`) is the only thing that ever renders `LiveKitClassroom`,
 * so the component instance — and the Room inside it — survives however far
 * the student wanders.
 *
 * The tutor heartbeat lives here too, for the same reason: it has to keep
 * beating while the call is minimized and the student portal is showing a
 * completely different page, or the class expires under a tutor who only
 * meant to glance at the roster.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { LeaveOutcome } from "./LiveKitClassroom";
import type { LiveSession } from "@/lib/live-call-session";
import type { QualityMode } from "@/lib/live-classroom";

export type DockState = "full" | "minimized";

type ActiveCall = {
  session: LiveSession;
  mode: QualityMode;
};

type PendingOutcome = {
  roomName: string;
  outcome: LeaveOutcome;
};

type LiveCallContextValue = {
  activeCall: ActiveCall | null;
  dockState: DockState;
  setDockState: (state: DockState) => void;
  startCall: (session: LiveSession, mode: QualityMode) => void;
  reportLeave: (outcome: LeaveOutcome) => void;
  /** Called by the page that started the call, once, to claim the outcome and clear it. */
  takeOutcomeFor: (roomName: string) => LeaveOutcome | null;
};

const LiveCallCtx = createContext<LiveCallContextValue | null>(null);

export function LiveCallProvider({ children }: { children: React.ReactNode }) {
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [dockState, setDockState] = useState<DockState>("full");
  const pendingOutcomeRef = useRef<PendingOutcome | null>(null);
  // A departure must end the class (for a tutor) exactly once, same rule
  // the old page-level `endedRef` enforced — moved here since the tutor can
  // now leave from a minimized dock with no page listening at all.
  const endedRef = useRef(false);

  const startCall = useCallback((session: LiveSession, mode: QualityMode) => {
    endedRef.current = false;
    pendingOutcomeRef.current = null;
    setActiveCall({ session, mode });
    setDockState("full");
  }, []);

  const endClassOnServer = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;
    void fetch("/api/live/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "end" }),
    }).catch(() => {});
  }, []);

  const reportLeave = useCallback(
    (outcome: LeaveOutcome) => {
      setActiveCall((current) => {
        if (!current) return current;
        // Only a tutor's OWN deliberate departure ends the class for everyone
        // — a drop, a removal, or a student leaving must never do this. Same
        // rule the page used to enforce, now enforced here since the page
        // may not even be mounted when this fires.
        if (current.session.role === "tutor" && outcome.reason === "self") {
          endClassOnServer();
        }
        pendingOutcomeRef.current = { roomName: current.session.roomName, outcome };
        return null;
      });
    },
    [endClassOnServer],
  );

  const takeOutcomeFor = useCallback((roomName: string): LeaveOutcome | null => {
    const pending = pendingOutcomeRef.current;
    if (!pending || pending.roomName !== roomName) return null;
    pendingOutcomeRef.current = null;
    return pending.outcome;
  }, []);

  // THE TUTOR'S HEARTBEAT — moved from the /live page so it keeps beating
  // while minimized or while the tutor is looking at some other screen
  // entirely. See the original comment in the old page.tsx: an open session
  // is what tells forty students the class is on, so it must not silently
  // expire because the tutor's browser tab is no longer `/live`.
  const isTutor = activeCall?.session.role === "tutor";
  const liveSessionId = activeCall?.session.liveSessionId ?? null;
  const heartbeatMs = activeCall?.session.heartbeatMs ?? 45_000;
  const beating = Boolean(isTutor && liveSessionId);

  useEffect(() => {
    if (!beating) return;

    const beat = () => {
      void fetch("/api/live/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "heartbeat" }),
      }).catch(() => {});
    };

    beat();
    const timer = window.setInterval(beat, heartbeatMs);
    return () => window.clearInterval(timer);
  }, [beating, heartbeatMs]);

  const value = useMemo<LiveCallContextValue>(
    () => ({ activeCall, dockState, setDockState, startCall, reportLeave, takeOutcomeFor }),
    [activeCall, dockState, startCall, reportLeave, takeOutcomeFor],
  );

  return <LiveCallCtx.Provider value={value}>{children}</LiveCallCtx.Provider>;
}

export function useLiveCall(): LiveCallContextValue {
  const ctx = useContext(LiveCallCtx);
  if (!ctx) throw new Error("useLiveCall must be used inside LiveCallProvider");
  return ctx;
}
