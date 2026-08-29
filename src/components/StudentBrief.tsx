"use client";

import { useEffect, useState } from "react";
import Mascot from "@/components/Mascot";

/**
 * Becca's brief. One host, three periods — see src/lib/student-brief.ts for
 * why the numbers are queried rather than generated, and project-mascot.md
 * for why she gets one consistent "presenting" pose here regardless of
 * whether the news is good: she's reporting the numbers, not reacting to
 * them, the same way a news anchor doesn't change costume for a bad headline.
 */

type Period = "daily" | "weekly" | "monthly";

const TABS: { key: Period; label: string }[] = [
  { key: "daily", label: "Today" },
  { key: "weekly", label: "This week" },
  { key: "monthly", label: "This month" },
];

type Brief = { headline: string; lines: string[]; personalNote: string | null };

export default function StudentBrief() {
  const [period, setPeriod] = useState<Period>("daily");
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    (async () => {
      try {
        const res = await fetch(`/api/student/brief?period=${period}`, { cache: "no-store" });
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
        <p className="text-sm uppercase tracking-[0.3em] text-[var(--muted)]">Your brief</p>
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
              {/* Becca's own line — the one part of this card an AI actually
                  wrote, framed around facts it was handed rather than facts
                  it guessed. See personalLine() in student-brief.ts. */}
              {brief.personalNote ? (
                <p className="mt-3 text-sm italic text-[var(--accent)]">&ldquo;{brief.personalNote}&rdquo;</p>
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
