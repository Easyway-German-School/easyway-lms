"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { useMoment } from "@/lib/moment-queue";
import Confetti from "@/components/live-quiz/Confetti";
import { SparklesIcon } from "@/components/icons";

/**
 * The moment a lesson gets finished — the small, frequent counterpart to
 * LevelAdvance's CelebrationModal (which fires once per level and carries a
 * price tag). This carries nothing but "you did it," which is the point.
 *
 * Fired via a DOM event rather than a prop or a poll, because the three real
 * triggers (assignment submission, video completion, quiz end) each already
 * get their answer synchronously from the route they call — no new endpoint
 * to ask "is something due?" is needed, they just say so directly. See the
 * `celebrate` flag on those routes' responses.
 */

export const LESSON_COMPLETE_EVENT = "easyway:lesson-complete";

export type LessonCompleteDetail = {
  /** "Assignment submitted" | "Video complete" | "Quiz finished" — short, specific. */
  title: string;
  /** e.g. "Nice work finishing “Chapter 3 Homework”." */
  message: string;
};

export function celebrateLessonComplete(detail: LessonCompleteDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LESSON_COMPLETE_EVENT, { detail }));
}

export default function LessonCompleteCelebration() {
  const [detail, setDetail] = useState<LessonCompleteDetail | null>(null);
  const due = detail !== null;
  const { open, close } = useMoment("lesson-complete", due);

  useEffect(() => {
    function onComplete(event: Event) {
      const next = (event as CustomEvent<LessonCompleteDetail>).detail;
      if (next) setDetail(next);
    }
    window.addEventListener(LESSON_COMPLETE_EVENT, onComplete);
    return () => window.removeEventListener(LESSON_COMPLETE_EVENT, onComplete);
  }, []);

  const handleClose = useCallback(() => {
    close();
    setDetail(null);
  }, [close]);

  return (
    <AnimatePresence>
      {open && detail ? (
        <>
          {/* `isolate` gives this its own stacking context so the confetti
              canvas's own z-index (5, set inside Confetti.tsx) resolves
              against the modal below rather than the whole page — without
              it the confetti would paint behind the z-[120] backdrop. */}
          <div className="pointer-events-none fixed inset-0 z-[130] isolate">
            <Confetti />
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto overscroll-contain bg-slate-950/70 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-label={detail.title}
          >
            <motion.div
              initial={{ opacity: 0, y: 28, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 260, damping: 26 }}
              className="relative my-auto w-full max-w-md overflow-hidden rounded-[32px] bg-[var(--surface)] shadow-2xl"
            >
              <div className="relative overflow-hidden bg-gradient-to-br from-[#0D7C7E] via-[#0D7C7E] to-[#FF6600] px-8 py-9 text-center text-white">
                <motion.div
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.15, type: "spring", stiffness: 300, damping: 18 }}
                  className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-white/15 backdrop-blur"
                >
                  <SparklesIcon className="h-8 w-8" />
                </motion.div>
                <motion.h2
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="mt-4 text-2xl font-bold"
                >
                  {detail.title}
                </motion.h2>
                <motion.p
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  className="mt-2 text-sm leading-6 text-white/85"
                >
                  {detail.message}
                </motion.p>
              </div>

              <div className="p-6">
                <button
                  onClick={handleClose}
                  className="w-full rounded-full btn-glow px-6 py-3.5 text-center text-sm font-bold text-white shadow-lg transition hover:brightness-110"
                >
                  Keep going
                </button>
              </div>
            </motion.div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
