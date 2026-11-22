"use client";

import Link from "next/link";
import { ArrowRightIcon, PlaneIcon } from "@/components/icons";
import { formatDay, seatStatus, useSittings } from "./useSittings";

const TONE = {
  open: "bg-emerald-400/20 text-emerald-200 ring-emerald-300/40",
  filling: "bg-amber-300/20 text-amber-100 ring-amber-200/40",
  full: "bg-red-400/20 text-red-200 ring-red-300/40",
} as const;

/**
 * The hero's boarding-pass card: the next real sitting, straight from the
 * database. Airline metaphor on purpose — a seat number is literally what the
 * candidate walks away with.
 */
export default function NextSittingCard() {
  const state = useSittings();
  const next = state.status === "ready" ? state.sittings[0] : undefined;
  const status = next ? seatStatus(next) : null;
  const pct = next ? Math.max(4, Math.round((next.remaining / next.capacity) * 100)) : 0;

  return (
    <div className="fade-up delay-3 w-full max-w-md text-white lg:justify-self-end">
      <div className="rounded-2xl border border-white/20 bg-[#0a1a33]/72 px-6 py-6 shadow-2xl shadow-black/40 backdrop-blur-xl">
        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.28em] text-white/70">
          <span>Next sitting</span>
          <PlaneIcon className="h-4 w-4 text-[var(--gold-bright)]" />
        </div>

        {state.status === "loading" && (
          <div className="space-y-3 pt-5" aria-label="Loading the next sitting" role="status">
            <div className="skeleton h-6 w-4/5 rounded" />
            <div className="skeleton h-14 w-full rounded-lg" />
            <div className="skeleton h-11 w-full rounded-lg" />
          </div>
        )}

        {state.status === "ready" && !next && (
          <div className="pt-5">
            <p className="font-serif-display text-xl font-semibold">New dates are announced here first.</p>
            <p className="mt-2 text-sm text-white/70">No sittings are open for registration right now — check back soon.</p>
            <Link
              href="/status"
              className="mt-5 flex items-center justify-center gap-2 rounded-lg border border-white/30 px-5 py-3 text-sm font-semibold transition hover:bg-white/10"
            >
              Check an existing booking <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </div>
        )}

        {state.status === "error" && (
          <div className="pt-5">
            <p className="text-sm text-white/80">We couldn&apos;t load the sitting dates just now.</p>
            <Link
              href="/book"
              className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-[var(--gold-bright)] px-5 py-3 text-sm font-semibold text-[var(--navy-deep)] transition hover:brightness-110"
            >
              Open the booking page <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </div>
        )}

        {next && status && (
          <div className="pt-5">
            <div className="flex items-center justify-between">
              <p className="font-serif-display line-clamp-2 text-xl font-semibold leading-snug">{next.title}</p>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ${TONE[status.tone]}`}>
                {status.label}
              </span>
            </div>

            <dl className="mt-4 grid grid-cols-[1.4fr_0.6fr_1fr] gap-3 border-y border-white/15 py-3">
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-white/55">Date</dt>
                <dd className="mt-0.5 font-mono text-sm font-bold">{formatDay(next.startDate)}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-white/55">Level</dt>
                <dd className="mt-0.5 font-mono text-sm font-bold">{next.level}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-white/55">Seats left</dt>
                <dd className="mt-0.5 font-mono text-sm font-bold">{next.remaining} / {next.capacity}</dd>
              </div>
            </dl>

            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/15" aria-hidden="true">
              <div className="h-full rounded-full bg-gradient-to-r from-[var(--gold-bright)] to-[#FFB273]" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-white/65">
              {next.venueName}
            </p>

            <Link
              href="/book"
              className="mt-5 flex items-center justify-center gap-2 rounded-lg bg-[var(--gold-bright)] px-5 py-3 text-sm font-semibold text-[var(--navy-deep)] shadow-lg shadow-black/25 transition hover:brightness-110"
            >
              Book this sitting <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
