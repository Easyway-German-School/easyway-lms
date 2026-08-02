"use client";

/**
 * What the dashboard did not interrupt you with.
 *
 * This is the half of the moment queue that makes the cap honest. Holding back
 * the third, fourth and fifth interruption is only defensible if the student
 * can still get at them — otherwise it is not restraint, it is a silent drop,
 * and the person who would have loved the level poster simply never sees it.
 *
 * It is deliberately small, deliberately not a badge-red attention magnet, and
 * deliberately says the plain truth: here are two things, they are waiting,
 * they will keep. An interruption becomes an invitation, which is the entire
 * trade this queue is making.
 *
 * It sits bottom LEFT because the community launcher owns the bottom right and
 * the theme switch owns the very corner beneath it.
 */

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDownIcon, InboxIcon, SparklesIcon } from "@/components/icons";
import { useMomentQueue } from "@/lib/moment-queue";

export default function MomentDock() {
  const queue = useMomentQueue();
  const [open, setOpen] = useState(false);

  const waiting = queue?.deferred ?? [];
  if (waiting.length === 0) return null;

  return (
    <div className="fixed bottom-6 left-4 z-[55] flex flex-col items-start gap-2 sm:left-6">
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="w-[min(88vw,20rem)] overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_24px_60px_rgba(15,23,42,0.28)]"
          >
            <div className="border-b border-[var(--border)] px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--muted)]">Waiting for you</p>
              <p className="mt-1 text-xs leading-5 text-[var(--foreground-soft)]">
                We kept these out of your way. Open them whenever you like.
              </p>
            </div>

            <div className="divide-y divide-[var(--border)]">
              {waiting.map((moment) => (
                <button
                  key={moment.id}
                  type="button"
                  onClick={() => {
                    queue?.summon(moment.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-[var(--surface-alt)]"
                >
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-ink)]">
                    <SparklesIcon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-[var(--foreground)]">{moment.dockLabel}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-[var(--muted)]">{moment.dockBlurb}</span>
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-[var(--foreground-soft)] shadow-[0_10px_30px_rgba(15,23,42,0.18)] transition hover:border-[var(--border-strong)]"
      >
        <InboxIcon className="h-4 w-4" />
        <span className="text-xs font-bold">
          {waiting.length} waiting
        </span>
        <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${open ? "" : "rotate-180"}`} />
      </button>
    </div>
  );
}
