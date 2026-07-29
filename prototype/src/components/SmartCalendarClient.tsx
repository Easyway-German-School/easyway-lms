"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * The class calendar, as a game map.
 *
 * A winding path of class nodes rather than a list. Classes already held are
 * complete and open; the very next class is LOCKED — you can see it is there
 * and when it unlocks, but not what is in it. That is the whole point: the
 * next step is a sealed door, not a spoiler.
 *
 * Unlock rule: a class opens at the start of its own day. So today's class is
 * readable, tomorrow's is a padlock with a countdown.
 */

type Material = { id: string; title: string; filePath: string; fileType: string };

type Session = {
  date: string;
  weekday: string;
  title: string;
  defaultFocus: string;
  timeSlot: string;
  startTime: string;
  endTime: string;
  topic: string | null;
  notes: string | null;
  status: string;
  postponedTo: string | null;
  lecturerName: string | null;
  material: Material | null;
};

type Month = { label: string; patternLabel: string; sessions: Session[] };

type Payload = {
  level: string;
  months: Month[];
  currentLevel?: string;
  nextLevel?: string | null;
  viewingNextLevel?: boolean;
};

type NodeState = "done" | "today" | "locked" | "off";

type MapNode = Session & {
  index: number;
  state: NodeState;
  isNext: boolean;
};

const SLOT_LABEL: Record<string, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Dates are formatted explicitly rather than with toLocaleDateString, whose
 * output depends on the runtime's locale — the server and the browser can
 * disagree ("Friday, July 31" vs "Friday 31 July") and React then discards the
 * whole tree as a hydration mismatch.
 */
function longDate(d: Date) {
  return `${WEEKDAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}
function shortDate(d: Date) {
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}

/** The path's horizontal sway, in pixels, cycling as it descends. */
const LEAN = [0, 38, 54, 38, 0, -38, -54, -38];

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysBetween(a: Date, b: Date) {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86_400_000);
}

/** Icons kept inline so the path has no image dependencies. */
function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}
function LockIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor">
      <path d="m12 2.6 2.9 5.9 6.5.95-4.7 4.6 1.1 6.45L12 17.45 6.2 20.5l1.1-6.45-4.7-4.6 6.5-.95z" />
    </svg>
  );
}
function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
      <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12z" />
    </svg>
  );
}

export default function SmartCalendarClient() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [previewLevel, setPreviewLevel] = useState<string | null>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [shake, setShake] = useState<number | null>(null);
  // Which node is "today" depends on the reader's clock, so the map is built
  // after mount only. Rendering it on the server would bake in the server's
  // idea of today and mismatch on hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const load = useCallback(async (level?: string | null) => {
    setLoading(true);
    try {
      const url = level ? `/api/schedule?level=${encodeURIComponent(level)}` : "/api/schedule";
      const res = await fetch(url, { cache: "no-store", credentials: "include" });
      if (!res.ok) throw new Error("Unable to load your schedule");
      setData(await res.json());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(previewLevel); }, [load, previewLevel]);

  /** Flatten the months into one ordered path and work out each node's state. */
  const { nodes, done, total, nextNode } = useMemo(() => {
    const now = new Date();
    const flat: Session[] = (data?.months ?? []).flatMap((m) => m.sessions);

    let firstFuture = -1;
    const built: MapNode[] = flat.map((s, index) => {
      const date = new Date(s.date);
      const off = s.status === "postponed" || s.status === "cancelled";
      const isPast = startOfDay(date) < startOfDay(now);
      const isToday = daysBetween(date, now) === 0;

      if (!off && !isPast && !isToday && firstFuture === -1) firstFuture = index;

      const state: NodeState = off ? "off" : isPast ? "done" : isToday ? "today" : "locked";
      return { ...s, index, state, isNext: false };
    });

    if (firstFuture >= 0) built[firstFuture].isNext = true;

    return {
      nodes: built,
      done: built.filter((n) => n.state === "done").length,
      total: built.length,
      nextNode: firstFuture >= 0 ? built[firstFuture] : null,
    };
  }, [data]);

  function tapNode(node: MapNode) {
    if (node.state === "locked") {
      // Locked nodes push back rather than silently doing nothing.
      setShake(node.index);
      setTimeout(() => setShake((s) => (s === node.index ? null : s)), 500);
      return;
    }
    setOpenIndex(openIndex === node.index ? null : node.index);
  }

  if (loading || !mounted) {
    return (
      <div className="rounded-[28px] border border-[var(--border)] bg-[var(--surface-alt)] p-8 text-center">
        <p className="text-sm text-[var(--muted)]">Loading your path…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-[28px] border border-[var(--border)] bg-[var(--surface-alt)] p-6">
        <p className="text-sm text-red-600">{error || "No schedule available."}</p>
      </div>
    );
  }

  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* ---- Player bar -------------------------------------------------- */}
      <div className="overflow-hidden rounded-[28px] bg-gradient-to-br from-[var(--accent-strong)] via-[var(--accent)] to-[#FF9A4D] p-6 text-white shadow-lg">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-white/80">
              {data.currentLevel ?? data.level} journey
            </p>
            <p className="mt-1 text-3xl font-extrabold">
              {done} <span className="text-xl font-bold text-white/70">/ {total} classes</span>
            </p>
          </div>

          <div className="flex items-center gap-2 rounded-2xl bg-white/15 px-4 py-2 backdrop-blur">
            <BoltIcon />
            <span className="text-lg font-extrabold">{percent}%</span>
          </div>
        </div>

        <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-white/25">
          <motion.div
            className="h-full rounded-full bg-white"
            initial={{ width: 0 }}
            animate={{ width: `${percent}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          />
        </div>

        {nextNode && (
          <p className="mt-3 text-sm text-white/90">
            Next up · {longDate(new Date(nextNode.date))}
            {" · "}
            {daysBetween(new Date(nextNode.date), new Date()) === 1
              ? "tomorrow"
              : `in ${daysBetween(new Date(nextNode.date), new Date())} days`}
          </p>
        )}
      </div>

      {/* ---- Level switch ------------------------------------------------ */}
      {data.nextLevel && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => { setPreviewLevel(null); setOpenIndex(null); }}
            className={`rounded-full px-4 py-2 text-sm font-bold transition ${
              !data.viewingNextLevel ? "bg-[var(--accent)] text-white" : "border border-[var(--border)] hover:bg-[var(--surface-alt)]"
            }`}
          >
            {data.currentLevel} · current
          </button>
          <button
            onClick={() => { setPreviewLevel(data.nextLevel!); setOpenIndex(null); }}
            className={`rounded-full px-4 py-2 text-sm font-bold transition ${
              data.viewingNextLevel ? "bg-[var(--accent)] text-white" : "border border-[var(--border)] hover:bg-[var(--surface-alt)]"
            }`}
          >
            🔮 {data.nextLevel} · peek ahead
          </button>
        </div>
      )}

      {/* ---- The path ---------------------------------------------------- */}
      {data.months.map((month) => {
        const monthNodes = nodes.filter((n) =>
          month.sessions.some((s) => s.date === n.date),
        );
        if (monthNodes.length === 0) return null;

        return (
          <div key={month.label} className="rounded-[28px] border border-[var(--border)] bg-[var(--surface-alt)] p-6">
            <div className="mb-6 flex items-baseline justify-between gap-3">
              <h3 className="text-xl font-extrabold">{month.label}</h3>
              <span className="text-xs font-semibold text-[var(--muted)]">{month.patternLabel}</span>
            </div>

            <div className="relative pt-4">
              {monthNodes.map((node, i) => {
                // Gentle S-curve: the path leans left and right as it descends.
                const lean = LEAN[i % LEAN.length];
                const prevLean = i > 0 ? LEAN[(i - 1) % LEAN.length] : lean;
                const date = new Date(node.date);
                const open = openIndex === node.index;

                return (
                  <div key={node.date} className="relative flex flex-col items-center">
                    {/* Stepping stones between nodes, tracking the sway so the
                        path stays visually connected as it leans. */}
                    {i > 0 && (
                      <div className="flex h-8 flex-col items-center justify-center gap-1.5">
                        {[0.25, 0.5, 0.75].map((t) => (
                          <span
                            key={t}
                            style={{ marginLeft: prevLean + (lean - prevLean) * t }}
                            className="h-1.5 w-1.5 rounded-full bg-[var(--border)]"
                          />
                        ))}
                      </div>
                    )}

                    <motion.button
                      onClick={() => tapNode(node)}
                      style={{ marginLeft: lean }}
                      animate={
                        shake === node.index
                          ? { x: [0, -8, 8, -6, 6, 0] }
                          : node.isNext
                            ? { y: [0, -5, 0] }
                            : {}
                      }
                      transition={
                        shake === node.index
                          ? { duration: 0.45 }
                          : { duration: 1.8, repeat: Infinity, ease: "easeInOut" }
                      }
                      whileTap={{ scale: 0.92 }}
                      aria-label={`${node.weekday} ${shortDate(date)} — ${
                        node.state === "locked" ? "locked" : node.state === "off" ? node.status : "open"
                      }`}
                      className={`relative flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full border-[5px] shadow-lg transition ${
                        node.state === "done"
                          ? "border-emerald-600 bg-emerald-500 text-white"
                          : node.state === "today"
                            ? "border-amber-500 bg-amber-400 text-white"
                            : node.state === "off"
                              ? "border-red-300 bg-red-100 text-red-600"
                              : "border-slate-300 bg-slate-200 text-slate-500"
                      }`}
                    >
                      {node.state === "done" ? (
                        <CheckIcon />
                      ) : node.state === "today" ? (
                        <StarIcon />
                      ) : node.state === "off" ? (
                        <span className="text-2xl">✕</span>
                      ) : (
                        <LockIcon className="h-7 w-7" />
                      )}

                      {/* The next class gets the "sealed door" ribbon. */}
                      {node.isNext && (
                        <span className="absolute -top-8 whitespace-nowrap rounded-full bg-slate-900 px-3 py-1 text-[10px] font-extrabold uppercase tracking-wide text-white shadow-lg">
                          Up next
                        </span>
                      )}

                      <span className="absolute -bottom-6 whitespace-nowrap text-[11px] font-bold text-[var(--muted)]">
                        {node.weekday} {date.getDate()}
                      </span>
                    </motion.button>

                    <div className="h-8" />

                    <AnimatePresence>
                      {open && (
                        <motion.div
                          initial={{ opacity: 0, y: -8, height: 0 }}
                          animate={{ opacity: 1, y: 0, height: "auto" }}
                          exit={{ opacity: 0, y: -8, height: 0 }}
                          className="mb-4 w-full max-w-md overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm"
                        >
                          <p className="text-sm font-bold">
                            {node.topic || node.defaultFocus}
                          </p>
                          <p className="mt-1 text-xs text-[var(--muted)]">
                            {node.startTime}–{node.endTime} · {SLOT_LABEL[node.timeSlot] ?? node.timeSlot}
                            {node.lecturerName && ` · ${node.lecturerName}`}
                          </p>
                          {node.status === "postponed" && (
                            <p className="mt-2 rounded-lg bg-red-100 px-2 py-1 text-xs font-bold uppercase text-red-700">
                              Postponed
                              {node.postponedTo && ` — moved to ${shortDate(new Date(node.postponedTo))}`}
                            </p>
                          )}
                          {node.material && (
                            <a
                              href={node.material.filePath}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-soft)] px-2.5 py-1.5 text-xs font-bold text-[var(--accent)]"
                            >
                              📎 {node.material.title}
                            </a>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Locked taps explain themselves instead of doing nothing. */}
                    <AnimatePresence>
                      {shake === node.index && (
                        <motion.p
                          initial={{ opacity: 0, y: -6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          className="mb-4 rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-white"
                        >
                          🔒 Unlocks on {shortDate(date)}
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <p className="text-center text-xs text-[var(--muted)]">
        Each class unlocks on the day it runs — no peeking ahead.
      </p>
    </div>
  );
}
