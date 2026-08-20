"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { SparklesIcon, ArrowRightIcon, StarIcon, CheckCircleIcon } from "@/components/icons";
import { PRIVATE_CLASS_UPGRADE_PRICE } from "@/lib/payment";

/**
 * Premium upsell card for private one-to-one classes.
 *
 * Deliberately its own fixed dark/gold look rather than following the
 * Tag/Nacht/Dämmerung site theme — see [[project-theme-system]] for why
 * everything else follows it. A membership card is the one place on the
 * dashboard meant to read as a different tier of the product, in whichever
 * theme the rest of the page is in; matching the surrounding surface would
 * make it look like a normal panel with a fancier border rather than
 * something worth paying for.
 *
 * Only visible to group class students; hidden once already private.
 */

type StudentInfo = {
  classType: string;
  level?: string;
  branchName?: string;
};

const BENEFITS = [
  { title: "Personalised learning plan", blurb: "Built around your goal, not a class average." },
  { title: "Flexible class times", blurb: "Agreed directly with your tutor, not a fixed sitting." },
  { title: "Direct tutor access", blurb: "One tutor who knows your progress, every session." },
  { title: "Advanced private AI studio", blurb: "Expanded essay, pronunciation, and mission practice limits between sessions." },
  { title: "Faster progress", blurb: "No pace-matching a room of twenty other students." },
];

export default function PremiumPrivateClasses({ student }: { student: StudentInfo }) {
  const { data: session } = useSession();
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState("");

  // Only show if student is in group class
  if (student.classType === "private") {
    return null;
  }

  async function initiateUpgrade() {
    if (!session?.user?.id) return;

    setIsProcessing(true);
    setMessage("");

    try {
      // Initialize payment for private class upgrade
      const res = await fetch("/api/paystack/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "private_class_upgrade",
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        setMessage(error.error || "Failed to initiate payment");
        return;
      }

      const data = await res.json();
      if (data.authorizationUrl) {
        window.location.href = data.authorizationUrl;
      }
    } catch (error) {
      console.error("Upgrade failed:", error);
      setMessage("Unable to process upgrade. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <div
      className="group relative overflow-hidden rounded-[32px] p-[1px] shadow-[0_30px_90px_-30px_rgba(212,175,55,0.45)] transition-shadow duration-500 hover:shadow-[0_40px_110px_-25px_rgba(212,175,55,0.6)]"
      style={{
        background: "linear-gradient(135deg, rgba(212,175,55,0.7), rgba(255,102,0,0.35), rgba(212,175,55,0.15))",
      }}
    >
      {/* The card proper, inset by 1px so the wrapper's gradient reads as a
          hairline border rather than a filled block. */}
      <div className="relative overflow-hidden rounded-[31px] bg-[radial-gradient(circle_at_15%_0%,_#1c1917_0%,_#0b0a09_55%,_#000000_100%)] px-6 py-7 sm:px-9 sm:py-9">
        {/* Ambient gold + ember glows, always drifting — the "aura" the rest
            of the card sits inside. Pure decoration: aria-hidden, and capped
            opacity so text contrast never depends on where they land. */}
        <div
          aria-hidden
          className="animate-blob pointer-events-none absolute left-1/4 top-0 h-72 w-72 rounded-full bg-[#D4AF37] opacity-[0.16] blur-3xl"
        />
        <div
          aria-hidden
          className="animate-pulse-slow pointer-events-none absolute bottom-0 right-0 h-80 w-80 rounded-full bg-[#FF6600] opacity-[0.14] blur-3xl"
        />
        {/* A slow diagonal sheen, independent of the CTA's own shimmer —
            reads as glass catching light rather than a loading state. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -translate-x-full bg-[linear-gradient(115deg,transparent_35%,rgba(255,255,255,0.07)_50%,transparent_65%)] [animation:pan_7s_ease-in-out_infinite]"
        />

        <div className="relative">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-[#D4AF37]/40 bg-[#D4AF37]/10 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#E8C766]">
              <SparklesIcon className="h-3.5 w-3.5" />
              Private membership
            </span>
            <span className="inline-flex items-center gap-1 text-[#E8C766]/80">
              {[0, 1, 2].map((i) => (
                <StarIcon key={i} className="h-3.5 w-3.5" strokeWidth={1.4} />
              ))}
            </span>
          </div>

          <h3 className="mt-5 bg-gradient-to-r from-white via-[#F4E3B2] to-[#D4AF37] bg-clip-text text-2xl font-bold leading-tight text-transparent sm:text-3xl">
            One-to-one, entirely yours
          </h3>
          <p className="mt-2 max-w-lg text-sm leading-6 text-white/60">
            Trade the group timetable for a dedicated tutor who plans every session around you — your pace, your
            schedule, your goal.
          </p>
          <p className="mt-3 max-w-lg text-sm font-semibold leading-6 text-[#F4E3B2]">
            Includes an advanced AI practice studio: 8 writing reviews, 30 speaking drills, and 30 mission practices each day.
          </p>

          <ul className="mt-7 grid gap-4 sm:grid-cols-2">
            {BENEFITS.map((benefit) => (
              <li
                key={benefit.title}
                className="flex items-start gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3.5 backdrop-blur-sm transition-colors duration-300 hover:border-[#D4AF37]/30 hover:bg-white/[0.05]"
              >
                <span className="mt-0.5 grid h-7 w-7 flex-none place-items-center rounded-full bg-[#D4AF37]/15 text-[#E8C766]">
                  <CheckCircleIcon className="h-4 w-4" strokeWidth={2} />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-white">{benefit.title}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-white/50">{benefit.blurb}</span>
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-8 flex flex-col gap-5 border-t border-white/[0.08] pt-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/40">One-time upgrade</p>
              <p className="mt-1 bg-gradient-to-r from-[#F4E3B2] to-[#D4AF37] bg-clip-text text-3xl font-bold text-transparent">
                ₦{PRIVATE_CLASS_UPGRADE_PRICE.toLocaleString("en-NG")}
              </p>
              <p className="mt-1 text-xs text-white/40">
                Paid once. The office pairs you with your tutor as soon as it clears.
              </p>
            </div>

            <button
              onClick={initiateUpgrade}
              disabled={isProcessing}
              className="shimmer-line group/btn relative flex items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-[#D4AF37] via-[#E8C766] to-[#D4AF37] px-7 py-3.5 text-sm font-bold text-[#1c1508] shadow-[0_18px_40px_-12px_rgba(212,175,55,0.55)] transition duration-300 hover:brightness-110 hover:shadow-[0_22px_50px_-10px_rgba(212,175,55,0.7)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="relative z-10">{isProcessing ? "Processing…" : "Go private"}</span>
              {!isProcessing && <ArrowRightIcon className="relative z-10 h-4 w-4 transition-transform duration-300 group-hover/btn:translate-x-0.5" />}
            </button>
          </div>

          {message ? <p className="mt-4 text-sm text-rose-300">{message}</p> : null}
        </div>
      </div>
    </div>
  );
}
