"use client";

import Mascot from "@/components/Mascot";

/**
 * What a student sees when the office sets their status to Paused.
 *
 * This is a pause, not a penalty. Their classes, notes and payments are all
 * still there — the portal is just resting until the office turns it back on.
 * The copy stays light on purpose: a padlock and a warning tone is how a
 * short break starts to feel like they have done something wrong.
 */
export default function PortalPausedScreen() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-6 py-16 text-center">
      <Mascot mood="smiling" className="h-28 w-28" />
      <div
        aria-hidden="true"
        className="mt-6 grid h-14 w-14 place-items-center rounded-full bg-amber-500/15 text-amber-700"
      >
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor">
          <rect x="6" y="5" width="4" height="14" rx="1.5" />
          <rect x="14" y="5" width="4" height="14" rx="1.5" />
        </svg>
      </div>
      <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Paused</p>
      <h1 className="mt-2 text-2xl font-bold text-[var(--foreground)]">Your portal is paused for now</h1>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
        Nothing is wrong, and nothing has been lost. Your classes, notes and progress are all still here,
        waiting for you. The office has paused the portal for a little while, and it will open again as soon
        as you are ready to continue.
      </p>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
        If you need anything in the meantime, send us a message — we are happy to help.
      </p>
    </div>
  );
}
