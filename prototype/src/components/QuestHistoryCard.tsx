"use client";

import { motion } from "framer-motion";
import { TrendingDownIcon, TrendingUpIcon } from "@/components/icons";

type MissionHistory = {
  days: { day: string; total: number; done: number }[];
  categories: { detectType: string; label: string; total: number; done: number; rate: number }[];
  totalDone: number;
  totalMissions: number;
};

function dayKey(offsetFromToday: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offsetFromToday);
  return d.toISOString().slice(0, 10);
}

function shortWeekday(key: string): string {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "narrow", timeZone: "UTC" });
}

/**
 * "Review your results even after" — the quest board only ever shows today.
 * This reads back every DailyMission row the student has ever had (see
 * src/lib/mission-history-server.ts) and turns it into two things worth
 * looking at: a 14-day completion strip, and which kind of quest they
 * actually finish vs. which they tend to skip.
 */
export default function QuestHistoryCard({
  history,
  cardClass,
  eyebrowClass,
  headingClass,
  mutedClass,
}: {
  history: MissionHistory;
  cardClass: string;
  eyebrowClass: string;
  headingClass: string;
  mutedClass: string;
}) {
  const byDay = new Map(history.days.map((d) => [d.day, d]));
  const strip = Array.from({ length: 14 }, (_, i) => {
    const key = dayKey(13 - i);
    return byDay.get(key) ?? { day: key, total: 0, done: 0 };
  });

  const withData = history.categories.filter((c) => c.total > 0);
  const focusArea = withData[0];
  const strength = withData.length > 1 ? withData[withData.length - 1] : null;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className={cardClass}>
      <div>
        <p className={`text-sm uppercase tracking-[0.3em] ${eyebrowClass}`}>Your history</p>
        <h2 className={`mt-3 text-2xl font-semibold ${headingClass}`}>
          {history.totalDone} quest{history.totalDone === 1 ? "" : "s"} completed so far
        </h2>
      </div>

      <div className="mt-6 flex items-end justify-between gap-1.5">
        {strip.map((entry) => {
          const ratio = entry.total > 0 ? entry.done / entry.total : 0;
          const isToday = entry.day === dayKey(0);
          return (
            <div key={entry.day} className="flex flex-1 flex-col items-center gap-1.5">
              <div
                title={entry.total > 0 ? `${entry.done}/${entry.total} quests` : "No quests that day"}
                className={`h-8 w-full max-w-[18px] rounded-full ${
                  entry.total === 0
                    ? "bg-[var(--border)]"
                    : ratio === 1
                    ? "bg-[var(--success)]"
                    : ratio > 0
                    ? "bg-[var(--accent)]/50"
                    : "bg-[var(--border)]"
                } ${isToday ? "ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--surface)]" : ""}`}
              />
              <span className={`text-[10px] uppercase ${mutedClass}`}>{shortWeekday(entry.day)}</span>
            </div>
          );
        })}
      </div>

      {(focusArea || strength) && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {strength && (
            <div className="rounded-[20px] border border-[var(--success)]/25 bg-[var(--success-soft)]/40 p-4">
              <div className="flex items-center gap-2 text-[var(--success)]">
                <TrendingUpIcon className="h-4 w-4" />
                <p className="text-xs font-semibold uppercase tracking-[0.2em]">Strength</p>
              </div>
              <p className={`mt-2 font-semibold ${headingClass}`}>{strength.label}</p>
              <p className={`mt-1 text-sm ${mutedClass}`}>{strength.rate}% of these finished ({strength.done}/{strength.total})</p>
            </div>
          )}
          {focusArea && (
            <div className="rounded-[20px] border border-[var(--accent)]/20 bg-[var(--accent-soft)]/50 p-4">
              <div className="flex items-center gap-2 text-[var(--accent)]">
                <TrendingDownIcon className="h-4 w-4" />
                <p className="text-xs font-semibold uppercase tracking-[0.2em]">Focus area</p>
              </div>
              <p className={`mt-2 font-semibold ${headingClass}`}>{focusArea.label}</p>
              <p className={`mt-1 text-sm ${mutedClass}`}>{focusArea.rate}% of these finished ({focusArea.done}/{focusArea.total})</p>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
