"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

import Link from "next/link";

import { AttachmentIcon, CalendarIcon, CrossIcon, LockIcon, SparklesIcon } from "@/components/icons";
import {
  type ClassNode,
  type Month,
  nodeSummary,
  parseDayKey,
  shortDate,
} from "@/lib/class-path";

/**
 * The journey map: one region per month, classes as waypoints on a trail.
 *
 * This replaces a vertical stack of circles with `margin-left` nudges, which
 * described a path without ever drawing one. The map now has real geometry:
 *
 * - Waypoints are laid out boustrophedon — left to right, then right to left on
 *   the row below — which is how every game map from Candy Crush to Duolingo
 *   reads, because it keeps the next step adjacent to the last one instead of
 *   throwing the eye back across the screen.
 * - The trail is a genuine curve through those points (Catmull-Rom converted to
 *   cubic béziers), not a decoration behind them. Every waypoint sits ON the
 *   road because the road is generated from the waypoints.
 * - Each point gets a small deterministic wander, so the trail meanders like a
 *   route rather than snapping to a grid. Deterministic, not random: the same
 *   schedule has to draw the same map on the server and in the browser, and on
 *   every reload — a map that reshuffles itself is not a place.
 * - The road lights up exactly as far as the student has walked, using SVG's
 *   `pathLength="1"` so the lit fraction is a number between 0 and 1 rather
 *   than a pixel measurement nobody can maintain.
 *
 * The rules it obeys are the schedule's, not its own: a class unlocks on its
 * own day, the time is always visible, the topic is what the padlock withholds.
 * All of that lives in `lib/class-path.ts` and is only rendered here.
 */

/**
 * Map units. The SVG scales to the container; the HTML waypoints do not, and
 * that asymmetry is the whole reason the column count has to be responsive.
 *
 * A waypoint is a fixed 52px disc with a date plate under it and an "Up next"
 * pill over it — call it 52 × 96 real pixels that does NOT shrink with the
 * map. Four columns of it needs about 780px of container to breathe. On a
 * 375px phone the same four columns gave each waypoint an 82 × 68 cell, so
 * every disc overlapped its neighbour and every date plate overlapped the disc
 * beside it. That was the clutter — not the styling, the grid.
 *
 * So the map picks its columns from the width it was actually given, and the
 * geometry follows: fewer columns means a narrower viewBox and more rows,
 * which keeps a cell roughly square at every size instead of squashing it.
 */
const CELL_W = 250;
const CELL_H = 205;

/** Real pixels a single column needs before waypoints start touching. */
const MIN_COL_PX = 150;
const MAX_COLS = 4;

function colsForWidth(width: number): number {
  if (!width) return MAX_COLS;
  return Math.max(2, Math.min(MAX_COLS, Math.floor(width / MIN_COL_PX)));
}

type Point = { x: number; y: number };

function layoutPoints(count: number, cols: number): { points: Point[]; height: number } {
  const rows = Math.max(1, Math.ceil(count / cols));
  const points = Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / cols);
    const slot = i % cols;
    // Serpentine: even rows run left-to-right, odd rows come back.
    const col = row % 2 === 0 ? slot : cols - 1 - slot;
    return {
      x: col * CELL_W + CELL_W / 2 + Math.sin(i * 1.7) * 18,
      y: row * CELL_H + CELL_H / 2 + Math.cos(i * 2.3) * 13,
    };
  });
  return { points, height: rows * CELL_H };
}

/**
 * The container's width in real pixels, and the column count that fits in it.
 *
 * Measured rather than guessed from a media query: this map is rendered inside
 * a padded card inside a shell with a sidebar, so the viewport width is not the
 * map's width at any breakpoint, and the sidebar collapsing changes it without
 * the viewport changing at all.
 */
function useResponsiveCols(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [cols, setCols] = useState(MAX_COLS);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setCols(colsForWidth(node.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, cols];
}

/**
 * A smooth curve through every point, Catmull-Rom expressed as cubic béziers.
 * The endpoints are duplicated so the curve starts and ends at the first and
 * last waypoint instead of overshooting past them.
 */
function trailPath(points: Point[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    d += ` C ${p1.x + (p2.x - p0.x) / 6} ${p1.y + (p2.y - p0.y) / 6}, ${p2.x - (p3.x - p1.x) / 6} ${
      p2.y - (p3.y - p1.y) / 6
    }, ${p2.x} ${p2.y}`;
  }
  return d;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/* ------------------------------------------------------------------ icons */

function CheckGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}

function StarGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
      <path d="m12 2.6 2.9 5.9 6.5.95-4.7 4.6 1.1 6.45L12 17.45 6.2 20.5l1.1-6.45-4.7-4.6 6.5-.95z" />
    </svg>
  );
}

/** The terrain the trail is drawn on. Abstract on purpose — this is a school. */
function Terrain({ width, height, seed }: { width: number; height: number; seed: number }) {
  const hills = Array.from({ length: 5 }, (_, i) => ({
    cx: ((Math.sin(seed + i * 2.1) + 1) / 2) * width,
    cy: ((Math.cos(seed + i * 1.3) + 1) / 2) * height,
    r: 130 + Math.abs(Math.sin(seed + i)) * 120,
  }));

  return (
    <g aria-hidden>
      {hills.map((hill, i) => (
        <circle
          key={i}
          cx={hill.cx}
          cy={hill.cy}
          r={hill.r}
          fill={i % 2 === 0 ? "var(--accent-strong)" : "var(--accent)"}
          opacity={0.055}
        />
      ))}
    </g>
  );
}

/* ----------------------------------------------------------------- region */

function Region({
  month,
  monthNodes,
  index,
  cols,
  openIndex,
  shake,
  onTap,
  close,
}: {
  month: Month;
  monthNodes: ClassNode[];
  index: number;
  cols: number;
  openIndex: number | null;
  shake: number | null;
  onTap: (node: ClassNode) => void;
  close: () => void;
}) {
  const reduced = usePrefersReducedMotion();
  const uid = useId().replace(/:/g, "");
  // A short month must not stretch its few classes across the full width — a
  // region with three classes in it lays them out three-wide, not four-wide
  // with a gap where the fourth would be.
  const gridCols = Math.max(2, Math.min(cols, monthNodes.length));
  const viewW = gridCols * CELL_W;
  const { points, height } = layoutPoints(monthNodes.length, gridCols);
  const path = trailPath(points);

  const doneCount = monthNodes.filter((node) => node.state === "done").length;
  const percent = monthNodes.length ? Math.round((doneCount / monthNodes.length) * 100) : 0;

  // How far along this region's trail the student has actually walked. Points
  // are evenly spaced along the curve's control sequence, so the last completed
  // waypoint's index over the number of segments is the lit fraction.
  const segments = Math.max(1, monthNodes.length - 1);
  const walked = Math.min(1, Math.max(0, (doneCount - 1) / segments));

  const hereIndex = monthNodes.findIndex((node) => node.state === "today" || node.isNext);
  const here = hereIndex >= 0 ? points[hereIndex] : null;

  /**
   * The student's marker and the "Up next" pill both hang above the same
   * waypoint, and at the pill's height they sat on top of each other — the
   * marker covered the middle of the word. So the marker climbs above the pill
   * when there is one to climb over. Two numbers rather than a repositioning
   * scheme: only one node in a region can ever be `here`.
   */
  const hereHasPill = hereIndex >= 0 && monthNodes[hereIndex].isNext;
  const hereFloat = hereHasPill ? [-62, -70, -62] : [-34, -42, -34];

  const toPercent = (point: Point) => ({
    left: `${(point.x / viewW) * 100}%`,
    top: `${(point.y / height) * 100}%`,
  });

  return (
    <section className="overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--surface-alt)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[var(--accent-soft)] text-sm font-black text-[var(--accent)]">
            {index + 1}
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-base font-extrabold leading-tight sm:text-lg">{month.label}</h3>
            <p className="truncate text-xs font-semibold text-[var(--muted)]">{month.patternLabel}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="h-2 w-20 overflow-hidden rounded-full bg-[var(--border)] sm:w-28">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-[var(--accent-strong)] to-[var(--accent)]"
              initial={{ width: 0 }}
              animate={{ width: `${percent}%` }}
              transition={{ duration: 0.9, ease: "easeOut" }}
            />
          </div>
          <span className="text-xs font-black tabular-nums text-[var(--muted)]">
            {doneCount}/{monthNodes.length}
          </span>
        </div>
      </header>

      <div className="relative px-3 py-4 sm:px-5">
        <div className="relative w-full" style={{ aspectRatio: `${viewW} / ${height}` }}>
          <svg
            viewBox={`0 0 ${viewW} ${height}`}
            className="absolute inset-0 h-full w-full"
            aria-hidden
          >
            <defs>
              <linearGradient id={`trail-${uid}`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="var(--accent-strong)" />
                <stop offset="100%" stopColor="var(--accent)" />
              </linearGradient>
            </defs>

            <Terrain width={viewW} height={height} seed={index * 3.7} />

            {/* The road, in three passes: a wide casing, the dim surface ahead
                of the student, and the lit surface behind them. */}
            <path d={path} fill="none" stroke="var(--border)" strokeWidth="26" strokeLinecap="round" opacity="0.5" />
            <path
              d={path}
              fill="none"
              stroke="var(--muted)"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray="14 16"
              opacity="0.4"
            />
            <path
              id={`road-${uid}`}
              d={path}
              fill="none"
              stroke={`url(#trail-${uid})`}
              strokeWidth="9"
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray={`${walked} 1`}
            />

            {/* A light travelling the finished stretch — the map is alive even
                when nothing is being clicked. */}
            {!reduced && walked > 0 && (
              <circle r="6" fill="var(--accent)" opacity="0.9">
                <animateMotion dur="9s" repeatCount="indefinite" keyPoints={`0;${walked}`} keyTimes="0;1" calcMode="linear">
                  <mpath href={`#road-${uid}`} />
                </animateMotion>
              </circle>
            )}
          </svg>

          {/* Waypoints. HTML rather than SVG so they stay a comfortable tap
              target at any map width, and so focus and aria come for free. */}
          {monthNodes.map((node, i) => {
            const date = new Date(node.date);
            const state = node.state;
            const isOpen = openIndex === node.index;

            return (
              <motion.button
                key={node.date}
                onClick={() => onTap(node)}
                style={{ ...toPercent(points[i]), position: "absolute", transform: "translate(-50%, -50%)" }}
                animate={
                  shake === node.index
                    ? { x: [0, -8, 8, -6, 6, 0] }
                    : node.isNext && !reduced
                      ? { scale: [1, 1.07, 1] }
                      : {}
                }
                transition={
                  shake === node.index
                    ? { duration: 0.45 }
                    : { duration: 1.9, repeat: Infinity, ease: "easeInOut" }
                }
                whileTap={{ scale: 0.9 }}
                aria-label={`${node.weekday} ${shortDate(date)}, ${node.startTime} to ${node.endTime}${
                  state === "locked" ? ", topic locked" : ""
                }`}
                aria-expanded={isOpen}
                className="group z-10 grid h-[52px] w-[52px] place-items-center rounded-full border-[4px] shadow-lg outline-none transition focus-visible:ring-4 focus-visible:ring-[var(--accent)]/40 sm:h-[62px] sm:w-[62px]"
              >
                {/* The disc. Colour carries the state; the glyph confirms it,
                    because colour alone is not a status anyone can rely on. */}
                <span
                  className={`absolute inset-[-4px] rounded-full border-[4px] ${
                    state === "done"
                      ? "border-emerald-600 bg-emerald-500"
                      : state === "today"
                        ? "border-[var(--accent)] bg-gradient-to-br from-[var(--accent)] to-[#FFB061]"
                        : state === "postponed"
                          ? "border-pink-400 bg-pink-200"
                          : state === "cancelled"
                            ? "border-[var(--danger)]/50 bg-[var(--danger-soft)]"
                            : "border-[var(--border-strong)] bg-[var(--surface)]"
                  }`}
                />

                {/* A halo on today's class only. */}
                {state === "today" && !reduced && (
                  <span
                    aria-hidden
                    className="pulse-ring absolute inset-[-10px] rounded-full border-2 border-[var(--accent)]"
                  />
                )}

                <span
                  className={`relative ${
                    state === "done"
                      ? "text-white"
                      : state === "today"
                        ? "text-white"
                        : state === "postponed"
                          ? "text-pink-800"
                          : state === "cancelled"
                            ? "text-[var(--danger)]"
                            : "text-[var(--muted)]"
                  }`}
                >
                  {state === "done" ? (
                    <CheckGlyph />
                  ) : state === "today" ? (
                    <StarGlyph />
                  ) : state === "postponed" ? (
                    <CalendarIcon className="h-5 w-5" strokeWidth={3} />
                  ) : state === "cancelled" ? (
                    <CrossIcon className="h-5 w-5" strokeWidth={3} />
                  ) : (
                    <LockIcon className="h-5 w-5" />
                  )}
                </span>

                <span className="absolute -bottom-6 whitespace-nowrap rounded-full bg-[var(--surface)] px-2 py-0.5 text-[10px] font-bold text-[var(--muted)] shadow-sm">
                  {node.weekday.slice(0, 3)} {date.getDate()}
                </span>

                {node.isNext && (
                  <span className="absolute -top-7 whitespace-nowrap rounded-full bg-[var(--foreground)] px-2.5 py-1 text-[9px] font-black uppercase tracking-wide text-[var(--surface)] shadow-lg">
                    Up next
                  </span>
                )}
              </motion.button>
            );
          })}

          {/* The student's marker. It sits on the waypoint they are standing on,
              which is what makes this a map of a journey rather than a chart. */}
          {here && (
            <motion.span
              aria-hidden
              className="pointer-events-none absolute z-20"
              style={{
                ...toPercent(here),
                transform: "translate(-50%, -50%)",
                // Reduced motion gets the resting height rather than 0, which
                // would park the marker directly on the disc.
                ...(reduced ? { marginTop: hereFloat[0] } : null),
              }}
              animate={reduced ? {} : { y: hereFloat }}
              transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--foreground)] text-[11px] font-black text-[var(--surface)] shadow-xl ring-2 ring-[var(--surface)]">
                DU
              </span>
            </motion.span>
          )}
        </div>

        {/* Popped up centered over everything, not appended below the map —
            on mobile the map is taller than the viewport, and a card left in
            normal document flow needed a scroll to ever be seen. */}
        <AnimatePresence mode="wait">
          {openIndex !== null && monthNodes.some((node) => node.index === openIndex) && (
            <ClassCard node={monthNodes.find((node) => node.index === openIndex)!} close={close} />
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

function ClassCard({ node, close }: { node: ClassNode; close: () => void }) {
  const summary = nodeSummary(node);
  const date = new Date(node.date);
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);

  // Portalled to the document body: this component renders inside shell
  // layouts that can be transformed (a sliding sidebar), and a `fixed`
  // element inside a transformed ancestor stops being viewport-fixed —
  // the same trap the sign-out modal hit.
  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  const sheet = (
    <motion.div
      className="fixed inset-0 z-[150] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={close}
      role="dialog"
      aria-modal="true"
    >
      <motion.div
        onClick={(event) => event.stopPropagation()}
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="max-h-[86vh] w-full max-w-lg overflow-y-auto rounded-t-[28px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xl sm:rounded-[28px]"
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full bg-[var(--surface-alt)] text-[var(--muted)] transition hover:bg-[var(--border)] hover:text-[var(--foreground)]"
        >
          <CrossIcon className="h-4 w-4" />
        </button>

        <ClassCardBody node={node} summary={summary} date={date} />
      </motion.div>
    </motion.div>
  );

  if (!portalTarget) return null;
  return createPortal(sheet, portalTarget);
}

function ClassCardBody({
  node,
  summary,
  date,
}: {
  node: ClassNode;
  summary: ReturnType<typeof nodeSummary>;
  date: Date;
}) {
  return (
    <div className="relative">
      <div className="flex flex-wrap items-baseline justify-between gap-2 pr-8">
        <p className="text-base font-extrabold">
          {node.weekday} {shortDate(date)} · {summary.when}
        </p>
        <span className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">{summary.slot} session</span>
      </div>

      {summary.topic ? (
        <p className="mt-2 text-sm leading-6 text-[var(--foreground-soft)]">{summary.topic}</p>
      ) : (
        <p className="mt-2 inline-flex items-center gap-2 rounded-xl bg-[var(--surface-alt)] px-3 py-2 text-sm font-semibold text-[var(--muted)]">
          <LockIcon className="h-4 w-4" /> Topic unlocks on {summary.lockedUntil}
        </p>
      )}

      {node.status === "postponed" && (
        <div className="mt-3 rounded-xl bg-pink-100 px-3 py-2">
          <p className="text-xs font-bold uppercase tracking-wide text-pink-800">Postponed</p>
          <p className="mt-0.5 text-sm font-semibold text-pink-900">
            {node.postponedTo
              ? `Now on ${shortDate(parseDayKey(node.postponedTo))}`
              : "Your tutor will confirm the new date"}
          </p>
        </div>
      )}

      {node.status === "cancelled" && (
        <p className="mt-3 inline-block rounded-lg bg-[var(--danger-soft)] px-2.5 py-1 text-xs font-bold uppercase text-[var(--danger)]">
          Cancelled — this class is not running
        </p>
      )}

      {summary.notes && (
        <p className="mt-3 rounded-xl bg-[var(--surface-alt)] px-3 py-2 text-sm leading-5 text-[var(--foreground-soft)]">
          {summary.notes}
        </p>
      )}

      {summary.tutor && <p className="mt-3 text-xs text-[var(--muted)]">with {summary.tutor}</p>}

      {summary.material && (
        <a
          href={summary.material.filePath}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-xs font-bold text-[var(--accent)]"
        >
          <AttachmentIcon className="h-3.5 w-3.5" /> {summary.material.title}
        </a>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- map */

/**
 * The sealed door at the end of the current level.
 *
 * It is a door and not a wall: tapping it really does load and draw the next
 * level's map. Hiding the next region entirely would be the safe choice and
 * the wrong one — a student who cannot see what is on the other side has no
 * reason to want it. They get to look; the padlock is what they have to move.
 */
const TEASER_W = MAX_COLS * CELL_W;

export function LockedRegionTeaser({
  nextLevel,
  currentLevel,
  onPeek,
}: {
  nextLevel: string;
  currentLevel: string;
  onPeek: () => void;
}) {
  return (
    <section className="relative mt-6 overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--surface-alt)]">
      {/* Locked terrain, drawn and then fogged. Its own fixed viewBox, stretched
          by `preserveAspectRatio="none"` — this is a texture behind a padlock,
          not a map anybody reads positions off, so it does not need the
          responsive grid the real regions use. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-60 blur-[5px]">
        <svg viewBox={`0 0 ${TEASER_W} 190`} className="h-full w-full" preserveAspectRatio="none">
          <Terrain width={TEASER_W} height={190} seed={9.1} />
          <path
            d={trailPath(layoutPoints(4, 4).points.map((point) => ({ x: point.x, y: point.y * 0.9 })))}
            fill="none"
            stroke="var(--muted)"
            strokeWidth="20"
            strokeLinecap="round"
            opacity="0.35"
          />
        </svg>
      </div>

      <div className="relative flex flex-col items-center gap-4 px-6 py-9 text-center sm:py-11">
        <motion.div
          animate={{ y: [0, -5, 0] }}
          transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
          className="grid h-20 w-20 place-items-center rounded-3xl border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--muted)] shadow-2xl"
        >
          <LockIcon className="h-9 w-9" strokeWidth={1.7} />
        </motion.div>

        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.3em] text-[var(--muted)]">Next region</p>
          <h3 className="mt-2 text-2xl font-extrabold">{nextLevel} — sealed</h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--muted)]">
            Finish your {currentLevel} journey to break the seal. You can walk up to the gate and look through it
            now — the map beyond is real, and it is yours the day you cross.
          </p>
        </div>

        <button
          type="button"
          onClick={onPeek}
          className="inline-flex items-center gap-2 rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-6 py-3 text-sm font-bold text-[var(--foreground)] shadow-lg transition hover:border-[var(--accent)]/50"
        >
          <SparklesIcon className="h-4 w-4 text-[var(--accent)]" /> Look through the gate
        </button>
      </div>
    </section>
  );
}

/**
 * What sits over the next level's map once it is on screen.
 *
 * The map underneath is genuinely rendered — real dates, real class count — and
 * then blurred. The upsell names the level and the thing that opens it, and
 * nothing here invents a discount or a deadline to do it.
 */
export function JourneyLockScreen({
  level,
  currentLevel,
  classCount,
  onBack,
}: {
  level: string;
  currentLevel: string;
  classCount: number;
  onBack: () => void;
}) {
  return (
    <div className="absolute inset-0 z-30 rounded-[28px] p-4">
      <div
        aria-hidden
        className="absolute inset-0 rounded-[28px]"
        style={{
          background:
            "linear-gradient(160deg, color-mix(in srgb, var(--accent-strong) 55%, transparent), color-mix(in srgb, var(--accent) 35%, transparent))",
        }}
      />

      {/* Sticky, not centred. The map underneath can be two screens tall, and
          a padlock centred in it is a padlock the student has to go looking
          for — it has to be wherever they are as they scroll the region. */}
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 22 }}
        className="sticky top-24 mx-auto w-full max-w-lg rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-7 text-center shadow-2xl"
      >
        <motion.div
          animate={{ rotate: [0, -4, 4, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          className="mx-auto grid h-20 w-20 place-items-center rounded-3xl bg-gradient-to-br from-[var(--accent-strong)] to-[var(--accent)] text-white shadow-xl"
        >
          <LockIcon className="h-9 w-9" strokeWidth={1.8} />
        </motion.div>

        <p className="mt-5 text-[11px] font-black uppercase tracking-[0.3em] text-[var(--muted)]">
          {level} advancement
        </p>
        <h3 className="mt-2 text-2xl font-extrabold leading-tight">
          {classCount} classes are waiting on the other side.
        </h3>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          This is the real {level} map — the dates, the sessions, the whole route. It opens when your{" "}
          {currentLevel} journey is complete and your place in the next batch is secured.
        </p>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Link
            href="/programs"
            className="flex-1 rounded-full bg-[var(--accent)] px-6 py-3.5 text-sm font-bold text-white shadow-lg transition hover:brightness-110"
          >
            Secure my {level} place
          </Link>
          <button
            type="button"
            onClick={onBack}
            className="rounded-full border border-[var(--border)] px-6 py-3.5 text-sm font-bold text-[var(--muted)] transition hover:bg-[var(--surface-alt)]"
          >
            Back to {currentLevel}
          </button>
        </div>

        <p className="mt-4 text-xs text-[var(--muted)]">
          Finishing {currentLevel} is what unlocks this — looking at it now costs nothing.
        </p>
      </motion.div>
    </div>
  );
}

export default function JourneyMap({
  months,
  nodes,
  openIndex,
  shake,
  onTap,
  close,
}: {
  months: Month[];
  nodes: ClassNode[];
  openIndex: number | null;
  shake: number | null;
  onTap: (node: ClassNode) => void;
  close: () => void;
}) {
  const [ref, cols] = useResponsiveCols();

  const regions = months
    .map((month) => ({
      month,
      monthNodes: nodes.filter((node) => month.sessions.some((session) => session.date === node.date)),
    }))
    .filter((region) => region.monthNodes.length > 0);

  return (
    <div ref={ref} className="space-y-6">
      {regions.map((region, index) => (
        <Region
          key={region.month.label}
          month={region.month}
          monthNodes={region.monthNodes}
          index={index}
          cols={cols}
          openIndex={openIndex}
          shake={shake}
          onTap={onTap}
          close={close}
        />
      ))}
    </div>
  );
}
