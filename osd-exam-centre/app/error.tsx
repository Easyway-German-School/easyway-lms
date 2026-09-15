"use client";

import { useEffect } from "react";
import { SiteHeader, SiteFooter } from "@/components/SiteChrome";

/**
 * Root error boundary. A candidate mid-booking must never see Next's raw
 * crash screen — this is the difference between "something broke, try
 * again or contact the office" and looking like the site is unreliable.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Unhandled page error:", error);
  }, [error]);

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-md px-6 py-24 text-center">
        <p className="font-serif-display text-2xl text-[var(--navy)]">Something went wrong</p>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          This is our fault, not yours. Your booking is not lost — try again, or check its status if you had already
          booked.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button onClick={reset} className="rounded-sm bg-[var(--navy)] px-5 py-2.5 text-sm font-semibold text-white">
            Try again
          </button>
          <a href="/status" className="rounded-sm border border-[var(--line)] px-5 py-2.5 text-sm font-semibold text-[var(--navy)]">
            Check my booking
          </a>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
