"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Mascot from "@/components/Mascot";
import { useMoment } from "@/lib/moment-queue";
import { ArrowRightIcon } from "@/components/icons";

/**
 * Becca introduces Wortbau / Wortsuche once — soft View now / Later, not a
 * generic game splash. Stamp lasts until they play or snooze.
 */

const SEEN_KEY = "ew-word-puzzle-intro";
const SNOOZE_KEY = "ew-word-puzzle-snoozed-until";
const SNOOZE_MS = 6 * 60 * 60 * 1000;

function alreadySeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function isSnoozed(): boolean {
  try {
    return Date.now() < Number(window.localStorage.getItem(SNOOZE_KEY) ?? 0);
  } catch {
    return false;
  }
}

export default function WordPuzzleMoment() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [ready, setReady] = useState(false);
  const [due, setDue] = useState(false);

  useEffect(() => {
    const show = !alreadySeen() && !isSnoozed();
    setDue(show);
    setReady(true);
  }, []);

  const { open, close } = useMoment("word-puzzle-intro", ready && due);

  const stampSeen = useCallback(() => {
    try {
      window.localStorage.setItem(SEEN_KEY, "1");
      window.localStorage.removeItem(SNOOZE_KEY);
    } catch {
      /* ignore */
    }
    setDue(false);
  }, []);

  const later = useCallback(() => {
    try {
      window.localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    } catch {
      /* ignore */
    }
    setDue(false);
    close();
  }, [close]);

  const playNow = useCallback(() => {
    stampSeen();
    close();
    router.push("/games");
  }, [stampSeen, close, router]);

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto overscroll-contain bg-slate-950/65 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-label="New German word puzzles with Becca"
      >
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ type: "spring", stiffness: 260, damping: 26 }}
          className="relative my-auto w-full max-w-md overflow-hidden rounded-[32px] bg-[var(--surface)] shadow-2xl"
        >
          <div className="relative overflow-hidden bg-gradient-to-br from-[#0D7C7E] via-[#0a6365] to-[#FF6600] px-7 pb-8 pt-8 text-white">
            {!reduceMotion ? (
              <motion.div
                aria-hidden
                className="pointer-events-none absolute -right-8 -top-8 h-36 w-36 rounded-full border border-white/30"
                animate={{ scale: [1, 1.35, 1], opacity: [0.35, 0.1, 0.35] }}
                transition={{ duration: 3.2, repeat: Infinity }}
              />
            ) : null}

            <div className="relative flex items-start gap-4">
              <Mascot mood="cheerful" className="h-20 w-20 shrink-0 drop-shadow-xl" />
              <div className="min-w-0 flex-1 pt-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/75">
                  New on Games
                </p>
                <p className="mt-2 text-lg font-bold leading-snug">
                  &ldquo;I built you real German word puzzles — matched to your level. Come try Wortbau.&rdquo;
                </p>
              </div>
            </div>

            <div className="relative mt-6 flex items-center gap-4 rounded-2xl bg-white/15 p-3 backdrop-blur">
              <Image
                src="/games/wortbau-logo.jpg"
                alt="Wortbau"
                width={72}
                height={72}
                className="h-[72px] w-[72px] rounded-2xl object-cover shadow-lg ring-2 ring-white/40"
              />
              <div className="min-w-0">
                <p className="text-base font-black tracking-tight">Wortbau + Wortsuche</p>
                <p className="mt-1 text-xs leading-relaxed text-white/85">
                  Scrabble-style tiles and a word search — A1 words for A1, A2 for A2, plus vocab from your class notes when we have it.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 p-6 sm:flex-row">
            <button
              type="button"
              onClick={playNow}
              className="flex flex-1 items-center justify-center gap-2 rounded-full btn-glow px-6 py-3.5 text-sm font-bold text-white shadow-lg"
            >
              Play now <ArrowRightIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={later}
              className="rounded-full border border-[var(--border)] px-6 py-3.5 text-sm font-semibold text-[var(--muted)] transition hover:bg-[var(--surface-alt)]"
            >
              Later
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
