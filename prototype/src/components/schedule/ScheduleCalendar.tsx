"use client";

import { useMemo } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import {
  addMonths,
  isSameMonth,
  monthGrid,
  monthLabel,
  WEEKDAY_LABELS,
  ymd,
} from "@/components/schedule/grid";

/**
 * The shared class-schedule calendar: a near-textless month grid on the left, a
 * caller-supplied detail rail on the right (stacked on mobile). Used by the
 * tutor timetable and the admin schedule. It knows nothing about cohorts,
 * private bookings or APIs — the caller hands it a `days` map and renders the
 * rail.
 *
 * The grid's whole job is "where is something happening, and roughly what" —
 * a row of up to four colour dots per day, nothing more. Everything you can act
 * on lives in the rail.
 */

export type Tone = "accent" | "pink" | "red" | "emerald" | "gold" | "slate";

/** Dot + text colours per tone, all theme tokens so light/dark just work. */
const DOT: Record<Tone, string> = {
  accent: "bg-[var(--accent)]",
  pink: "bg-pink-500 dark:bg-pink-400",
  red: "bg-red-500 dark:bg-red-400",
  emerald: "bg-emerald-500 dark:bg-emerald-400",
  gold: "bg-[#D4AF37]",
  slate: "bg-slate-400 dark:bg-slate-500",
};

export type DayCell = {
  dots: { tone: Tone; key: string }[];
  closed?: { label: string };
};

export type LegendItem = { tone: Tone; label: string };

type Props = {
  cursor: Date;
  onCursor: (next: Date) => void;
  days: Map<string, DayCell>;
  selected: string | null;
  onSelect: (day: string | null) => void;
  rail: React.ReactNode;
  legend?: LegendItem[];
  /** Optional slot between the legend and the grid — a cohort switcher, filters. */
  toolbar?: React.ReactNode;
};

export default function ScheduleCalendar({
  cursor,
  onCursor,
  days,
  selected,
  onSelect,
  rail,
  legend = [],
  toolbar,
}: Props) {
  const weeks = useMemo(() => monthGrid(cursor), [cursor]);
  const todayKey = ymd(new Date());

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      {/* ---- Left: month grid ---------------------------------------------- */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">{monthLabel(cursor)}</h2>
          <div className="flex gap-1">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => onCursor(addMonths(cursor, -1))}
              className="rounded-lg border border-[var(--border)] p-2 text-[var(--muted)] transition hover:bg-[var(--surface-alt)]"
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}
              className="rounded-lg border border-[var(--border)] px-3 text-sm font-medium text-[var(--foreground-soft)] transition hover:bg-[var(--surface-alt)]"
            >
              Today
            </button>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => onCursor(addMonths(cursor, 1))}
              className="rounded-lg border border-[var(--border)] p-2 text-[var(--muted)] transition hover:bg-[var(--surface-alt)]"
            >
              <ChevronRightIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        {legend.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
            {legend.map((item) => (
              <span key={item.label} className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)]">
                <span className={`h-2 w-2 rounded-full ${DOT[item.tone]}`} />
                {item.label}
              </span>
            ))}
          </div>
        )}

        {toolbar && <div className="mt-3">{toolbar}</div>}

        <div className="mt-3 overflow-hidden rounded-2xl border border-[var(--border)]">
          <div className="grid grid-cols-7 bg-[var(--surface-alt)] text-center text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            {WEEKDAY_LABELS.map((d) => (
              <div key={d} className="py-2">
                {d}
              </div>
            ))}
          </div>
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7">
              {week.map((day) => {
                const key = ymd(day);
                const cell = days.get(key);
                const inMonth = isSameMonth(day, cursor);
                const isToday = key === todayKey;
                const isSelected = key === selected;
                const dots = cell?.dots ?? [];
                return (
                  <button
                    type="button"
                    key={key}
                    onClick={() => onSelect(isSelected ? null : key)}
                    aria-pressed={isSelected}
                    className={`relative min-h-[76px] border-b border-r border-[var(--border)] p-1.5 text-left align-top transition last:border-r-0 hover:bg-[var(--surface-alt)] ${
                      inMonth ? "" : "opacity-35"
                    } ${isSelected ? "ring-2 ring-inset ring-[var(--accent)]" : ""} ${
                      cell?.closed ? "bg-[repeating-linear-gradient(135deg,var(--surface-alt)_0_6px,transparent_6px_12px)]" : ""
                    }`}
                  >
                    <span
                      className={`inline-grid h-6 w-6 place-items-center rounded-full text-xs font-semibold ${
                        isToday ? "bg-[var(--accent)] text-white" : "text-[var(--foreground-soft)]"
                      }`}
                    >
                      {day.getDate()}
                    </span>

                    {cell?.closed ? (
                      <p className="mt-1 truncate text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                        {cell.closed.label}
                      </p>
                    ) : dots.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        {dots.slice(0, 4).map((dot) => (
                          <span key={dot.key} className={`h-2 w-2 rounded-full ${DOT[dot.tone]}`} />
                        ))}
                        {dots.length > 4 && (
                          <span className="text-[10px] font-semibold text-[var(--muted)]">+{dots.length - 4}</span>
                        )}
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* ---- Right: caller's detail rail --------------------------------- */}
      <div className="min-w-0">{rail}</div>
    </div>
  );
}
