"use client";

import { LockIcon, SparklesIcon, CheckCircleIcon, ExamCentreIcon } from "@/components/icons";

/**
 * The ÖSD/telc booking flow, sealed.
 *
 * It used to run through the exact same register-and-pay code as EasyWay's
 * own exams, with a placeholder fee and no real link to the exam body — which
 * meant a candidate could hand over money for a sitting the school could not
 * actually deliver. Better to say plainly that it isn't open yet than to keep
 * a live-looking "Register" button in front of an unpriced, unlinked exam.
 *
 * Same honesty rules as `LockedCertificate`: real layout, clearly marked as a
 * preview, and the two things actually missing spelled out rather than a
 * vague "coming soon".
 */
export default function ExamBodyComingSoon({
  onExploreInternal,
  exploreHref,
}: {
  /** Switches the caller's own tab/filter back to EasyWay's internal exam, if it has one. */
  onExploreInternal?: () => void;
  /** Used instead of `onExploreInternal` on pages with no internal tab of their own. */
  exploreHref?: string;
}) {
  const checklist = [
    { done: false, title: "Official fee confirmed", detail: "The centre is waiting on ÖSD/telc's current published price before it can charge for a seat." },
    { done: false, title: "Certified booking link secured", detail: "Bookings will route to the exam body's own official page — not a page we've built to look like one." },
  ];

  return (
    <div className="relative overflow-hidden rounded-[32px] border border-[var(--border)] bg-[var(--surface-alt)] p-5 shadow-[var(--shadow)] sm:p-7">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full blur-[90px]"
        style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--accent) 40%, transparent), transparent 68%)" }}
      />

      <div className="relative grid gap-7 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
        {/* ---- The sealed sitting card ------------------------------------ */}
        <div className="relative">
          <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
            <div className="scale-[1.02] space-y-4 p-6 blur-[3px] saturate-[0.85] [transform-origin:center]" aria-hidden>
              <div className="flex items-center justify-between">
                <span className="rounded bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase text-red-700">ÖSD</span>
                <span className="rounded bg-[var(--surface-alt)] px-2 py-0.5 text-[10px] font-bold">B1</span>
              </div>
              <div className="h-4 w-3/5 rounded-full bg-slate-400/40" />
              <div className="h-3 w-2/5 rounded-full bg-slate-300/40" />
              <div className="mt-4 flex items-center justify-between">
                <div className="h-8 w-24 rounded-full bg-slate-300/40" />
                <div className="h-9 w-28 rounded-full bg-[var(--accent)]/40" />
              </div>
            </div>
          </div>

          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-2xl"
            style={{
              background:
                "linear-gradient(160deg, rgba(5,48,46,0.5), rgba(5,48,46,0.25) 45%, rgba(255,102,0,0.2))",
            }}
          />

          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 -rotate-[7deg] border-y border-white/25 bg-black/25 py-1.5 text-center text-[11px] font-black uppercase tracking-[0.5em] text-white/85 backdrop-blur-[1px] sm:text-sm"
          >
            Coming soon
          </div>

          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="grid h-20 w-20 place-items-center rounded-3xl border border-white/30 bg-black/45 text-white shadow-2xl backdrop-blur-md sm:h-24 sm:w-24">
              <LockIcon className="h-9 w-9 sm:h-10 sm:w-10" strokeWidth={1.7} />
            </div>
          </div>
        </div>

        {/* ---- What's actually missing -------------------------------- */}
        <div>
          <p className="inline-flex items-center gap-2 rounded-full bg-[var(--accent-soft)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.24em] text-[var(--accent)]">
            <SparklesIcon className="h-3.5 w-3.5" /> ÖSD · telc
          </p>

          <h2 className="mt-4 text-2xl font-extrabold leading-tight text-[var(--foreground)] sm:text-3xl">
            Official exam-body booking isn't open here yet.
          </h2>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            EasyWay is preparing to sit candidates for ÖSD and telc directly. Two things have to be real before a
            single seat is sold — not soon in a marketing sense, just not invented.
          </p>

          <ol className="mt-6 space-y-3">
            {checklist.map((step) => (
              <li key={step.title} className="flex gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
                <span className="mt-0.5 shrink-0">
                  {step.done ? (
                    <CheckCircleIcon className="h-5 w-5 text-[var(--success)]" />
                  ) : (
                    <LockIcon className="h-5 w-5 text-[var(--muted)]" />
                  )}
                </span>
                <span>
                  <span className="block text-sm font-bold text-[var(--foreground)]">{step.title}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-[var(--muted)]">{step.detail}</span>
                </span>
              </li>
            ))}
          </ol>

          {onExploreInternal ? (
            <button
              onClick={onExploreInternal}
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-bold text-white shadow-lg transition hover:brightness-110"
            >
              <ExamCentreIcon className="h-4 w-4" /> See EasyWay's own exams
            </button>
          ) : exploreHref ? (
            <a
              href={exploreHref}
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-bold text-white shadow-lg transition hover:brightness-110"
            >
              <ExamCentreIcon className="h-4 w-4" /> See EasyWay's own exams
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
