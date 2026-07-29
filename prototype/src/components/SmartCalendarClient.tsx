"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ClassGridView from "@/components/ClassGridView";
import {
  type ClassNode,
  type SchedulePayload,
  buildNodes,
  daysBetween,
  longDate,
  nodeSummary,
  shortDate,
  SLOT_LABEL,
} from "@/lib/class-path";

/**
 * The student's class schedule, in whichever shape they prefer.
 *
 *   path      a Duolingo-style winding map of class nodes
 *   calendar  a month grid with class days highlighted
 *
 * Both read the same data and obey the same rule: a class unlocks at the start
 * of its own day, so the very next class is a sealed door. The exact TIME is
 * always visible — a student must be able to plan around when they are
 * expected — it is the topic that stays behind the lock.
 *
 * This view is read-only by design. Only lecturers and admins set what a class
 * contains, at /lecturer/timetable; students choose how to look at it, nothing
 * more.
 */

const VIEW_KEY = "easyway:schedule-view";
type View = "path" | "calendar";

/** The path's horizontal sway, in pixels, cycling as it descends. */
const LEAN = [0, 38, 54, 38, 0, -38, -54, -38];

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
  const [data, setData] = useState<SchedulePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [previewLevel, setPreviewLevel] = useState<string | null>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [shake, setShake] = useState<number | null>(null);
  const [view, setView] = useState<View>("path");

  // Which class counts as "today" depends on the reader's clock, so the map is
  // built after mount only. Rendering it on the server would bake in the
  // server's idea of today and mismatch on hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    // Their chosen view sticks between visits.
    const saved = window.localStorage.getItem(VIEW_KEY);
    if (saved === "path" || saved === "calendar") setView(saved);
  }, []);

  function chooseView(next: View) {
    setView(next);
    setOpenIndex(null);
    window.localStorage.setItem(VIEW_KEY, next);
  }

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

  const { nodes, done, total, nextNode } = useMemo(() => buildNodes(data?.months), [data]);

  function tapNode(node: ClassNode) {
    if (node.state === "locked") {
      // A locked door that pushes back reads as a rule; one that ignores you
      // reads as a bug. Shake, then show when it opens.
      setShake(node.index);
      setOpenIndex(node.index);
      setTimeout(() => setShake((s) => (s === node.index ? null : s)), 500);
      return;
    }
    setOpenIndex(openIndex === node.index ? null : node.index);
  }

  if (loading || !mounted) {
    return (
      <div className="rounded-[28px] border border-[var(--border)] bg-[var(--surface-alt)] p-8 text-center">
        <p className="text-sm text-[var(--muted)]">Loading your schedule…</p>
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
      {/* ---- Progress header --------------------------------------------- */}
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
            Next up · {longDate(new Date(nextNode.date))} · {nextNode.startTime}–{nextNode.endTime}
            {" · "}
            {daysBetween(new Date(nextNode.date), new Date()) === 1
              ? "tomorrow"
              : `in ${daysBetween(new Date(nextNode.date), new Date())} days`}
          </p>
        )}
      </div>

      {/* ---- Controls ----------------------------------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* View switch — the only thing on this page a student can change. */}
        <div className="inline-flex rounded-full border border-[var(--border)] bg-[var(--surface)] p-1">
          <button
            onClick={() => chooseView("path")}
            aria-pressed={view === "path"}
            className={`rounded-full px-4 py-2 text-sm font-bold transition ${
              view === "path" ? "bg-[var(--accent)] text-white shadow" : "text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            🗺️ Journey map
          </button>
          <button
            onClick={() => chooseView("calendar")}
            aria-pressed={view === "calendar"}
            className={`rounded-full px-4 py-2 text-sm font-bold transition ${
              view === "calendar" ? "bg-[var(--accent)] text-white shadow" : "text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            🗓️ Calendar
          </button>
        </div>

        {data.nextLevel && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => { setPreviewLevel(null); setOpenIndex(null); }}
              className={`rounded-full px-4 py-2 text-sm font-bold transition ${
                !data.viewingNextLevel ? "bg-slate-900 text-white" : "border border-[var(--border)] hover:bg-[var(--surface-alt)]"
              }`}
            >
              {data.currentLevel} · current
            </button>
            <button
              onClick={() => { setPreviewLevel(data.nextLevel!); setOpenIndex(null); }}
              className={`rounded-full px-4 py-2 text-sm font-bold transition ${
                data.viewingNextLevel ? "bg-slate-900 text-white" : "border border-[var(--border)] hover:bg-[var(--surface-alt)]"
              }`}
            >
              🔮 {data.nextLevel} · peek ahead
            </button>
          </div>
        )}
      </div>

      {/* ---- The schedule ------------------------------------------------- */}
      <AnimatePresence mode="wait">
        <motion.div
          key={view}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {view === "calendar" ? (
            <ClassGridView months={data.months} nodes={nodes} />
          ) : (
            <div className="space-y-6">
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
                        const lean = LEAN[i % LEAN.length];
                        const prevLean = i > 0 ? LEAN[(i - 1) % LEAN.length] : lean;
                        const date = new Date(node.date);
                        const open = openIndex === node.index;
                        const summary = nodeSummary(node);

                        return (
                          <div key={node.date} className="relative flex flex-col items-center">
                            {/* Stepping stones between nodes, tracking the sway
                                so the path stays visually connected. */}
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
                              aria-label={`${node.weekday} ${shortDate(date)}, ${node.startTime} to ${node.endTime}${
                                node.state === "locked" ? ", topic locked" : ""
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
                                  {/* The time is shown whatever the state —
                                      only the topic is withheld. */}
                                  <p className="text-sm font-extrabold">
                                    {summary.when}
                                    <span className="ml-2 text-xs font-semibold text-[var(--muted)]">
                                      {summary.slot} session
                                    </span>
                                  </p>

                                  {summary.topic ? (
                                    <p className="mt-1.5 text-sm">{summary.topic}</p>
                                  ) : (
                                    <p className="mt-1.5 text-sm font-semibold text-slate-500">
                                      🔒 Topic unlocks on {summary.lockedUntil}
                                    </p>
                                  )}

                                  {node.status === "postponed" && (
                                    <p className="mt-2 rounded-lg bg-red-100 px-2 py-1 text-xs font-bold uppercase text-red-700">
                                      Postponed
                                      {node.postponedTo && ` — moved to ${shortDate(new Date(node.postponedTo))}`}
                                    </p>
                                  )}

                                  {summary.tutor && (
                                    <p className="mt-2 text-xs text-[var(--muted)]">with {summary.tutor}</p>
                                  )}

                                  {summary.material && (
                                    <a
                                      href={summary.material.filePath}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-soft)] px-2.5 py-1.5 text-xs font-bold text-[var(--accent)]"
                                    >
                                      📎 {summary.material.title}
                                    </a>
                                  )}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <p className="text-center text-xs text-[var(--muted)]">
        Times are always visible · each class topic unlocks on the day it runs
      </p>
    </div>
  );
}
