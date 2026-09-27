"use client";

import Link from "next/link";
import { ArrowRightIcon, PlaneIcon } from "@/components/icons";
import { formatDay, seatStatus, useSittings } from "./useSittings";

const CHIP = {
  open: "text-emerald-300 border-emerald-400/40 bg-emerald-400/10",
  filling: "text-amber-200 border-amber-300/40 bg-amber-300/10",
  full: "text-red-300 border-red-400/40 bg-red-400/10",
} as const;

/**
 * "Departures": every published sitting still open for registration, styled
 * like an airport board. Reads the same public /api/sessions the booking
 * wizard uses, so it can never disagree with what a candidate can actually book.
 */
export default function DeparturesBoard() {
  const state = useSittings();

  return (
    <section id="sittings" className="relative z-10 -mt-20 px-5 pb-20 sm:px-6 sm:pb-28">
      <div className="mx-auto max-w-6xl">
        <div className="reveal overflow-hidden rounded-3xl bg-[#08121f] shadow-2xl shadow-[#071328]/40 ring-1 ring-white/10">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-gradient-to-r from-[#0d2140] to-[#08121f] px-5 py-4 sm:px-8 sm:py-5">
            <div className="flex items-center gap-3">
              <PlaneIcon className="h-6 w-6 text-[var(--amber)]" />
              <h2 className="font-mono text-xl font-bold uppercase tracking-[0.3em] text-[var(--amber)] sm:text-2xl">
                Departures
              </h2>
            </div>
            <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-white/60">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              Upcoming sittings · live
            </p>
          </div>

          <div className="hidden grid-cols-[1.1fr_0.5fr_2fr_0.8fr_1fr_1.1fr] gap-4 px-8 py-3 font-mono text-[11px] uppercase tracking-[0.2em] text-white/40 md:grid">
            <span>Date</span>
            <span>Level</span>
            <span>Sitting</span>
            <span>Seats</span>
            <span>Fee</span>
            <span className="text-right">Status</span>
          </div>

          <div className="divide-y divide-white/[0.07]">
            {state.status === "loading" &&
              [0, 1, 2].map((i) => (
                <div key={i} className="px-5 py-5 sm:px-8" role="status" aria-label="Loading sittings">
                  <div className="skeleton h-5 w-full max-w-3xl rounded" />
                </div>
              ))}

            {state.status === "error" && (
              <p className="px-5 py-10 text-center font-mono text-sm uppercase tracking-widest text-white/60 sm:px-8">
                Departures unavailable — try the{" "}
                <Link href="/book" className="text-[var(--amber)] underline underline-offset-4">booking page</Link>
              </p>
            )}

            {state.status === "ready" && state.sittings.length === 0 && (
              <p className="px-5 py-12 text-center font-mono text-sm uppercase tracking-widest text-white/60 sm:px-8">
                No departures scheduled — new sittings are announced here first
              </p>
            )}

            {state.status === "ready" &&
              state.sittings.map((s) => {
                const st = seatStatus(s);
                return (
                  <Link
                    key={s.id}
                    href="/book"
                    className="group grid gap-x-4 gap-y-2 px-5 py-5 transition hover:bg-white/[0.04] sm:px-8 md:grid-cols-[1.1fr_0.5fr_2fr_0.8fr_1fr_1.1fr] md:items-center"
                  >
                    <span className="font-mono text-base font-bold text-[var(--amber)]">{formatDay(s.startDate)}</span>
                    <span>
                      <span className="inline-block rounded border border-white/25 px-2 py-0.5 font-mono text-sm font-bold text-white">
                        {s.level}
                      </span>
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-white">{s.title}</span>
                      <span className="block truncate text-xs text-white/50">{s.venueName}</span>
                    </span>
                    <span className="font-mono text-sm text-white/80">{s.remaining} / {s.capacity}</span>
                    <span className="font-mono text-sm text-white/80">₦{s.feeWholeExam.toLocaleString("en-NG")}</span>
                    <span className="flex items-center gap-3 md:justify-end">
                      <span className={`rounded-full border px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-widest ${CHIP[st.tone]}`}>
                        {st.label}
                      </span>
                      <ArrowRightIcon className="h-4 w-4 text-white/30 transition group-hover:translate-x-1 group-hover:text-[var(--amber)]" />
                    </span>
                  </Link>
                );
              })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-white/[0.02] px-5 py-4 text-xs text-white/50 sm:px-8">
            <span>Seats are reserved automatically once your payment is confirmed.</span>
            <Link href="/book" className="font-semibold uppercase tracking-widest text-[var(--amber)] hover:underline">
              Start registration →
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
