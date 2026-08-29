"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SparklesIcon, ArrowRightIcon } from "@/components/icons";

/**
 * The private-upgrade nudge for the ONE audience the popup on /programs never
 * reaches: a group student who has already paid in full.
 *
 * The popup on /programs fires once for a brand-new, UNPAID registrant —
 * exactly right for that moment, wrong for everyone after it, because a paid
 * student has no reason to revisit a checkout page ever again. This is what
 * they see instead, on the page they actually open daily. Same law as
 * TuitionNudge: a permanent inline band, never a modal — commerce does not
 * get to interrupt this dashboard, see src/lib/moment-queue.tsx. And like
 * TuitionNudge, silence is the failure mode: nothing renders for anyone
 * ineligible rather than an empty shell while data loads.
 *
 * WHY "FULLY PAID" IS THE GATE, not "just registered". A brand-new registrant
 * is asked this already, on the page where they are choosing how to pay in
 * the first place. Asking again the moment they log in is the same pitch
 * twice before they have sat in a single class. A FULLY PAID group student
 * has experienced the actual product — the pace, the room, the tutor split
 * twenty ways — and is the one who can honestly judge whether they want more
 * of it for themselves. That is a materially different, better-timed ask.
 */

const DISMISS_KEY = "easyway.private-upgrade-nudge.dismissed-at";
const COOLDOWN_MS = 21 * 24 * 60 * 60 * 1000; // resurfaces after three weeks, never nags daily

export default function PrivateUpgradeNudge({ classType, fullPaid }: { classType?: string; fullPaid?: boolean }) {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      const stamp = window.localStorage.getItem(DISMISS_KEY);
      const last = stamp ? Number(stamp) : 0;
      setDismissed(Boolean(last) && Date.now() - last < COOLDOWN_MS);
    } catch {
      setDismissed(false);
    }
  }, []);

  if (classType !== "group" || !fullPaid || dismissed) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // A missed write just means it resurfaces next visit — harmless.
    }
    setDismissed(true);
  }

  return (
    <div className="relative overflow-hidden rounded-[28px] border border-[#D4AF37]/35 bg-gradient-to-r from-[#0b1220] to-[#141d33] p-5 text-slate-100">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-[#D4AF37] opacity-[0.12] blur-3xl"
      />
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-[220px] items-center gap-3">
          <span className="grid h-10 w-10 flex-none place-items-center rounded-2xl bg-[#D4AF37]/15 text-[#E8C766]">
            <SparklesIcon className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.28em] text-[#E8C766]">You&apos;ve got the hang of this</p>
            <p className="mt-1 text-sm text-white/70">Ready for a tutor who plans every session around just you?</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={dismiss}
            className="text-xs font-medium text-white/40 transition hover:text-white/70"
          >
            Not now
          </button>
          <Link
            href="/programs#private-upgrade"
            className="inline-flex items-center gap-1.5 rounded-2xl bg-gradient-to-r from-[#D4AF37] to-[#E8C766] px-5 py-2.5 text-sm font-bold text-[#1c1508] transition hover:brightness-110"
          >
            See private tuition
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
