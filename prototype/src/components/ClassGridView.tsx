"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AttachmentIcon, LockIcon } from "@/components/icons";
import {
  type ClassNode,
  type Month,
  MONTH_NAMES,
  WEEKDAY_INITIALS,
  nodeSummary,
  shortDate,
} from "@/lib/class-path";

/**
 * The month-grid rendering of the schedule: boxes for every day, with class
 * days highlighted.
 *
 * Same data and the same lock rule as the path map — this is a different way
 * of looking at the term, not a different term. Hovering or tapping a class
 * day opens a popover with the exact time; the topic stays sealed until the
 * day itself, exactly as it does on the map.
 */

const STATE_STYLE: Record<string, string> = {
  done: "bg-emerald-500 text-white border-emerald-600",
  today: "bg-amber-400 text-white border-amber-500 ring-4 ring-amber-200",
  locked: "bg-[var(--border)] text-[var(--muted)] border-[var(--border-strong)]",
  off: "bg-red-100 text-red-600 border-red-300 line-through",
};

/** Parse the month label the API sends ("August 2026") back into a real date. */
function monthStart(label: string): Date | null {
  const [name, year] = label.split(" ");
  const index = MONTH_NAMES.indexOf(name);
  if (index === -1 || !year) return null;
  return new Date(Number(year), index, 1);
}

function DayPopover({ node, below }: { node: ClassNode; below: boolean }) {
  const s = nodeSummary(node);
  return (
    <motion.div
      initial={{ opacity: 0, y: below ? -6 : 6, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: below ? -6 : 6, scale: 0.96 }}
      transition={{ duration: 0.14 }}
      // Opens downward for cells in the top row, otherwise upward — a popover
      // above a first-row cell is clipped off the top of the card.
      className={`absolute left-1/2 z-30 w-56 -translate-x-1/2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left shadow-xl ${
        below ? "top-full mt-2" : "bottom-full mb-2"
      }`}
      role="tooltip"
    >
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
        {node.weekday} {shortDate(new Date(node.date))}
      </p>

      <p className="mt-1 text-sm font-extrabold text-[var(--foreground)]">
        {s.when}
      </p>
      <p className="text-[11px] text-[var(--muted)]">{s.slot} session</p>

      {s.status === "postponed" || s.status === "cancelled" ? (
        <p className="mt-2 rounded-lg bg-red-100 px-2 py-1 text-[10px] font-bold uppercase text-red-700">
          {s.status}
          {s.postponedTo && ` — moved to ${shortDate(new Date(s.postponedTo))}`}
        </p>
      ) : s.topic ? (
        <p className="mt-2 text-xs leading-5 text-[var(--foreground)]">{s.topic}</p>
      ) : (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-[var(--muted)]">
          <LockIcon className="h-3.5 w-3.5" /> Topic unlocks on {s.lockedUntil}
        </p>
      )}

      {s.tutor && <p className="mt-2 text-[11px] text-[var(--muted)]">with {s.tutor}</p>}

      {s.material && (
        <a
          href={s.material.filePath}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-soft)] px-2 py-1 text-[11px] font-bold text-[var(--accent)]"
        >
          <AttachmentIcon className="h-3 w-3" /> {s.material.title}
        </a>
      )}

      {/* Arrow pointing back at the day cell, on whichever side it opened. */}
      <span
        className={`absolute left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 bg-[var(--surface)] ${
          below
            ? "bottom-full translate-y-1/2 border-l border-t border-[var(--border)]"
            : "top-full -translate-y-1/2 border-b border-r border-[var(--border)]"
        }`}
      />
    </motion.div>
  );
}

export default function ClassGridView({ months, nodes }: { months: Month[]; nodes: ClassNode[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  // Index classes by calendar day so a grid cell can find its class in O(1).
  const byDay = new Map<string, ClassNode>();
  for (const node of nodes) {
    const d = new Date(node.date);
    byDay.set(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`, node);
  }

  return (
    <div className="space-y-6">
      {months.map((month) => {
        const start = monthStart(month.label);
        if (!start) return null;

        const year = start.getFullYear();
        const monthIndex = start.getMonth();
        const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
        // Blank cells so the 1st lands under its real weekday.
        const leadingBlanks = start.getDay();

        return (
          <div key={month.label} className="rounded-[28px] border border-[var(--border)] bg-[var(--surface-alt)] p-5 sm:p-6">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <h3 className="text-xl font-extrabold">{month.label}</h3>
              <span className="text-xs font-semibold text-[var(--muted)]">{month.patternLabel}</span>
            </div>

            <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
              {WEEKDAY_INITIALS.map((initial, i) => (
                <div key={i} className="pb-1 text-center text-[11px] font-bold uppercase text-[var(--muted)]">
                  {initial}
                </div>
              ))}

              {Array.from({ length: leadingBlanks }).map((_, i) => (
                <div key={`blank-${i}`} />
              ))}

              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const key = `${year}-${monthIndex}-${day}`;
                const node = byDay.get(key);
                const showing = openKey === key || hoverKey === key;
                // Row 0 has no space above it inside the card.
                const inTopRow = Math.floor((leadingBlanks + i) / 7) === 0;

                if (!node) {
                  return (
                    <div
                      key={key}
                      className="flex aspect-square items-center justify-center rounded-xl text-sm text-[var(--muted)]/60"
                    >
                      {day}
                    </div>
                  );
                }

                return (
                  <div key={key} className="relative">
                    <button
                      onClick={() => setOpenKey(openKey === key ? null : key)}
                      onMouseEnter={() => setHoverKey(key)}
                      onMouseLeave={() => setHoverKey((k) => (k === key ? null : k))}
                      onFocus={() => setHoverKey(key)}
                      onBlur={() => setHoverKey((k) => (k === key ? null : k))}
                      aria-label={`${node.weekday} ${shortDate(new Date(node.date))}, ${node.startTime} to ${node.endTime}${
                        node.state === "locked" ? ", topic locked" : ""
                      }`}
                      className={`relative flex aspect-square w-full items-center justify-center rounded-xl border-2 text-sm font-extrabold shadow-sm transition hover:scale-105 ${
                        STATE_STYLE[node.state] ?? STATE_STYLE.locked
                      }`}
                    >
                      {day}
                      {node.isNext && (
                        <span className="absolute -right-1 -top-1 h-3 w-3 animate-pulse rounded-full bg-slate-900 ring-2 ring-white" />
                      )}
                    </button>

                    <AnimatePresence>
                      {showing && <DayPopover node={node} below={inTopRow} />}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3 text-[11px] font-semibold text-[var(--muted)]">
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-emerald-500" /> Held</span>
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-amber-400" /> Today</span>
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-slate-300" /> Locked</span>
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-red-200" /> Postponed</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
