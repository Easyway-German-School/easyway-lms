"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useSession } from "next-auth/react";

import {
  SLOW_RETRY_MS,
  confirmSession,
  probeSession,
  reportPortalFromPath,
  type ReportOutcome,
} from "@/lib/session-confirm";

/**
 * `useSession`, except "unauthenticated" is only reported once the server has
 * actually said there is no session.
 *
 * Drop-in: same return shape. While next-auth says "unauthenticated" and we
 * are still finding out, `status` reads "loading" — which every portal shell
 * already renders as its loading screen — so nobody is redirected on a
 * dropped request. See lib/session-confirm.ts for the reasoning and the rules.
 *
 * The check is shared. A page mounts several components that call this hook;
 * they all watch ONE episode rather than each probing the server.
 */

type Phase = "idle" | "checking" | "signed_out";

let phase: Phase = "idle";
let running = false;
let epoch = 0;
/** Seen signed in during this page's life — what makes a later sign-out "unexpected". */
let wasAuthenticated = false;
/** Set by the Sign out button so a deliberate sign-out is not reported as a fault. */
let intentionalSignOut = false;
const listeners = new Set<() => void>();

function setPhase(next: Phase) {
  if (phase === next) return;
  phase = next;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Called by the Sign out button, before it signs out. */
export function markIntentionalSignOut() {
  intentionalSignOut = true;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Tell the server what happened, so "everyone got logged out" arrives as
 * numbers. Fire-and-forget: a report that could break the page it describes
 * is worse than none, and when the network is the problem it may simply not
 * get through — the recovery report after it does.
 */
function report(outcome: ReportOutcome, attempts: number) {
  try {
    const body = JSON.stringify({
      outcome,
      attempts,
      portal: reportPortalFromPath(window.location.pathname),
      online: navigator.onLine,
      hidden: document.hidden,
      onLivePage: window.location.pathname.startsWith("/live"),
    });
    void fetch("/api/client/auth-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Never let reporting disturb the page.
  }
}

/**
 * The provider would not flip back to signed in after the server said the
 * session is fine. Reload once — and only once a minute, so a genuinely odd
 * state cannot become a reload loop.
 */
function reloadOnce() {
  try {
    const key = "easyway:session-reload-at";
    const last = Number(sessionStorage.getItem(key) ?? 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    // Storage blocked: a reload we cannot rate-limit is not worth the risk.
    return;
  }
  window.location.reload();
}

async function runEpisode(refresh: () => Promise<unknown>) {
  if (running) return;
  running = true;
  const mine = ++epoch;
  setPhase("checking");

  let reportedUnreachable = false;
  try {
    for (;;) {
      const { verdict, attempts } = await confirmSession({
        probe: () => probeSession(),
        sleep,
        cancelled: () => mine !== epoch,
      });
      if (mine !== epoch || verdict === "cancelled") return;

      if (verdict === "signed_out") {
        if (wasAuthenticated && !intentionalSignOut) report("signed_out", attempts);
        setPhase("signed_out");
        return;
      }

      if (verdict === "alive") {
        // The cookie is fine — only the client's own copy was wrong. Resync it.
        report("recovered", attempts);
        const fresh = await refresh().catch(() => null);
        if (mine !== epoch) return;
        setPhase("idle");
        if (!fresh) reloadOnce();
        return;
      }

      // Nothing answered. Stay where we are — a live class must not be torn
      // down over a request — say so once, and keep asking.
      if (!reportedUnreachable) {
        reportedUnreachable = true;
        report("unreachable", attempts);
      }
      await sleep(SLOW_RETRY_MS);
      if (mine !== epoch) return;
    }
  } finally {
    // A cancelled episode already released the slot (see the hook); only the
    // current one may, or a stale loop would free it under its successor.
    if (mine === epoch) running = false;
  }
}

export function useConfirmedSession(): ReturnType<typeof useSession> {
  const session = useSession();
  const { status, update } = session;
  const current = useSyncExternalStore(
    subscribe,
    () => phase,
    () => "idle" as Phase,
  );

  // `update` is not guaranteed stable across renders; the episode only needs
  // the latest one when it gets there.
  const updateRef = useRef(update);
  useEffect(() => {
    updateRef.current = update;
  }, [update]);

  useEffect(() => {
    if (status === "authenticated") {
      wasAuthenticated = true;
      if (phase !== "idle" || running) {
        epoch += 1; // a running episode is moot — we are signed in
        running = false;
        setPhase("idle");
      }
      return;
    }
    if (status === "unauthenticated" && phase === "idle" && !running) {
      void runEpisode(() => updateRef.current());
    }
  }, [status]);

  if (status === "unauthenticated" && current !== "signed_out") {
    return { ...session, status: "loading" } as ReturnType<typeof useSession>;
  }
  return session;
}

/** Test seam: the episode runner and its module state, without React. */
export const _internals = {
  runEpisode,
  getPhase: () => phase,
  reset() {
    phase = "idle";
    running = false;
    epoch += 1;
    wasAuthenticated = false;
    intentionalSignOut = false;
  },
  setWasAuthenticated(value: boolean) {
    wasAuthenticated = value;
  },
};
