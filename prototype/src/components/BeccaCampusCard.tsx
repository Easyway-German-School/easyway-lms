"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import Mascot from "@/components/Mascot";
import { ArrowRightIcon } from "@/components/icons";

export default function BeccaCampusCard({
  userId,
  showStudyGroupLink,
}: {
  userId?: string | null;
  showStudyGroupLink: boolean;
}) {
  const storageKey = userId ? `becca-campus-invite:${userId}` : null;
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Read localStorage after hydration without rendering a dismissed card into server HTML.
    const frame = window.requestAnimationFrame(() => {
      if (storageKey) {
        try {
          setDismissed(window.localStorage.getItem(storageKey) === "dismissed");
        } catch {
          setDismissed(false);
        }
      }
      setReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [storageKey]);

  if (!ready || dismissed) return null;

  function dismiss() {
    if (storageKey) {
      try {
        window.localStorage.setItem(storageKey, "dismissed");
      } catch {
        // Keep the card dismissible for this visit if storage is unavailable.
      }
    }
    setDismissed(true);
  }

  return (
    <section
      aria-label="Becca's Campus invitation"
      className="relative mt-5 overflow-hidden rounded-[28px] border border-[var(--accent)]/20 bg-[var(--surface)] p-4 shadow-[var(--shadow)] sm:mt-6 sm:rounded-[32px] sm:p-6"
    >
      <div className="flex items-start gap-3 sm:gap-5">
        <div className="hidden shrink-0 sm:block">
          <Mascot mood="presenting" className="h-20 w-20" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--accent)]">Becca has a new idea</p>
          <h2 className="mt-1 text-lg font-extrabold text-[var(--foreground)]">Make your German practice more social</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            Start or join a short study group for vocabulary, speaking, grammar or exam practice, then try a quick
            German article duel in the Arena. A steady routine can help you build momentum toward your Germany goal.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link
              href="/campus"
              className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-extrabold text-white transition hover:brightness-110"
            >
              Explore Campus <ArrowRightIcon className="h-4 w-4" />
            </Link>
            {showStudyGroupLink ? (
              <Link href="/campus/groups" className="text-sm font-bold text-[var(--accent)] underline-offset-4 hover:underline">
                Find or start a study group
              </Link>
            ) : null}
            <button
              type="button"
              onClick={dismiss}
              className="ml-auto rounded-full px-3 py-2 text-xs font-semibold text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
