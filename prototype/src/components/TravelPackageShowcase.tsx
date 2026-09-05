"use client";

import { useState } from "react";
import { PlaneIcon, CheckCircleIcon, StarIcon, SparklesIcon } from "@/components/icons";
import { TRAVEL_PACKAGE_MIN_FIRST_PAYMENT, TRAVEL_PACKAGE_PRICE } from "@/lib/payment";

/**
 * The Travel Package marketing card — the school's premium, walk-in-only
 * relocation track. Deliberately its own dreamy blue-and-gold look, same
 * reasoning as PremiumPrivateClasses: a membership tier this different in
 * price should not read as a normal panel with a fancier border.
 *
 * No self-service checkout here on purpose — onboarding is manual, the same
 * way "Travel Package" already works as a pathway on the admin's own "Add
 * student" form. The card's only action is to start a conversation with the
 * office, through the same support-ticket system every other question in
 * the portal already goes through.
 *
 * Hidden for anyone already on the pathway, and for anyone whose account was
 * onboarded manually and has no self-service context to show a price to.
 */

type StudentInfo = { pathway?: string | null };

const BENEFITS = [
  { title: "Full relocation support", blurb: "Documentation, timelines and partner coordination alongside the language training." },
  { title: "Dedicated onboarding", blurb: "Handled personally by the office from your first conversation, not a signup form." },
  { title: "Priority scheduling", blurb: "Classes and mock exams arranged around your relocation timeline, not the other way round." },
  { title: "One flat fee", blurb: "No per-level charges — a single price covers the whole journey, start to finish." },
];

export default function TravelPackageShowcase({ student }: { student: StudentInfo }) {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  if (student.pathway === "Travel Package") return null;

  async function askAboutIt() {
    setStatus("sending");
    try {
      const res = await fetch("/api/support/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: "Travel Package enquiry",
          topic: "other",
          body: "I'd like to find out more about the Travel Package — please get in touch.",
          fromPath: "/programs",
        }),
      });
      setStatus(res.ok ? "sent" : "error");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div
      className="group relative overflow-hidden rounded-[32px] p-[1px] shadow-[0_30px_90px_-30px_rgba(56,142,255,0.35)] transition-shadow duration-500 hover:shadow-[0_40px_110px_-25px_rgba(212,175,55,0.5)]"
      style={{ background: "linear-gradient(135deg, rgba(56,142,255,0.55), rgba(212,175,55,0.4), rgba(56,142,255,0.15))" }}
    >
      <div className="relative overflow-hidden rounded-[31px] bg-[radial-gradient(circle_at_85%_0%,_#0f1c2e_0%,_#0a0f1a_55%,_#000000_100%)] px-6 py-7 sm:px-9 sm:py-9">
        {/* Drifting cloud-like glows instead of the fire/gold-only aura on the
            private-class card — this one should feel like sky, not a hearth. */}
        <div aria-hidden className="animate-blob pointer-events-none absolute right-1/4 top-0 h-72 w-72 rounded-full bg-[#3B82F6] opacity-[0.18] blur-3xl" />
        <div aria-hidden className="animate-pulse-slow pointer-events-none absolute bottom-0 left-0 h-80 w-80 rounded-full bg-[#D4AF37] opacity-[0.14] blur-3xl" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -translate-x-full bg-[linear-gradient(115deg,transparent_35%,rgba(255,255,255,0.06)_50%,transparent_65%)] [animation:pan_7s_ease-in-out_infinite]"
        />

        <div className="relative">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-[#3B82F6]/40 bg-[#3B82F6]/10 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8FC1FF]">
              <PlaneIcon className="h-3.5 w-3.5" />
              Travel Package
            </span>
            <span className="inline-flex items-center gap-1 text-[#E8C766]/80">
              {[0, 1, 2].map((i) => (
                <StarIcon key={i} className="h-3.5 w-3.5" strokeWidth={1.4} />
              ))}
            </span>
          </div>

          <h3 className="mt-5 bg-gradient-to-r from-white via-[#BFDCFF] to-[#D4AF37] bg-clip-text text-2xl font-bold leading-tight text-transparent sm:text-3xl">
            Language training, built around leaving
          </h3>
          <p className="mt-2 max-w-lg text-sm leading-6 text-white/60">
            For students whose real goal is the move, not just the certificate. One relationship with
            the office, from your first class to the day you travel.
          </p>

          {/* A scripted line in Becca's voice — not AI-generated, same
              reasoning as the rest of this card: a fixed marketing pitch does
              not need a model call, and every other upsell surface in the
              portal (see PrivateUpsellPopup) is written the same way. */}
          <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-[#3B82F6]/25 bg-[#3B82F6]/10 p-4">
            <SparklesIcon className="mt-0.5 h-4 w-4 shrink-0 text-[#8FC1FF]" />
            <p className="text-sm leading-6 text-[#DCEBFF]">
              <span className="font-semibold text-white">Becca:</span> &quot;If Germany is the actual
              plan and not just the exam, this is the track built for that — talk to the office and
              they&apos;ll walk you through it.&quot;
            </p>
          </div>

          <ul className="mt-7 grid gap-4 sm:grid-cols-2">
            {BENEFITS.map((benefit) => (
              <li
                key={benefit.title}
                className="flex items-start gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3.5 backdrop-blur-sm transition-colors duration-300 hover:border-[#3B82F6]/30 hover:bg-white/[0.05]"
              >
                <span className="mt-0.5 grid h-7 w-7 flex-none place-items-center rounded-full bg-[#3B82F6]/15 text-[#8FC1FF]">
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
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/40">Full programme, one fee</p>
              <p className="mt-1 bg-gradient-to-r from-[#BFDCFF] to-[#D4AF37] bg-clip-text text-3xl font-bold text-transparent">
                ₦{TRAVEL_PACKAGE_PRICE.toLocaleString("en-NG")}
              </p>
              <p className="mt-1 text-xs text-white/40">
                From ₦{TRAVEL_PACKAGE_MIN_FIRST_PAYMENT.toLocaleString("en-NG")} to begin — the rest in
                flexible instalments, arranged with the office. Onboarded in person, not online.
              </p>
            </div>

            <button
              onClick={askAboutIt}
              disabled={status === "sending" || status === "sent"}
              className="shimmer-line group/btn relative flex items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-[#3B82F6] via-[#8FC1FF] to-[#D4AF37] px-7 py-3.5 text-sm font-bold text-[#0a0f1a] shadow-[0_18px_40px_-12px_rgba(59,130,246,0.55)] transition duration-300 hover:brightness-110 hover:shadow-[0_22px_50px_-10px_rgba(212,175,55,0.6)] disabled:cursor-not-allowed disabled:opacity-70"
            >
              <span className="relative z-10">
                {status === "sent" ? "Request sent — we'll be in touch" : status === "sending" ? "Sending…" : "Ask about the Travel Package"}
              </span>
            </button>
          </div>

          {status === "error" && (
            <p className="mt-4 text-sm text-rose-300">Could not send that just now — try again in a moment.</p>
          )}
        </div>
      </div>
    </div>
  );
}
