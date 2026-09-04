"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import Mascot, { type MascotMood } from "@/components/Mascot";
import { ChainIcon, GameControllerIcon, SendIcon } from "@/components/icons";

/**
 * "How a class story works" — the separate Becca walk-through.
 *
 * NOT the welcome tour, and not in the moment queue. The welcome tour is
 * orientation ("where is Materials"); this is a mechanic ("whose turn is it,
 * and what do I do on mine"), which is conceptual rather than spatial — so it
 * is a short sequence of Becca cards rather than arrows pointing at the
 * sidebar. It fires the first time a student goes to start or join a story and
 * never again (`Student.storyTourSeenAt`, via /api/student/story-tour).
 *
 * The parent owns the "should this show at all" decision and mounts the
 * component only when it should. This component owns the steps, the stamp, and
 * telling the server it is done.
 */

type Step = {
  mood: MascotMood;
  eyebrow: string;
  title: string;
  body: string;
  /** A tiny concrete illustration under the copy. */
  art?: "start" | "turn" | "invite";
};

const STEPS: Step[] = [
  {
    mood: "greeting",
    eyebrow: "Satzkette",
    title: "Your class writes a story. Together.",
    body: "One sentence each, in German, passed around the room. Nobody writes a whole paragraph — you write one line and hand it on. That is the entire game.",
  },
  {
    mood: "cheerful",
    eyebrow: "Starting one",
    title: "Tap the controller, name it, go",
    body: "The game controller in the chat opens a story for the whole room. Give it a title — “Ein Tag am Meer” — and everyone in your class gets pulled in.",
    art: "start",
  },
  {
    mood: "curious",
    eyebrow: "Your turn",
    title: "You get a nudge. You write one line.",
    body: "When the story reaches you, your phone buzzes. Add one sentence that follows the last one. It is yours for a day — after that anyone can grab it, so the story never stalls.",
    art: "turn",
  },
  {
    mood: "presenting",
    eyebrow: "Joining one",
    title: "See an invite in the chat? Jump in.",
    body: "A story someone else started shows up as a card in the room. Tap it, read what the class has written so far, and take the open turn. Los!",
    art: "invite",
  },
];

function StepArt({ kind }: { kind: NonNullable<Step["art"]> }) {
  if (kind === "start") {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] p-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
          <GameControllerIcon className="h-4 w-4" />
        </span>
        <span className="text-xs font-semibold text-[var(--foreground)]">Satzkette — start a story</span>
        <span className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--accent)] text-white">
          <SendIcon className="h-3.5 w-3.5" />
        </span>
      </div>
    );
  }
  if (kind === "turn") {
    return (
      <div className="mt-3 rounded-xl border-2 border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-2.5">
        <p className="text-xs font-bold text-[var(--foreground)]">Your turn — Ein Tag am Meer</p>
        <p className="mt-0.5 text-[11px] text-[var(--muted)]">Sentence 4 of 12 · one line of German</p>
      </div>
    );
  }
  return (
    <a
      href="#"
      onClick={(e) => e.preventDefault()}
      className="mt-3 flex items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] p-2.5"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
        <ChainIcon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-[10px] font-bold uppercase tracking-wide text-[var(--accent)]">Satzkette</span>
        <span className="block text-xs font-semibold text-[var(--foreground)]">Chain reaction · tap to add a sentence</span>
      </span>
    </a>
  );
}

export default function StoryTour({ onDone }: { onDone: () => void }) {
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [closing, setClosing] = useState(false);
  const step = STEPS[index];
  const isLast = index === STEPS.length - 1;

  const finish = useCallback(() => {
    setClosing(true);
    void fetch("/api/student/story-tour", { method: "POST" }).catch(() => {});
    // Let the exit animation play before the parent unmounts us.
    window.setTimeout(onDone, reduceMotion ? 0 : 220);
  }, [onDone, reduceMotion]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
      if (event.key === "ArrowRight") setIndex((i) => Math.min(i + 1, STEPS.length - 1));
      if (event.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finish]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <AnimatePresence>
      {!closing ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label="How a class story works"
          className="fixed inset-0 z-[130] grid place-items-center bg-slate-950/70 p-4"
          onClick={finish}
        >
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 220, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm overflow-hidden rounded-[26px] bg-[var(--surface)] shadow-2xl"
          >
            <div className="h-1.5 w-full bg-[var(--border)]">
              <motion.div
                className="h-full bg-[var(--accent)]"
                initial={false}
                animate={{ width: `${((index + 1) / STEPS.length) * 100}%` }}
                transition={{ type: "spring", stiffness: 200, damping: 28 }}
              />
            </div>

            <div className="flex justify-center pt-5">
              <Mascot mood={step.mood} className="h-24 w-24 drop-shadow-xl" />
            </div>

            <div className="px-6 pb-2 pt-2 text-center">
              <motion.p
                key={`eyebrow-${index}`}
                initial={reduceMotion ? {} : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-[11px] font-bold uppercase tracking-[0.28em] text-[var(--accent)]"
              >
                {step.eyebrow}
              </motion.p>
              <motion.h2
                key={`title-${index}`}
                initial={reduceMotion ? {} : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.04 }}
                className="mt-1.5 text-lg font-bold leading-tight text-[var(--foreground)]"
              >
                {step.title}
              </motion.h2>
              <motion.p
                key={`body-${index}`}
                initial={reduceMotion ? {} : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 }}
                className="mt-2 text-sm leading-relaxed text-[var(--muted)]"
              >
                {step.body}
              </motion.p>
              {step.art ? <StepArt kind={step.art} /> : null}
            </div>

            <div className="flex items-center gap-1.5 px-6 pb-4 pt-3">
              {STEPS.map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 rounded-full transition-all ${
                    i === index ? "w-5 bg-[var(--accent)]" : "w-1.5 bg-[var(--border)]"
                  }`}
                />
              ))}
            </div>

            <div className="border-t border-[var(--border)] p-4">
              <div className="flex items-center gap-2.5">
                {index > 0 ? (
                  <button
                    onClick={() => setIndex((i) => Math.max(i - 1, 0))}
                    className="rounded-full border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--muted)] transition hover:text-[var(--foreground)]"
                  >
                    Back
                  </button>
                ) : null}
                <button
                  onClick={() => (isLast ? finish() : setIndex((i) => i + 1))}
                  className="flex-1 rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-[var(--accent)]/25 transition hover:brightness-110"
                >
                  {isLast ? "Got it" : "Next"}
                </button>
              </div>
              {!isLast ? (
                <button
                  onClick={finish}
                  className="mt-2 w-full text-center text-xs text-[var(--muted)] transition hover:underline"
                >
                  Skip — I&apos;ll work it out
                </button>
              ) : null}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
