"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Mascot, { type MascotMood } from "@/components/Mascot";
import { useMoment } from "@/lib/moment-queue";
import { isMonthDumpWindow, schoolCalendarParts } from "@/lib/month-dump-window";
import { ArrowRightIcon, SparklesIcon } from "@/components/icons";

type MonthDump = {
  monthLabel: string;
  year: number;
  headline: string;
  lines: string[];
  personalNote: string | null;
  suggestions: Array<{ label: string; blurb: string; href: string }>;
  stats: {
    lessons: number;
    quizzes: number;
    missions: number;
    assignments: number;
    communityPosts: number;
    videosCompleted: number;
    videosInProgress: number;
  };
  journey: {
    level: string | null;
    goalLabel: string | null;
    pathway: string | null;
    daysInClass: number | null;
    stampsCount: number;
  };
};

/**
 * Becca's month-end dump.
 *
 * Soft on purpose: View now expands the story; Remind me later snoozes for
 * several hours and leaves it in the dock. Once the student has opened the
 * full dump, we stamp the calendar month so it never re-ambushes them.
 */

const SNOOZE_KEY = "ew-month-dump-snoozed-until";
const SNOOZE_MS = 8 * 60 * 60 * 1000;

function monthStampKey(year: number, monthLabel: string): string {
  return `ew-month-dump-${year}-${monthLabel}`;
}

function isSnoozed(): boolean {
  try {
    return Date.now() < Number(window.localStorage.getItem(SNOOZE_KEY) ?? 0);
  } catch {
    return false;
  }
}

function snooze() {
  try {
    window.localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
  } catch {
    /* private mode — worst case it returns sooner */
  }
}

function wasViewedThisMonth(): boolean {
  try {
    const { year, monthLabel } = schoolCalendarParts();
    return window.localStorage.getItem(monthStampKey(year, monthLabel)) === "1";
  } catch {
    return false;
  }
}

function stampViewed(dump: MonthDump) {
  try {
    window.localStorage.setItem(monthStampKey(dump.year, dump.monthLabel), "1");
    window.localStorage.removeItem(SNOOZE_KEY);
  } catch {
    /* one repeat beats a crash */
  }
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-white/10 px-3 py-2.5 text-center backdrop-blur">
      <p className="text-xl font-black tabular-nums text-white">{value}</p>
      <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/70">{label}</p>
    </div>
  );
}

export default function MonthDumpMoment() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();

  const [dump, setDump] = useState<MonthDump | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [snoozed, setSnoozed] = useState(true);
  const [viewed, setViewed] = useState(true);

  useEffect(() => {
    setSnoozed(isSnoozed());
    setViewed(wasViewedThisMonth());
  }, []);

  useEffect(() => {
    if (!isMonthDumpWindow() || wasViewedThisMonth() || isSnoozed()) {
      setLoaded(true);
      return;
    }

    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/student/brief?dump=1", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as MonthDump;
        if (alive) setDump(data);
      } catch {
        /* Offline — dock/card still cover monthly. */
      } finally {
        if (alive) setLoaded(true);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const due = loaded && Boolean(dump) && isMonthDumpWindow() && !snoozed && !viewed;
  const { open, close } = useMoment("month-dump", due);

  const mood: MascotMood = useMemo(() => {
    if (!dump) return "presenting";
    const total =
      dump.stats.lessons +
      dump.stats.assignments +
      dump.stats.videosCompleted +
      dump.stats.missions +
      dump.stats.communityPosts;
    if (total >= 20) return "celebrating";
    if (total >= 8) return "cheerful";
    return "greeting";
  }, [dump]);

  const remindLater = useCallback(() => {
    snooze();
    setSnoozed(true);
    close();
  }, [close]);

  const viewNow = useCallback(() => {
    setExpanded(true);
  }, []);

  const finish = useCallback(() => {
    if (dump) stampViewed(dump);
    setViewed(true);
    close();
  }, [dump, close]);

  const goSuggestion = useCallback(
    (href: string) => {
      if (dump) stampViewed(dump);
      setViewed(true);
      close();
      router.push(href);
    },
    [dump, close, router],
  );

  if (!open || !dump) return null;

  const beccaLine = dump.personalNote ?? dump.headline;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto overscroll-contain bg-slate-950/65 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-label={`Your ${dump.monthLabel} with Becca`}
      >
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 260, damping: 26 }}
          className="relative my-auto w-full max-w-lg overflow-hidden rounded-[32px] bg-[var(--surface)] shadow-2xl"
        >
          <div className="relative overflow-hidden bg-gradient-to-br from-[#0D7C7E] via-[#0a6365] to-[#FF6600] px-7 pb-6 pt-8 text-white">
            {!reduceMotion &&
              [0, 1].map((ring) => (
                <motion.div
                  key={ring}
                  aria-hidden
                  initial={{ scale: 0.5, opacity: 0.35 }}
                  animate={{ scale: 2.2, opacity: 0 }}
                  transition={{ duration: 2.8, delay: ring * 0.9, repeat: Infinity, ease: "easeOut" }}
                  className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full border border-white/35"
                />
              ))}

            <div className="relative flex items-start gap-4">
              <Mascot mood={mood} className="h-20 w-20 shrink-0 drop-shadow-xl" />
              <div className="min-w-0 flex-1 pt-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/75">
                  {dump.monthLabel} dump
                </p>
                <p className="mt-2 text-lg font-bold leading-snug">&ldquo;{beccaLine}&rdquo;</p>
              </div>
            </div>
          </div>

          {!expanded ? (
            <div className="space-y-4 p-6">
              <p className="text-sm leading-relaxed text-[var(--muted)]">
                Becca put together your {dump.monthLabel} — what you actually did, where you are on the
                Germany road, and a couple of gentle next steps. Nothing urgent.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={viewNow}
                  className="flex flex-1 items-center justify-center gap-2 rounded-full btn-glow px-6 py-3.5 text-sm font-bold text-white shadow-lg transition hover:brightness-110"
                >
                  View now <ArrowRightIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={remindLater}
                  className="rounded-full border border-[var(--border)] px-6 py-3.5 text-sm font-semibold text-[var(--muted)] transition hover:bg-[var(--surface-alt)]"
                >
                  Remind me later
                </button>
              </div>
            </div>
          ) : (
            <div className="max-h-[70vh] space-y-5 overflow-y-auto p-6">
              <section>
                <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
                  What you did in {dump.monthLabel}
                </h3>
                <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  <Stat label="Lessons" value={dump.stats.lessons} />
                  <Stat label="Assignments" value={dump.stats.assignments} />
                  <Stat label="Videos" value={dump.stats.videosCompleted} />
                  <Stat label="Quests" value={dump.stats.missions} />
                  <Stat label="Quizzes" value={dump.stats.quizzes} />
                  <Stat label="Community" value={dump.stats.communityPosts} />
                  {dump.stats.videosInProgress > 0 ? (
                    <Stat label="In progress" value={dump.stats.videosInProgress} />
                  ) : null}
                </div>
              </section>

              <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-4">
                <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
                  Where you are on the road
                </h3>
                <ul className="mt-2 space-y-1.5 text-sm text-[var(--foreground)]">
                  {dump.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                {dump.journey.goalLabel ? (
                  <p className="mt-3 text-xs italic text-[var(--accent)]">{dump.journey.goalLabel}</p>
                ) : null}
              </section>

              {dump.suggestions.length > 0 ? (
                <section>
                  <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
                    <SparklesIcon className="h-3.5 w-3.5" /> What Becca suggests next
                  </h3>
                  <ul className="mt-3 space-y-2">
                    {dump.suggestions.map((item) => (
                      <li key={item.href + item.label}>
                        <button
                          type="button"
                          onClick={() => goSuggestion(item.href)}
                          className="flex w-full items-start gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-left transition hover:border-[var(--accent)]/40 hover:bg-[var(--accent-soft)]"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-[var(--foreground)]">{item.label}</p>
                            <p className="mt-0.5 text-xs text-[var(--muted)]">{item.blurb}</p>
                          </div>
                          <ArrowRightIcon className="mt-1 h-4 w-4 shrink-0 text-[var(--accent)]" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <div className="flex flex-col gap-3 pt-1 sm:flex-row">
                <button
                  type="button"
                  onClick={finish}
                  className="flex flex-1 items-center justify-center gap-2 rounded-full btn-glow px-6 py-3.5 text-sm font-bold text-white"
                >
                  Got it
                </button>
                <button
                  type="button"
                  onClick={() => {
                    finish();
                    router.push("/dashboard");
                  }}
                  className="rounded-full border border-[var(--border)] px-6 py-3.5 text-sm font-semibold text-[var(--muted)] transition hover:bg-[var(--surface-alt)]"
                >
                  Open dashboard
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
