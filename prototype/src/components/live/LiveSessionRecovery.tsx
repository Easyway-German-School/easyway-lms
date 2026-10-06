"use client";

/**
 * What happens when a sign-in drops around a live class.
 *
 * Two situations, one component, because they are the same promise to the
 * person in the class: "you will not lose your place."
 *
 *  1. THE SIGN-IN DROPPED BUT THE CALL IS STILL UP. The guard in
 *     `session-resilience.ts` has kept the screen alive. This quietly re-checks
 *     every few seconds (most drops are a server hiccup and heal on their own),
 *     and offers a button that opens the sign-in page in a NEW TAB, so the
 *     classroom in this tab is never navigated away from. Signing in there
 *     renews the shared cookie and this tab picks it up by itself.
 *
 *  2. THE PAGE WAS LEFT (a hard sign-out redirect, a refresh, a crash) WHILE A
 *     CLASS WAS OPEN. `LiveCallContext` leaves a small note behind when a call
 *     starts and removes it when the person leaves on purpose. If the note is
 *     still there and no call is running, the person was bounced out — so on
 *     whatever page they land, offer one button that checks whether they are
 *     still signed in, and either puts them straight back into the class or
 *     sends them to sign in and then back.
 */

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useLiveCall, readRejoinNote, clearRejoinNote } from "./LiveCallContext";
import { SESSION_LOST_EVENT, SESSION_RESTORED_EVENT, isSessionLost, probeSession } from "@/lib/session-resilience";

const BAR =
  "fixed inset-x-0 top-0 z-[2147483000] flex flex-wrap items-center justify-center gap-3 px-4 py-3 text-sm shadow-lg";

export default function LiveSessionRecovery() {
  const { activeCall } = useLiveCall();
  const pathname = usePathname();
  const router = useRouter();

  const [lost, setLost] = useState(false);
  const [note, setNote] = useState<ReturnType<typeof readRejoinNote>>(null);
  const [busy, setBusy] = useState(false);
  const [stillOut, setStillOut] = useState(false);

  // --- 1. sign-in dropped mid-call --------------------------------------
  useEffect(() => {
    const onLost = () => setLost(true);
    const onRestored = () => {
      setLost(false);
      setStillOut(false);
    };
    window.addEventListener(SESSION_LOST_EVENT, onLost);
    window.addEventListener(SESSION_RESTORED_EVENT, onRestored);
    setLost(isSessionLost());
    return () => {
      window.removeEventListener(SESSION_LOST_EVENT, onLost);
      window.removeEventListener(SESSION_RESTORED_EVENT, onRestored);
    };
  }, []);

  useEffect(() => {
    if (!lost) return;
    const timer = window.setInterval(() => {
      void probeSession();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [lost]);

  // --- 2. bounced out of a class ----------------------------------------
  useEffect(() => {
    if (activeCall) {
      setNote(null);
      return;
    }
    setNote(readRejoinNote());
  }, [activeCall, pathname]);

  const signInInNewTab = useCallback(
    (role: string | undefined) => {
      const path = role === "lecturer" ? "/auth/lecturer/signin" : "/auth/signin";
      window.open(path, "_blank", "noopener");
    },
    [],
  );

  const rejoin = useCallback(async () => {
    if (!note) return;
    setBusy(true);
    setStillOut(false);
    const signedIn = await probeSession();
    setBusy(false);
    if (signedIn) {
      clearRejoinNote();
      setNote(null);
      router.push("/live");
      return;
    }
    setStillOut(true);
    router.push(note.role === "lecturer" ? "/auth/lecturer/signin" : "/auth/signin");
  }, [note, router]);

  if (lost && activeCall) {
    const role = activeCall.session.role === "tutor" ? "lecturer" : "student";
    return (
      <div role="alert" className={`${BAR} bg-amber-500 text-slate-950`}>
        <span className="font-semibold">
          Oops — your sign-in dropped, but your class is still running. Nothing has been closed.
        </span>
        <button
          onClick={() => signInInNewTab(role)}
          className="rounded-full bg-slate-950 px-4 py-1.5 font-semibold text-white"
        >
          Sign back in (opens in a new tab)
        </button>
        <span className="text-xs opacity-80">We&apos;re also re-checking automatically.</span>
      </div>
    );
  }

  if (!activeCall && note && pathname !== "/live") {
    return (
      <div role="alert" className={`${BAR} bg-sky-600 text-white`}>
        <span className="font-semibold">
          Oops — it looks like you were signed out during your live class.
          {note.role === "lecturer" ? " Your students may still be waiting." : " It may still be running."}
        </span>
        <button
          onClick={rejoin}
          disabled={busy}
          className="rounded-full bg-white px-4 py-1.5 font-semibold text-sky-700 disabled:opacity-60"
        >
          {busy ? "Checking…" : "Rejoin the live class"}
        </button>
        {stillOut && <span className="text-xs">Sign in and you&apos;ll see this button again on the next page.</span>}
        <button
          onClick={() => {
            clearRejoinNote();
            setNote(null);
          }}
          className="text-xs underline opacity-80"
        >
          Dismiss
        </button>
      </div>
    );
  }

  return null;
}
