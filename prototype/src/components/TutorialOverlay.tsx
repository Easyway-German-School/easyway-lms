"use client";

import { useReducedMotion, motion } from "framer-motion";
import { useEffect, useState } from "react";
import Mascot from "@/components/Mascot";
import { SpotlightArrow, SpotlightMask, inflate, useTargetRect } from "@/components/Spotlight";
import { CheckIcon, CrossIcon, SpeakerIcon, SpeakerOffIcon } from "@/components/icons";
import type { TutorialStep } from "@/lib/tutorials";

/** After this long with no target found, treat the step as centre-stage rather than spotlighting nothing. */
const TARGET_TIMEOUT_MS = 2600;

/**
 * The visible half of a tutorial step: Becca, a spotlight on the real DOM
 * target (via the same primitives PhotoUnlockGuide already uses), an arrow
 * from her hand to it, and a bottom-sheet caption card with the controls.
 * Purely presentational — TutorialRuntime owns which step is current, run
 * persistence, and narration playback.
 */
export default function TutorialOverlay({
  step,
  stepNumber,
  totalSteps,
  muted,
  hasBack,
  isLast,
  onNext,
  onBack,
  onExit,
  onToggleMute,
}: {
  step: TutorialStep;
  stepNumber: number;
  totalSteps: number;
  muted: boolean;
  hasBack: boolean;
  isLast: boolean;
  onNext: () => void;
  onBack: () => void;
  onExit: () => void;
  onToggleMute: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [viewport, setViewport] = useState({ width: 1024, height: 768 });
  useEffect(() => {
    const measure = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const rect = useTargetRect(step.target, step.id);
  const [targetMissing, setTargetMissing] = useState(false);
  useEffect(() => {
    setTargetMissing(false);
    if (!step.target) return;
    const timer = window.setTimeout(() => setTargetMissing(true), TARGET_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [step.id, step.target]);

  const hole = rect && !targetMissing ? inflate(rect, 8) : null;
  const guideSize = viewport.width < 640 ? 84 : 124;

  // Beside the spotlight when there's room, below it when there isn't; dead
  // centre, above the card, when this step has no target at all — same
  // geometry PhotoUnlockGuide already proved out for one spotlight.
  const roomRight = hole ? viewport.width - (hole.left + hole.width) : 0;
  const sideRight = hole ? roomRight >= guideSize + 24 : false;
  const guideLeft = hole
    ? sideRight
      ? hole.left + hole.width + 16
      : Math.min(Math.max(12, hole.left + hole.width / 2 - guideSize / 2), viewport.width - guideSize - 12)
    : (viewport.width - guideSize) / 2;
  const guideTop = hole
    ? sideRight
      ? Math.max(12, hole.top + hole.height / 2 - guideSize / 2)
      : Math.max(12, hole.top - guideSize - 14)
    : Math.max(72, viewport.height * 0.2);

  const handX = guideLeft + guideSize * (hole && sideRight ? 0.12 : 0.5);
  const handY = guideTop + guideSize * (hole && sideRight ? 0.5 : 0.88);
  const targetX = hole ? hole.left + hole.width / 2 : 0;
  const targetY = hole ? hole.top + hole.height / 2 : 0;
  const rawAngle = hole ? (Math.atan2(targetY - handY, targetX - handX) * 180) / Math.PI : 0;
  const pointLeft = hole ? targetX < handX : false;
  const armAngle = hole
    ? pointLeft
      ? Math.sign(rawAngle || 1) * Math.max(90.01, Math.min(140, Math.abs(rawAngle)))
      : Math.max(-90, Math.min(90, rawAngle))
    : null;

  return (
    <div className="fixed inset-0 z-[129]" role="dialog" aria-modal="true" aria-label={step.caption}>
      {hole ? (
        <>
          <SpotlightMask hole={hole} zIndex={0} />
          <SpotlightArrow from={{ x: handX, y: handY }} to={{ x: targetX, y: targetY }} zIndex={0} redrawKey={step.id} />
        </>
      ) : (
        <div className="fixed inset-0 bg-[rgb(2_6_23_/_0.75)]" />
      )}

      <motion.div
        initial={false}
        animate={{ left: guideLeft, top: guideTop }}
        transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 180, damping: 22 }}
        className="pointer-events-none fixed z-10"
        style={{ width: guideSize, height: guideSize }}
      >
        <Mascot mood={step.mood ?? "presenting"} pointAngle={armAngle} className="h-full w-full drop-shadow-2xl" />
      </motion.div>

      <div className="fixed inset-x-0 bottom-0 z-20 flex justify-center p-4 sm:bottom-6">
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm rounded-3xl bg-[var(--surface)] p-5 shadow-2xl"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              {Array.from({ length: totalSteps }).map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 w-5 rounded-full ${i <= stepNumber - 1 ? "bg-[var(--accent)]" : "bg-[var(--border)]"}`}
                />
              ))}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onToggleMute}
                aria-label={muted ? "Unmute narration" : "Mute narration"}
                className="rounded-full p-1.5 text-[var(--muted)] transition hover:bg-[var(--surface-alt)] hover:text-[var(--foreground)]"
              >
                {muted ? <SpeakerOffIcon className="h-4 w-4" /> : <SpeakerIcon className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={onExit}
                aria-label="Exit tutorial"
                className="rounded-full p-1.5 text-[var(--muted)] transition hover:bg-[var(--surface-alt)] hover:text-[var(--foreground)]"
              >
                <CrossIcon className="h-4 w-4" />
              </button>
            </div>
          </div>

          <p className="mt-3 text-base font-bold leading-snug text-[var(--foreground)]">{step.caption}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted)]">{step.narration}</p>

          <div className="mt-4 flex items-center gap-2.5">
            {hasBack && (
              <button
                type="button"
                onClick={onBack}
                className="rounded-full border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--muted)] transition hover:text-[var(--foreground)]"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={onNext}
              className="flex-1 rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-[var(--accent)]/25 transition hover:brightness-110"
            >
              {isLast ? (
                <span className="inline-flex items-center justify-center gap-1.5">
                  <CheckIcon className="h-4 w-4" strokeWidth={3} /> Done
                </span>
              ) : (
                "Next"
              )}
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
