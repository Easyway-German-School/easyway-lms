"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import BrandLoader from "@/components/BrandLoader";
import ClassGridView from "@/components/ClassGridView";
import JourneyMap, { JourneyLockScreen, LockedRegionTeaser } from "@/components/JourneyMap";
import { CalendarIcon, MapIcon, SparklesIcon } from "@/components/icons";
import {
  type ClassNode,
  type SchedulePayload,
  buildNodes,
  daysBetween,
  longDate,
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
      <div className="rounded-[28px] border border-[var(--border)] bg-[var(--surface-alt)] p-8">
        <BrandLoader title="Deine Reise wird gezeichnet…" message="Drawing your journey map" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-[28px] border border-[var(--border)] bg-[var(--surface-alt)] p-6">
        <p className="text-sm text-[var(--danger)]">{error || "No schedule available."}</p>
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
            // White, not a theme surface: this bar sits on the brand gradient
            // hero, where the copy around it is white too.
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
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition ${
              view === "path" ? "bg-[var(--accent)] text-white shadow" : "text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            <MapIcon /> Journey map
          </button>
          <button
            onClick={() => chooseView("calendar")}
            aria-pressed={view === "calendar"}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition ${
              view === "calendar" ? "bg-[var(--accent)] text-white shadow" : "text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            <CalendarIcon /> Calendar
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
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition ${
                data.viewingNextLevel ? "bg-slate-900 text-white" : "border border-[var(--border)] hover:bg-[var(--surface-alt)]"
              }`}
            >
              <SparklesIcon /> {data.nextLevel} · peek ahead
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
            <div className="relative">
              {/* Peeking at the next level draws its real map and then seals
                  it. The blur sits on a wrapper rather than on the map itself,
                  so the lock screen above it stays sharp. */}
              <div
                className={
                  data.viewingNextLevel ? "pointer-events-none select-none blur-[6px] saturate-[0.6]" : undefined
                }
                aria-hidden={data.viewingNextLevel || undefined}
              >
                <JourneyMap
                  months={data.months}
                  nodes={nodes}
                  openIndex={openIndex}
                  shake={shake}
                  onTap={tapNode}
                />
              </div>

              {data.viewingNextLevel ? (
                <JourneyLockScreen
                  level={data.level}
                  currentLevel={data.currentLevel ?? ""}
                  classCount={total}
                  onBack={() => {
                    setPreviewLevel(null);
                    setOpenIndex(null);
                  }}
                />
              ) : data.nextLevel ? (
                <LockedRegionTeaser
                  nextLevel={data.nextLevel}
                  currentLevel={data.currentLevel ?? data.level}
                  onPeek={() => {
                    setPreviewLevel(data.nextLevel!);
                    setOpenIndex(null);
                  }}
                />
              ) : null}
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
