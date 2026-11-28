"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Mascot from "@/components/Mascot";
import { ArrowRightIcon } from "@/components/icons";

/**
 * Becca's brief. One host, three periods — see src/lib/student-brief.ts for
 * why the numbers are queried rather than generated, and project-mascot.md
 * for why she gets one consistent "presenting" pose here regardless of
 * whether the news is good: she's reporting the numbers, not reacting to
 * them, the same way a news anchor doesn't change costume for a bad headline.
 *
 * The monthly tab pulls the richer month dump (assignments, community,
 * videos, Germany road) when available so the popup and the card stay in sync.
 */

type Period = "daily" | "weekly" | "monthly";

const TABS: { key: Period; label: string }[] = [
  { key: "daily", label: "Today" },
  { key: "weekly", label: "This week" },
  { key: "monthly", label: "This month" },
];

type Suggestion = { label: string; blurb: string; href: string };

type Brief = {
  headline: string;
  lines: string[];
  personalNote: string | null;
  suggestions?: Suggestion[];
  monthLabel?: string;
  stats?: {
    lessons: number;
    quizzes: number;
    missions: number;
    assignments: number;
    communityPosts: number;
    videosCompleted: number;
    videosInProgress: number;
  };
  journey?: {
    level: string | null;
    goalLabel: string | null;
    daysInClass: number | null;
    stampsCount: number;
  };
};

export default function StudentBrief() {
  const [period, setPeriod] = useState<Period>("daily");
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    (async () => {
      try {
        const url =
          period === "monthly" ? "/api/student/brief?dump=1" : `/api/student/brief?period=${period}`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (alive) setBrief(data);
      } catch {
        /* The card just stays quiet. */
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [period]);

  if (loaded && !brief) return null;

  return (
    <div className="rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm uppercase tracking-[0.3em] text-[var(--muted)]">
          {period === "monthly" && brief?.monthLabel ? `${brief.monthLabel} with Becca` : "Your brief"}
        </p>
        <div className="flex gap-1 rounded-full bg-[var(--surface-alt)] p-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setPeriod(tab.key)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                period === tab.key
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 flex items-start gap-4">
        <Mascot mood="presenting" className="h-16 w-16 shrink-0" />
        <div className="min-w-0 flex-1">
          {brief ? (
            <>
              <p className="font-semibold text-[var(--foreground)]">{brief.headline}</p>
              {brief.lines.length > 0 ? (
                <ul className="mt-2 space-y-1 text-sm text-[var(--muted)]">
                  {brief.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : null}
              {brief.personalNote ? (
                <p className="mt-3 text-sm italic text-[var(--accent)]">&ldquo;{brief.personalNote}&rdquo;</p>
              ) : null}

              {period === "monthly" && brief.stats ? (
                <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {(
                    [
                      ["Lessons", brief.stats.lessons],
                      ["Assignments", brief.stats.assignments],
                      ["Videos", brief.stats.videosCompleted],
                      ["Quests", brief.stats.missions],
                      ["Quizzes", brief.stats.quizzes],
                      ["Community", brief.stats.communityPosts],
                    ] as const
                  ).map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-2xl bg-[var(--surface-alt)] px-2 py-2 text-center"
                    >
                      <p className="text-base font-black tabular-nums text-[var(--foreground)]">{value}</p>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                        {label}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}

              {brief.suggestions && brief.suggestions.length > 0 ? (
                <div className="mt-4 space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
                    Suggested next
                  </p>
                  {brief.suggestions.slice(0, 3).map((item) => (
                    <Link
                      key={item.href + item.label}
                      href={item.href}
                      className="flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-sm transition hover:border-[var(--accent)]/40 hover:bg-[var(--accent-soft)]"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="font-semibold text-[var(--foreground)]">{item.label}</span>
                        <span className="mt-0.5 block text-xs text-[var(--muted)]">{item.blurb}</span>
                      </span>
                      <ArrowRightIcon className="h-4 w-4 shrink-0 text-[var(--accent)]" />
                    </Link>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-[var(--muted)]">Putting today together…</p>
          )}
        </div>
      </div>
    </div>
  );
}
