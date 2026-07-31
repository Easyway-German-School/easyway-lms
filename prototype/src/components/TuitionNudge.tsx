"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { safeJson } from "@/lib/safe-json";
import type { FullPaymentOffer } from "@/lib/pay-in-full";

/**
 * The slim balance band, shown on the dashboard and the payments page.
 *
 * Its job is repetition and the goal gradient: a student with 60% paid sees the
 * same unfinished bar and the same single outstanding figure everywhere they
 * go, rather than a fee reminder once a fortnight. It renders nothing at all
 * once tuition is settled — a paid student should never be sold to again.
 */

const naira = (value: number) => `₦${Math.round(value).toLocaleString()}`;

export default function TuitionNudge({ className = "" }: { className?: string }) {
  const [offer, setOffer] = useState<FullPaymentOffer | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/student/tuition-offer", { cache: "no-store", credentials: "include" });
        const json = await safeJson(res);
        if (!cancelled && res.ok && json?.offer) setOffer(json.offer as FullPaymentOffer);
      } catch {
        // A nudge is not worth an error state. Silence is the right failure here.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!offer || offer.fullPaid || offer.tuitionFee <= 0) return null;

  return (
    <div
      className={`overflow-hidden rounded-[28px] border border-[#c8a24a]/35 bg-gradient-to-r from-[#0b1220] to-[#141d33] p-6 text-slate-100 ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div className="min-w-[220px]">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.28em] text-[#c8a24a]">
            Tuition outstanding
          </p>
          <p className="mt-2 font-serif text-3xl font-semibold text-white">{naira(offer.outstanding)}</p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {offer.remainingPercent}% of your tuition is still unpaid
            {offer.windowOpen
              ? ` · ${offer.daysLeftInWindow} day${offer.daysLeftInWindow === 1 ? "" : "s"} left for the pay-in-full extras`
              : ""}
            .
          </p>
        </div>

        <div className="flex-1 basis-full sm:basis-auto">
          {/* The bar is deliberately left visibly short of the end. */}
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-[#c8a24a] transition-[width] duration-1000"
              style={{ width: `${offer.progressPercent}%` }}
            />
          </div>
          <div className="mt-2 flex justify-between text-[0.65rem] uppercase tracking-[0.16em] text-[var(--muted)]">
            <span>{offer.progressPercent}% paid</span>
            <span>100%</span>
          </div>
        </div>

        <Link
          href="/programs"
          className="rounded-2xl bg-[#c8a24a] px-6 py-3 text-sm font-bold text-[#1a1206] transition hover:bg-[#d8b45f]"
        >
          Clear {naira(offer.outstanding)}
        </Link>
      </div>
    </div>
  );
}
