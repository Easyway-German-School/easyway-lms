"use client";

import { AnimatePresence, motion } from "framer-motion";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { BroadcastIcon, CrossIcon, VideoIcon } from "@/components/icons";
import { MOMENT_PREEMPT_EVENT } from "@/lib/moment-queue";
import { useLiveClass, type LiveClassState } from "@/lib/useLiveClass";

/**
 * THE INCOMING CALL.
 *
 * A live class is the only thing in this portal that expires. A material posted
 * this morning is still there tonight; a class that started twenty minutes ago
 * is half gone. Every other notification in the app can politely queue behind
 * the welcome tour — this one cannot, so it does not: it renders above
 * everything and tells the moment queue to stand down while it is up.
 *
 * It is shaped like a phone call on purpose. Not a toast, not a banner, not a
 * row in the bell. A student who has learned to swipe notifications away has
 * not learned to swipe away a ringing call, because a call is the one interface
 * that carries "somebody is waiting for you, right now" — which happens to be
 * literally true here. The tutor IS in the room.
 *
 * WHAT IT WILL NOT DO
 *
 * It will not ring twice for the same class. Dismissing it once is respected
 * for that session id and nothing re-opens it — a popup that keeps coming back
 * is how you teach somebody to hate the feature. What survives the dismissal is
 * a small pill in the corner, so the class is never actually lost, only demoted
 * from an interruption to an offer.
 */

const DISMISSED_KEY = "easyway:live-call-dismissed";

/** Which sessions this student has already answered or waved away, this tab. */
function readDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(DISMISSED_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function writeDismissed(ids: Set<string>): void {
  try {
    sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
  } catch {
    // Private browsing, storage disabled, quota. The overlay showing once more
    // than intended is a far smaller problem than a crash in the shell.
  }
}

/**
 * A short, quiet two-note chime, synthesised rather than shipped.
 *
 * No audio file: one more asset to host, cache and get wrong, for 400ms of
 * sound. Browsers block audio until the user has interacted with the page, and
 * that is fine — the whole thing is wrapped in a try/catch and the overlay is
 * the real signal. The sound is a bonus for the student who happens to be
 * typing in another tab, never the thing they depend on.
 */
function playChime(): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {});
    }

    [0, 0.18].forEach((offset, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = index === 0 ? 660 : 880;
      // Ramped, not switched. A gain that jumps from 0 clicks, and a click is
      // the difference between "a chime" and "something broke".
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.09, ctx.currentTime + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.34);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.36);
    });

    window.setTimeout(() => void ctx.close().catch(() => {}), 1200);
  } catch {
    // Autoplay policy, no audio device, an old browser. Never worth an error.
  }
}

function minutesSince(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
}

function startedLabel(iso: string): string {
  const mins = minutesSince(iso);
  if (mins < 1) return "just started";
  if (mins === 1) return "started a minute ago";
  if (mins < 60) return `started ${mins} minutes ago`;
  return "started over an hour ago";
}

export default function LiveClassCall() {
  const pathname = usePathname();
  const router = useRouter();

  /**
   * Do not ring somebody who is already in the room.
   *
   * `/live` is where the call goes; drawing this over the video is the software
   * equivalent of your own phone ringing while you are talking on it. The
   * provider stops polling there too, so it costs nothing either.
   */
  const insideClassroom = pathname?.startsWith("/live") ?? false;
  const { live } = useLiveClass();

  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const chimedFor = useRef<string | null>(null);

  // sessionStorage is not available during the server render, so the initial
  // state is empty and filled in on mount. One frame of nothing is invisible;
  // reading storage during render is a hydration mismatch.
  useEffect(() => setDismissed(readDismissed()), []);

  // Derived, not stored. Holding this in state and syncing it from an effect
  // buys a render where the two disagree, and nothing ever needed to set it
  // independently of the two things it is computed from.
  const ringing = Boolean(live && !dismissed.has(live.id));

  // Chime and buzz once per class, not once per poll.
  useEffect(() => {
    if (!ringing || !live) return;
    if (chimedFor.current === live.id) return;
    chimedFor.current = live.id;

    playChime();
    // A phone in a pocket, on a table, in a lecture hall. Guarded because
    // Safari does not implement it and older Android throws on odd patterns.
    try {
      navigator.vibrate?.([120, 90, 120]);
    } catch {
      /* no haptics, no problem */
    }
  }, [ringing, live]);

  // Tell the moment queue to stand down while this is up, and hand the screen
  // back when it goes. The cleanup matters more than the set: a call that
  // unmounts without releasing would silence the tour permanently.
  useEffect(() => {
    const dispatch = (active: boolean) => {
      window.dispatchEvent(new CustomEvent(MOMENT_PREEMPT_EVENT, { detail: { active } }));
    };
    dispatch(ringing);
    return () => dispatch(false);
  }, [ringing]);

  const dismiss = useCallback(
    (sessionId: string, decline: boolean) => {
      setDismissed((current) => {
        const next = new Set(current).add(sessionId);
        writeDismissed(next);
        return next;
      });

      if (decline) {
        // Told to the tutor, so their roster stops showing this student as
        // still ringing and they can start without waiting.
        void fetch("/api/live/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "decline", sessionId }),
        }).catch(() => {});
      }
    },
    [],
  );

  const join = useCallback(
    (session: LiveClassState) => {
      setDismissed((current) => {
        const next = new Set(current).add(session.id);
        writeDismissed(next);
        return next;
      });
      router.push(`/live?code=${session.joinCode}`);
    },
    [router],
  );

  if (!live) return null;

  return (
    <>
      <AnimatePresence>
        {ringing && (
          <motion.div
            key="call"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            // Above the drawer (z-50) and the scrim, because the whole point is
            // that nothing in the portal outranks a class in progress.
            className="fixed inset-0 z-[90] grid place-items-end bg-slate-950/50 p-3 backdrop-blur-sm sm:place-items-center sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-label="Your class is live"
          >
            <motion.div
              initial={{ y: 28, scale: 0.97, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              exit={{ y: 28, scale: 0.97, opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 26 }}
              className="w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-[var(--surface)] shadow-2xl"
            >
              <div className="relative overflow-hidden bg-gradient-to-br from-[#0D7C7E] via-[#0D7C7E] to-[#FF6600] px-6 py-7 text-white">
                {/* Two rings pulsing out of the icon. The only animation on the
                    card, because a card where everything moves reads as noise
                    rather than urgency. */}
                <div className="flex items-center gap-4">
                  <span className="relative grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/15">
                    {[0, 0.9].map((delay) => (
                      <motion.span
                        key={delay}
                        className="absolute inset-0 rounded-2xl border-2 border-white/50"
                        initial={{ scale: 1, opacity: 0.7 }}
                        animate={{ scale: 1.55, opacity: 0 }}
                        transition={{ duration: 1.8, repeat: Infinity, delay, ease: "easeOut" }}
                      />
                    ))}
                    <BroadcastIcon className="h-7 w-7" />
                  </span>

                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/75">
                      {live.personal ? "Your tutor is calling you" : "Class is live"}
                    </p>
                    <h2 className="mt-1 truncate text-xl font-semibold">{live.title}</h2>
                    <p className="mt-0.5 text-sm text-white/85">
                      {live.tutorName ? `${live.tutorName} · ` : ""}
                      {startedLabel(live.startedAt)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-4 p-6">
                <p className="text-sm leading-6 text-[var(--muted)]">
                  {live.personal
                    ? "This one is just for you — your tutor is in the room waiting. Joining now means you do not miss the start."
                    : "Your classmates are joining now. You can pick your video quality on the next screen."}
                </p>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    onClick={() => join(live)}
                    className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-6 py-3.5 text-sm font-semibold text-white shadow-lg transition hover:brightness-110 active:scale-[0.99]"
                  >
                    <VideoIcon className="h-4 w-4" />
                    Join the class
                  </button>
                  <button
                    onClick={() => dismiss(live.id, true)}
                    className="rounded-full border border-[var(--border)] px-6 py-3.5 text-sm font-semibold text-[var(--foreground-soft)] transition hover:bg-[var(--surface-alt)]"
                  >
                    Can&apos;t make it
                  </button>
                </div>

                {/* Distinct from "Can't make it" on purpose. One tells the tutor
                    to stop waiting; this one just gets the card off the screen.
                    Collapsing them would make every student who is finishing a
                    sentence look like a student who is not coming. */}
                <button
                  onClick={() => dismiss(live.id, false)}
                  className="mx-auto flex items-center gap-1.5 text-xs font-medium text-[var(--muted)] underline-offset-4 hover:underline"
                >
                  <CrossIcon className="h-3 w-3" />
                  Remind me from the corner instead
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/*
        THE DEMOTION, not the deletion.
        Once the card is dismissed the class is still on, and a student who
        changes their mind four minutes later should not have to remember where
        the live page is. The pill is the standing offer.
      */}
      <AnimatePresence>
        {!ringing && !insideClassroom && (
          <motion.button
            key="pill"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            onClick={() => join(live)}
            className="fixed bottom-4 left-1/2 z-[80] flex -translate-x-1/2 items-center gap-2.5 rounded-full border border-white/15 bg-[#0D7C7E] px-4 py-2.5 text-sm font-semibold text-white shadow-xl transition hover:brightness-110 sm:bottom-6"
          >
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
            </span>
            Class is live — join
          </motion.button>
        )}
      </AnimatePresence>
    </>
  );
}
