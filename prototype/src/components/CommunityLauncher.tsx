"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import CommunityHub from "@/components/CommunityHub";

/**
 * Floating launcher: a smiley button that opens the community hub inline,
 * so students never leave the page they're on.
 */

function SmileyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9.25" />
      <circle cx="9" cy="10" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="15" cy="10" r="1.05" fill="currentColor" stroke="none" />
      <path d="M8.2 14.2a4.6 4.6 0 0 0 7.6 0" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export default function CommunityLauncher() {
  const [open, setOpen] = useState(false);

  // Escape closes the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="w-[min(92vw,46rem)] overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_28px_80px_rgba(15,23,42,0.24)]">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">
                Easyway community
              </p>
              <p className="text-sm font-bold">Your learning spaces</p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/community"
                className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--surface-alt)]"
              >
                Open full view
              </Link>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close community"
                className="rounded-full p-1.5 text-[var(--muted)] transition hover:bg-[var(--surface-alt)]"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="p-3">
            <CommunityHub compact />
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={open ? "Close community" : "Open community"}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent)] text-white shadow-[0_12px_34px_rgba(255,102,0,0.42)] transition hover:scale-105 active:scale-95"
      >
        {open ? <CloseIcon className="h-6 w-6" /> : <SmileyIcon className="h-7 w-7" />}
      </button>
    </div>
  );
}
