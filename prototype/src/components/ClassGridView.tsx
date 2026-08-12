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
  parseDayKey,
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

/**
 * Postponed is PINK and cancelled is RED, deliberately not the same colour.
 * "Come on a different day" and "do not come" are different instructions, and
 * a student scanning a month of small boxes has only the colour to go on.
 * Neither is struck through — a postponed class still happens.
 */
/**
 * Green means "you were there", and nothing else.
 *
 * It used to mean "this date has passed", which is how a student who joined
 * yesterday opened their calendar to a wall of green. The three states below it
 * are the ones that were missing:
 *
 *   before  the class ran before they enrolled. Faded to almost nothing — it is
 *           context for the month, not something they failed to attend.
 *   held    it happened and nobody marked the register. Neutral on purpose:
 *           colouring it green flatters, colouring it red accuses, and the
 *           truth is that the school does not know.
 *   missed  they were marked absent. This is the only state that should ever
 *           look like bad news, and now it is earned rather than assumed.
 */
const STATE_STYLE: Record<string, string> = {
  done: "bg-emerald-500 text-white border-emerald-600",
  missed: "bg-rose-100 text-rose-700 border-rose-300",
  held: "bg-[var(--surface-alt)] text-[var(--foreground)] border-[var(--border-strong)]",
  before: "bg-transparent text-[var(--muted)]/50 border-transparent",
  today: "bg-amber-400 text-white border-amber-500 ring-4 ring-amber-200",
  locked: "bg-[var(--border)] text-[var(--muted)] border-[var(--border-strong)]",
  postponed: "bg-pink-200 text-pink-800 border-pink-400",
  cancelled: "bg-red-100 text-red-600 border-red-300 line-through",
};

/** Parse the month label the API sends ("August 2026") back into a real date. */
function monthStart(label: string): Date | null {
  const [name, year] = label.split(" ");
  const index = MONTH_NAMES.indexOf(name);
  if (index === -1 || !year) return null;
  return new Date(Number(year), index, 1);
}

/**
 * Which edge the popover hangs from.
 *
 * It is 224px wide and a day cell on a phone is about 40px. Centred on the
 * cell — which is what it used to do unconditionally — it hung 90px off the
 * side of the card for any class falling on a Sunday or a Saturday, which on a
 * Mon/Wed/Fri timetable is most of them. So the near-edge columns anchor to
 * their own edge instead of to their centre, and the arrow moves to match.
 */
function anchorFor(col: number): { box: string; arrow: string } {
  if (col <= 1) return { box: "left-0", arrow: "left-5" };
  if (col >= 5) return { box: "right-0", arrow: "right-5" };
  return { box: "left-1/2 -translate-x-1/2", arrow: "left-1/2 -translate-x-1/2" };
}

function DayPopover({ node, below, col }: { node: ClassNode; below: boolean; col: number }) {
  const s = nodeSummary(node);
  const anchor = anchorFor(col);
  return (
    <motion.div
      initial={{ opacity: 0, y: below ? -6 : 6, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: below ? -6 : 6, scale: 0.96 }}
      transition={{ duration: 0.14 }}
      // Opens downward for cells in the top row, otherwise upward — a popover
      // above a first-row cell is clipped off the top of the card.
      className={`absolute z-30 w-56 max-w-[calc(100vw-3rem)] rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left shadow-xl ${anchor.box} ${
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

      {s.status === "postponed" ? (
        <div className="mt-2 rounded-lg bg-pink-100 px-2 py-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-pink-800">Postponed</p>
          {/* The new date is the whole message. A student told only that
              their class moved still has to ring the office to ask when to. */}
          <p className="mt-0.5 text-[11px] font-semibold text-pink-900">
            {s.postponedTo
              ? `Now on ${shortDate(parseDayKey(s.postponedTo))}`
              : "Your tutor will confirm the new date"}
          </p>
        </div>
      ) : s.status === "cancelled" ? (
        <p className="mt-2 rounded-lg bg-red-100 px-2 py-1 text-[10px] font-bold uppercase text-red-700">
          Cancelled — this class is not running
        </p>
      ) : s.topic ? (
        <p className="mt-2 text-xs leading-5 text-[var(--foreground)]">{s.topic}</p>
      ) : (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-[var(--muted)]">
          <LockIcon className="h-3.5 w-3.5" /> Topic unlocks on {s.lockedUntil}
        </p>
      )}

      {s.notes && (
        <p className="mt-2 rounded-lg bg-[var(--surface-alt)] px-2 py-1 text-[11px] leading-4 text-[var(--foreground-soft)]">
          {s.notes}
        </p>
      )}

      {s.tutor && <p className="mt-2 text-[11px] text-[var(--muted)]">with {s.tutor}</p>}

      {/* materialAlways, not material: a postponed class keeps its handout. */}
      {s.materialAlways && (
        <div className="mt-2">
          <a
            href={s.materialAlways.filePath}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-soft)] px-2 py-1 text-[11px] font-bold text-[var(--accent)]"
          >
            <AttachmentIcon className="h-3 w-3" /> {s.materialAlways.title}
          </a>

          {/*
            The two-sentence summary, generated after upload.

            This is the whole point of generating it. A student looking at a
            filename has no way to judge whether a 14-page PDF is worth
            opening on their data plan, so the safe choice is not to. Two
            sentences turns that decision from a gamble into a glance.
          */}
          {s.materialAlways.aiSummary && (
            <p className="mt-1.5 rounded-lg bg-[var(--surface-alt)] px-2 py-1.5 text-[11px] leading-4 text-[var(--foreground-soft)]">
              {s.materialAlways.aiSummary}
            </p>
          )}

          {/* Quests are the smaller ask underneath the material — five minutes
              rather than fourteen pages. Named as a count so it reads as an
              amount of work, not as another document. */}
          {Boolean(s.materialAlways.aiQuestCount) && (
            <p className="mt-1 text-[11px] font-semibold text-[var(--accent)]">
              {s.materialAlways.aiQuestCount} quick quest
              {s.materialAlways.aiQuestCount === 1 ? "" : "s"} from this — about 5 minutes each
            </p>
          )}
        </div>
      )}

      {/* Arrow pointing back at the day cell, on whichever side it opened. */}
      <span
        className={`absolute h-3 w-3 rotate-45 bg-[var(--surface)] ${anchor.arrow} ${
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
          <div key={month.label} className="rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)] p-3 sm:rounded-[28px] sm:p-6">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 className="text-lg font-extrabold sm:text-xl">{month.label}</h3>
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
                const col = (leadingBlanks + i) % 7;

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
                      {showing && <DayPopover node={node} below={inTopRow} col={col} />}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3 text-[11px] font-semibold text-[var(--muted)]">
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-emerald-500" /> Held</span>
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-amber-400" /> Today</span>
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-slate-300" /> Locked</span>
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-pink-300" /> Postponed</span>
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-red-200" /> Cancelled</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
