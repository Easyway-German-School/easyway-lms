"use client";

/**
 * The road to Germany as a place you can look at.
 *
 * WHAT THIS REPLACED, and why the replacement is not decoration.
 *
 * The first version of this map was a vertical list of cards with a line down
 * the side. Everything true about the journey was in it — the stages, the
 * first-person voice, the sealed future — and it still did not work, because a
 * list is a thing you read once. The reference the school actually asked for
 * was a game board: a road you travel along, with places on it, that looks
 * different in month six from how it looked in week one. People open a game
 * board to see where they are. Nobody opens a list twice.
 *
 * ---------------------------------------------------------------------------
 * GEOMETRY. Read this before changing a number.
 *
 *   COORDINATES ARE NORMALISED. Everything is laid out in a 0–100 × 0–100
 *   space and the container stretches it. The SVG uses
 *   `preserveAspectRatio="none"` with `vector-effect="non-scaling-stroke"` on
 *   every stroke, so the road bends with the container while its width stays
 *   constant in real pixels. Without the vector-effect the road is a hairline
 *   on a phone and a motorway on a desktop.
 *
 *   THE PERSPECTIVE IS A DIVISION, NOT A CSS TRANSFORM. `rotateX` on the whole
 *   plane is the obvious way to tilt a map and it is a trap: every node then
 *   needs counter-rotating to stand up, hit areas stop matching what is drawn,
 *   and text goes soft on Android. Instead one function — `project` — narrows
 *   x towards the top and scales the node with it. The road genuinely recedes,
 *   the nodes stay flat rectangles the browser can hit-test, and the whole
 *   thing costs four lines.
 *
 *   THE TOP IS FAR AWAY AND THE BOTTOM IS CLOSE. So the first stages — the
 *   wish, the registration, months ago — sit small on the horizon, and Germany
 *   sits nearest the reader at full size. That is the right way round
 *   emotionally: the destination is the biggest thing on the map.
 *
 *   THE SERPENTINE IS A `sin`, NOT A RANDOM. A random wander would draw a
 *   different road on the server than in the browser and blow up hydration —
 *   the class-day map on /calendar learned this the hard way.
 *
 * ---------------------------------------------------------------------------
 * THE 3D. There is no WebGL and there should not be. What reads as depth is:
 * a consistent light from the upper left, an extruded side on every solid
 * (the `0 Npx 0` shadow layer), a contact shadow on the ground under it, size
 * that falls off with distance, and contrast that falls off faster than size.
 * That runs at sixty frames on a ₦40,000 Android. A real 3D scene would not.
 *
 * ACCESSIBILITY AND MOTION. Every node is a real <button> with a real label.
 * `prefers-reduced-motion` stops the walk, the ripples, the plane and the
 * flag's wind — the road and the places stay, because they are the content.
 * The list view (JourneyRoad) is still one tap away and is still the thing a
 * screen reader gets a good pass over.
 */

import { useCallback, useId, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  CheckIcon,
  LockIcon,
  CrossIcon,
  SparklesIcon,
  StarIcon,
} from "@/components/icons";
import Mascot from "@/components/Mascot";
import GermanFlag from "@/components/journey/GermanFlag";
import { Birds, Cloud, CrossingPlane, Landmark, SkyLight, paletteFor } from "@/components/journey/JourneyScenery";
import type { GermanyGoal } from "@/lib/germany-goals";
import type { JourneyStage, StageStatus } from "@/lib/germany-journey";

/* -------------------------------------------------------------------------- */
/* Layout                                                                     */
/* -------------------------------------------------------------------------- */

/** Vertical space per stage, in real pixels. The map's height comes from this. */
const ROW_PX = 138;
const TOP_PX = 150;
const BOTTOM_PX = 210;

/** How much narrower the world is at the horizon than at the reader's feet. */
const FAR = 0.46;
const NEAR = 1;

/** How far the road swings side to side, in normalised units. */
const SWING = 26;

type Placed = {
  stage: JourneyStage;
  index: number;
  /** Normalised 0–100, after projection. */
  x: number;
  y: number;
  /** 0 at the horizon, 1 at the reader. Drives size, contrast and stacking. */
  depth: number;
  /** Multiplier applied to the node's size. */
  scale: number;
};

function layout(stages: JourneyStage[]): { points: Placed[]; heightPx: number } {
  const n = Math.max(1, stages.length);
  const heightPx = TOP_PX + (n - 1) * ROW_PX + BOTTOM_PX;

  const points = stages.map((stage, index) => {
    const yPx = TOP_PX + index * ROW_PX;
    const y = (yPx / heightPx) * 100;

    // Distance from the horizon. Eased so the far half compresses a little
    // more than the near half, which is what distance actually looks like.
    const depth = Math.pow(y / 100, 0.86);
    const scale = FAR + (NEAR - FAR) * depth;

    // The swing itself narrows with distance, so the road converges rather
    // than snaking at constant width all the way to the horizon.
    const swing = Math.sin(index * 0.86 + 0.5) * SWING;
    const x = 50 + swing * scale;

    return { stage, index, x, y, depth, scale };
  });

  return { points, heightPx };
}

type Cubic = { x0: number; y0: number; x1: number; y1: number; x2: number; y2: number; x3: number; y3: number };

/**
 * Catmull-Rom through the waypoints, as one cubic per gap.
 *
 * Every node sits ON the road by construction rather than by nudging, which is
 * the one thing that has to be true of a map like this and the one thing that
 * is impossible to fix later by eye.
 *
 * Kept as a LIST of segments rather than one string because the lit stretch is
 * cut at a node — see `litRoad`.
 */
function roadSegments(points: Placed[]): Cubic[] {
  if (points.length < 2) return [];
  const at = (i: number) => points[Math.max(0, Math.min(points.length - 1, i))];

  const segments: Cubic[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    segments.push({
      x0: p1.x,
      y0: p1.y,
      x1: p1.x + (p2.x - p0.x) / 6,
      y1: p1.y + (p2.y - p0.y) / 6,
      x2: p2.x - (p3.x - p1.x) / 6,
      y2: p2.y - (p3.y - p1.y) / 6,
      x3: p2.x,
      y3: p2.y,
    });
  }
  return segments;
}

function draw(segments: Cubic[]): string {
  return segments
    .map((s) => `M${s.x0.toFixed(2)} ${s.y0.toFixed(2)} C${s.x1.toFixed(2)} ${s.y1.toFixed(2)}, ${s.x2.toFixed(2)} ${s.y2.toFixed(2)}, ${s.x3.toFixed(2)} ${s.y3.toFixed(2)}`)
    .join(" ");
}

/**
 * The first `t` of one cubic, by de Casteljau subdivision.
 *
 * Used for the part-walked stage the student is standing in, so the lit road
 * creeps forward during a level instead of jumping every two months.
 */
function truncate(s: Cubic, t: number): Cubic {
  const lerp = (a: number, b: number) => a + (b - a) * t;
  const ax = lerp(s.x0, s.x1);
  const ay = lerp(s.y0, s.y1);
  const bx = lerp(s.x1, s.x2);
  const by = lerp(s.y1, s.y2);
  const cx = lerp(s.x2, s.x3);
  const cy = lerp(s.y2, s.y3);
  const dx = lerp(ax, bx);
  const dy = lerp(ay, by);
  const ex = lerp(bx, cx);
  const ey = lerp(by, cy);
  return { x0: s.x0, y0: s.y0, x1: ax, y1: ay, x2: dx, y2: dy, x3: lerp(dx, ex), y3: lerp(dy, ey) };
}

/**
 * The road they have already walked, as its own shape.
 *
 * CUT, NOT DASHED, and that distinction cost two wrong builds.
 *
 * The natural way to light part of a path is a dash: `pathLength={1}` and a
 * `strokeDasharray` of the fraction walked, which is exactly what the
 * class-day map on /calendar does and why it never measures anything. Neither
 * form of it survives here:
 *
 *   1. Chrome ignores `pathLength` for dash arithmetic on a path carrying
 *      `vector-effect="non-scaling-stroke"` — and the stroke has to be
 *      non-scaling, because this SVG is squashed about 22:1 vertically and a
 *      plain 26-unit stroke would render as a 570px slab. A 0.15 dash was read
 *      as 0.15 USER units on a 160-unit road: a hundred and forty orange
 *      freckles scattered the whole way to Germany.
 *
 *   2. Measuring the real length with `getTotalLength()` and dashing that
 *      fixes the freckles and is still wrong, because arc length in the
 *      unsquashed 100×100 space is not proportional to distance on screen. A
 *      unit of sideways wander is 22 times cheaper on screen than a unit of
 *      downward travel, so the lit stretch ran a stage and a half past the
 *      node the student is actually standing on.
 *
 * So the lit road is simply a DIFFERENT PATH: the first N segments, plus the
 * fraction of segment N+1 they are into. Exact by construction, no measuring,
 * no browser quirk, and it cannot drift from the nodes because it is built
 * from the same points they are.
 */
function litRoad(segments: Cubic[], stages: JourneyStage[]): Cubic[] {
  if (segments.length === 0) return [];
  const done = stages.filter((stage) => stage.status === "done").length;
  const whole = Math.max(0, Math.min(segments.length, done - 1));
  const current = stages.find((stage) => stage.status === "current");
  const partial = current ? Math.max(0, Math.min(1, current.percent / 100)) : 0;

  const lit = segments.slice(0, whole);
  if (partial > 0 && whole < segments.length) lit.push(truncate(segments[whole], partial));
  return lit;
}

/* -------------------------------------------------------------------------- */
/* The regions of the road                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Three acts, named.
 *
 * A twelve-node road with no divisions is twelve things to get through. The
 * same road cut into "getting in", "the German" and "the crossing" is three —
 * and chunking is the cheapest thing anybody has ever done to make a long list
 * feel finishable.
 */
const REGION_TITLE: Record<string, { eyebrow: string; title: string }> = {
  approach: { eyebrow: "Act one", title: "Getting to the classroom" },
  level: { eyebrow: "Act two", title: "The German" },
  destination: { eyebrow: "Act three", title: "The crossing" },
};

function regionOf(stage: JourneyStage): keyof typeof REGION_TITLE {
  if (stage.kind === "level") return "level";
  if (stage.kind === "destination") return "destination";
  return "approach";
}

/* -------------------------------------------------------------------------- */
/* One place on the road                                                      */
/* -------------------------------------------------------------------------- */

const DISC: Record<StageStatus, { face: string; side: string; ink: string; ring: string }> = {
  done: {
    face: "linear-gradient(150deg, #14b8a6, #0D7C7E 52%, #0b6567)",
    side: "#075355",
    ink: "#ffffff",
    ring: "rgba(255,255,255,0.55)",
  },
  current: {
    face: "linear-gradient(150deg, #ffb066, #FF6600 55%, #e05500)",
    side: "#a83f00",
    ink: "#ffffff",
    ring: "rgba(255,255,255,0.75)",
  },
  next: {
    face: "linear-gradient(150deg, #ffffff, #e9edf5)",
    side: "#b6bfcf",
    ink: "#334155",
    ring: "rgba(255,102,0,0.55)",
  },
  locked: {
    face: "linear-gradient(150deg, #b9c2d0, #97a2b4)",
    side: "#6b7686",
    ink: "#f8fafc",
    ring: "rgba(255,255,255,0.25)",
  },
};

function StageNode({
  placed,
  onOpen,
  reduced,
}: {
  placed: Placed;
  onOpen: () => void;
  reduced: boolean;
}) {
  const { stage, depth, scale } = placed;
  const tone = DISC[stage.status];
  const isCurrent = stage.status === "current";

  // The extrusion. This single line is what makes the node read as an object
  // sitting on the ground rather than a circle drawn on it.
  const lift = isCurrent ? 9 : 7;
  const solid = `0 ${lift}px 0 ${tone.side}, 0 ${lift + 9}px 20px rgba(2,6,23,0.38)`;
  const pressed = `0 2px 0 ${tone.side}, 0 5px 10px rgba(2,6,23,0.35)`;

  const size = stage.kind === "level" ? 74 : 64;

  return (
    // TWO ELEMENTS, ON PURPOSE. The outer one owns the position and the
    // centring translate; the inner one owns every animation. Framer writes
    // `transform` inline, so a single element carrying both a Tailwind
    // `-translate-x-1/2` and an animated `scale` loses the centring the
    // instant the animation starts — every node jumps down and right off the
    // road, which is exactly what the first build of this did.
    <div
      className="absolute"
      style={{
        left: `${placed.x}%`,
        top: `${placed.y}%`,
        transform: "translate(-50%, -50%)",
        // Near things stand in front of far things. Without this a big
        // foreground node can be overlapped by a small distant one.
        zIndex: 10 + Math.round(depth * 40),
      }}
    >
      <motion.button
        type="button"
        onClick={onOpen}
        aria-label={`${stage.label} — ${
          stage.status === "done"
            ? "completed"
            : stage.status === "current"
              ? "you are here"
              : stage.status === "next"
                ? "next"
                : "locked"
        }`}
        className="relative block focus-visible:outline-none"
        initial={reduced ? false : { opacity: 0, y: 18, scale: scale * 0.8 }}
        whileInView={reduced ? undefined : { opacity: 1, y: 0, scale }}
        animate={reduced ? { scale } : undefined}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ type: "spring", stiffness: 260, damping: 22 }}
        whileTap={{ scale: scale * 0.96 }}
      >
      <span className="relative grid place-items-center" style={{ width: size, height: size }}>
        {/* Contact shadow on the ground, separate from the extrusion so it
            stays elliptical while the disc stays round. */}
        <span
          aria-hidden
          className="absolute left-1/2 -translate-x-1/2 rounded-[50%] bg-slate-950/25 blur-[3px]"
          style={{ bottom: -lift - 6, width: size * 0.82, height: 9 }}
        />

        {/* The heartbeat. Two rings, offset in time — one ring blinks, two
            pulse. Only ever on the stage they are standing on: this is the
            single thing on the page allowed to move forever. */}
        {isCurrent && !reduced
          ? [0, 1].map((ring) => (
              <motion.span
                key={ring}
                aria-hidden
                className="absolute rounded-full border-2"
                style={{ width: size, height: size, borderColor: "rgba(255,102,0,0.85)" }}
                initial={{ scale: 0.85, opacity: 0.6 }}
                animate={{ scale: 1.85, opacity: 0 }}
                transition={{ duration: 2.4, delay: ring * 1.2, repeat: Infinity, ease: "easeOut" }}
              />
            ))
          : null}

        <motion.span
          className="relative grid h-full w-full place-items-center rounded-full"
          style={{ background: tone.face, boxShadow: solid, color: tone.ink }}
          whileTap={{ boxShadow: pressed, y: lift - 2 }}
          transition={{ type: "spring", stiffness: 700, damping: 30 }}
        >
          {/* The lit rim. A flat disc with a highlight arc reads as a sphere. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-[3px] rounded-full"
            style={{ boxShadow: `inset 0 3px 0 ${tone.ring}, inset 0 -6px 10px rgba(2,6,23,0.22)` }}
          />

          {stage.kind === "level" ? (
            <span className="text-[19px] font-black tracking-tight">{stage.level}</span>
          ) : stage.status === "done" ? (
            <CheckIcon className="h-7 w-7" strokeWidth={3.2} />
          ) : stage.status === "locked" ? (
            <LockIcon className="h-6 w-6" strokeWidth={2.4} />
          ) : (
            <span className="text-[17px] font-black">{stage.step}</span>
          )}

          {/* A finished level keeps its star. Collecting beats completing. */}
          {stage.status === "done" && stage.kind === "level" ? (
            <span className="absolute -right-1 -top-1 grid h-6 w-6 place-items-center rounded-full bg-amber-400 text-amber-950 shadow-[0_3px_0_#b45309]">
              <StarIcon className="h-3.5 w-3.5" strokeWidth={2.6} />
            </span>
          ) : null}
        </motion.span>
      </span>

        {/* The name plate — but not under a level node, whose face already says
            "A2" in 19px. A plate reading "A2" under a disc reading "A2" is
            noise, and there are six of them in a row. */}
        {stage.kind === "level" ? null : (
          <span
            className="pointer-events-none absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold shadow-[0_2px_6px_rgba(2,6,23,0.25)]"
            style={{
              background: stage.status === "locked" ? "rgba(15,23,42,0.55)" : "rgba(255,255,255,0.94)",
              color: stage.status === "locked" ? "#e2e8f0" : "#0f172a",
            }}
          >
            {stage.label}
          </span>
        )}
      </motion.button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The guide                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The school's scholar, standing on the stage they are standing on.
 *
 * This is the same character who walks students round the portal on their first
 * day (`WelcomeTour`) and who points at the tuition band. Bringing them back
 * here is the cheapest continuity the product has: one character who appears
 * wherever something matters is a guide, and three different mascots are
 * clip art.
 *
 * On mount they WALK from the last cleared stage to the current one, so the
 * first thing the map does is show the student the ground they have covered.
 */
function Guide({
  from,
  to,
  line,
  reduced,
}: {
  from: Placed | null;
  to: Placed;
  line: string;
  reduced: boolean;
}) {
  const start = from ?? to;

  /**
   * WHICH SIDE THE GUIDE STANDS ON.
   *
   * Always the side with room. The first build parked them at a fixed
   * `left: -64px` from the node, which is fine until the road swings right —
   * and then the mascot is outside the map's `overflow-hidden` and the student
   * sees a speech bubble with nobody saying it. The group is anchored by its
   * near edge and grows inwards, so it can never leave the map however far the
   * road wanders.
   *
   * `>=`, NOT `>`, and that one character is a measured bug fix. A stage
   * sitting exactly on the centre line went RIGHT, and the bubble is a fixed
   * width in real pixels while the map is a percentage — so on a 375px phone
   * the right-hand half was not wide enough and the last word of the line was
   * clipped off the edge of the map. A node on the centre line now goes left,
   * where there is by definition at least as much room.
   */
  const onLeft = to.x >= 50;
  const GAP = 20;

  // The guide shrinks with distance like everything else, but not all the way.
  // At the top of a long road the perspective scale is under 0.5, and a 40px
  // mascot with 5px text is a smudge — the one character on the map who has
  // something to say has to stay legible wherever the student is standing.
  const scale = Math.max(0.82, to.scale);

  return (
    <motion.div
      className="pointer-events-none absolute"
      style={{ zIndex: 10 + Math.round(to.depth * 40) + 5 }}
      initial={{ left: `${start.x}%`, top: `${start.y}%` }}
      animate={{ left: `${to.x}%`, top: `${to.y}%` }}
      transition={reduced ? { duration: 0 } : { duration: 1.5, delay: 0.5, ease: "easeInOut" }}
    >
      <div
        // Narrower on a phone. The bubble does not shrink with the map — it is
        // real pixels over a percentage layout — so on a 375px screen a 150px
        // bubble plus its gap is over half the width available to one side.
        className={`flex w-[124px] flex-col sm:w-[150px] ${onLeft ? "items-end" : "items-start"}`}
        style={{
          transform: `translate(${onLeft ? `calc(-100% - ${GAP}px)` : `${GAP}px`}, -78%) scale(${scale.toFixed(2)})`,
          transformOrigin: onLeft ? "right bottom" : "left bottom",
        }}
      >
        <div className="relative w-full rounded-2xl bg-white px-3 py-2 shadow-[0_10px_26px_rgba(2,6,23,0.35)]">
          <p className="text-[11px] font-bold leading-4 text-slate-900">{line}</p>
          {/* The tail points down at the mascot's head, not at the node — the
              bubble belongs to the character, and the character points at the
              node. */}
          <span
            className={`absolute -bottom-1.5 h-3 w-3 rotate-45 bg-white ${onLeft ? "right-8" : "left-8"}`}
          />
        </div>

        {/* Mirrored when standing to the RIGHT of the node: the mascot is drawn
            pointing rightwards, and a guide pointing away from the thing they
            are introducing is worse than no guide at all. */}
        <span className="mt-1 block" style={onLeft ? undefined : { transform: "scaleX(-1)" }}>
          <Mascot mood="happy" pointAngle={0} className="h-[80px] w-[68px]" />
        </span>
      </div>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/* The sheet a node opens                                                     */
/* -------------------------------------------------------------------------- */

function StageSheet({
  stage,
  goal,
  onClose,
  onClaim,
  claiming,
  cta,
}: {
  stage: JourneyStage;
  goal: GermanyGoal;
  onClose: () => void;
  onClaim?: (stage: JourneyStage, undo: boolean) => void;
  claiming: boolean;
  cta?: React.ReactNode;
}) {
  const sealed = stage.status === "locked";

  return (
    <motion.div
      className="fixed inset-0 z-[150] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={stage.label}
    >
      <motion.div
        onClick={(event) => event.stopPropagation()}
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="max-h-[86vh] w-full max-w-lg overflow-y-auto rounded-t-[28px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xl sm:rounded-[28px]"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--muted)]">
              Step {stage.step}
            </span>
            {stage.status === "current" ? (
              <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                You are here
              </span>
            ) : null}
            {stage.status === "next" ? (
              <span className="rounded-full border border-[var(--border-strong)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
                Next up
              </span>
            ) : null}
            {stage.tribe && stage.status === "done" ? (
              <span className="rounded-full bg-[var(--success-soft)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--success)]">
                {stage.tribe}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[var(--border)] text-[var(--muted)] transition hover:bg-[var(--surface-alt)]"
          >
            <CrossIcon className="h-4 w-4" />
          </button>
        </div>

        {/* THE SENTENCE IS THE PRIZE and it is only in quotation marks once it
            is true. An unearned "I paid. My seat is mine." was, in the first
            build, appearing on the lock screen of somebody being asked to pay.
            A sealed stage gets no sentence at all — you cannot preview a line
            about a level you have not reached without spending it. */}
        {sealed ? (
          <>
            <p className="text-xl font-bold text-[var(--muted)]">{stage.label}</p>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{stage.teaser}</p>
          </>
        ) : stage.status === "done" ? (
          <>
            <p className="text-xl font-bold leading-7 text-[var(--foreground)]">&ldquo;{stage.voice}&rdquo;</p>
            <p className="mt-2 text-sm leading-6 text-[var(--foreground-soft)]">{stage.echo}</p>
          </>
        ) : (
          <>
            <p className="text-xl font-bold text-[var(--foreground)]">{stage.label}</p>
            <div className="mt-3 border-l-2 border-[var(--accent)]/40 pl-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                Clear this and you get to say
              </p>
              <p className="mt-0.5 text-base font-semibold italic leading-6 text-[var(--foreground-soft)]">
                {stage.voice}
              </p>
            </div>
            <p className="mt-3 text-sm leading-6 text-[var(--foreground-soft)]">{stage.teaser}</p>
          </>
        )}

        {stage.status === "current" && stage.percent > 0 ? (
          <div className="mt-4">
            <div className="h-2 overflow-hidden rounded-full bg-[var(--border)]">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${stage.percent}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="h-full rounded-full bg-gradient-to-r from-[#0D7C7E] to-[#FF6600]"
              />
            </div>
            <p className="mt-1.5 text-[11px] font-semibold text-[var(--accent-ink)]">{stage.percent}% through</p>
          </div>
        ) : null}

        {stage.clearedAt ? (
          <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--success)]">
            Stamped{" "}
            {new Date(stage.clearedAt).toLocaleDateString(undefined, {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        ) : null}

        {stage.note ? (
          <p className="mt-3 rounded-2xl bg-[var(--surface-alt)] p-3 text-sm text-[var(--foreground-soft)]">
            {stage.note}
          </p>
        ) : null}

        {cta ? <div className="mt-4">{cta}</div> : null}

        {/* The stages after the classroom are the student's word — and just as
            importantly, undoable. Somebody who taps "I have my visa" a
            fortnight early must be able to take it back without ringing the
            branch and explaining themselves. */}
        {stage.selfReported && onClaim && stage.status !== "locked" ? (
          <button
            type="button"
            disabled={claiming}
            onClick={() => onClaim(stage, stage.status === "done")}
            className={`mt-4 w-full rounded-full px-4 py-3 text-sm font-bold transition disabled:opacity-50 ${
              stage.status === "done"
                ? "border border-[var(--border-strong)] text-[var(--muted)] hover:bg-[var(--surface-alt)]"
                : "bg-[var(--accent)] text-white hover:brightness-110"
            }`}
          >
            {stage.status === "done" ? "Undo — this has not happened yet" : `Yes — ${stage.label.toLowerCase()} is done`}
          </button>
        ) : null}

        {stage.selfReported && stage.status !== "done" ? (
          <p className="mt-2 text-[11px] leading-5 text-[var(--muted)]">
            We cannot see this one from here — you tell us, and your branch confirms it.
          </p>
        ) : null}

        {/* Requirements carry their caveat wherever they are shown. This school
            teaches German; it does not issue visas, and must never read as
            though it does. */}
        {stage.kind === "destination" ? (
          <p className="mt-4 border-t border-[var(--border)] pt-3 text-[11px] leading-5 text-[var(--muted)]">
            {goal.disclaimer}
          </p>
        ) : null}
      </motion.div>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/* The world                                                                  */
/* -------------------------------------------------------------------------- */

export default function JourneyWorld({
  stages,
  percentToGermany,
  goal,
  firstName,
  onClaim,
  claimingStage,
  renderStageCta,
}: {
  stages: JourneyStage[];
  percentToGermany: number;
  goal: GermanyGoal;
  firstName: string;
  onClaim?: (stage: JourneyStage, undo: boolean) => void;
  claimingStage?: string | null;
  renderStageCta?: (stage: JourneyStage) => React.ReactNode;
}) {
  const reduced = useReducedMotion() ?? false;
  const [openId, setOpenId] = useState<string | null>(null);

  const uid = useId().replace(/:/g, "");
  const litId = `road-lit-${uid}`;
  const glowId = `road-glow-${uid}`;

  const { points, heightPx } = useMemo(() => layout(stages), [stages]);
  const segments = useMemo(() => roadSegments(points), [points]);
  const road = useMemo(() => draw(segments), [segments]);
  const lit = useMemo(() => draw(litRoad(segments, stages)), [segments, stages]);
  const palette = useMemo(() => paletteFor(goal.hue), [goal.hue]);

  const currentPoint = points.find((point) => point.stage.status === "current") ?? points[points.length - 1];
  const previousPoint = currentPoint ? points[currentPoint.index - 1] ?? null : null;
  const finish = points[points.length - 1] ?? null;
  const open = stages.find((stage) => stage.id === openId) ?? null;

  /* The line in the speech bubble. Their name, their stage, no filler. */
  const guideLine = currentPoint
    ? currentPoint.stage.status === "current" && currentPoint.stage.percent > 0
      ? `${firstName}, you are ${currentPoint.stage.percent}% through ${currentPoint.stage.label}.`
      : currentPoint.stage.kind === "destination"
        ? `${firstName}, this is the part only you can do.`
        : `${firstName}, you are here.`
    : `${firstName}, you are here.`;

  /* Where the acts change, so a banner can be dropped in. */
  const regionMarks = useMemo(() => {
    const marks: Array<{ y: number; key: string; eyebrow: string; title: string }> = [];
    let previous: string | null = null;
    for (const point of points) {
      const region = regionOf(point.stage);
      if (region !== previous) {
        marks.push({
          // Half a row above the first node of the act, which is the gap the
          // road leaves between them.
          y: Math.max(2, point.y - ((ROW_PX * 0.52) / heightPx) * 100),
          key: `${region}-${point.index}`,
          ...REGION_TITLE[region],
        });
        previous = region;
      }
    }
    return marks;
  }, [points, heightPx]);

  /**
   * The sky warms up as they get closer.
   *
   * Cold violet at the start, gold at the end, over the goal's own hue. It is a
   * slow cumulative reward nobody has to be told about — the map simply looks
   * different in month six from how it looked in week one, and they notice
   * without noticing.
   *
   * The stops are TRANSLUCENT over `--surface-alt` rather than opaque colours:
   * this school ships three themes, and a fixed 96%-lightness sky is a white
   * slab in Nacht and Dämmerung. The hue is the journey's, the lightness is the
   * theme's.
   */
  const p = Math.max(0, Math.min(100, percentToGermany)) / 100;
  const skyHue = goal.hue - (goal.hue - 34) * p * 0.8;
  const sky = `linear-gradient(178deg,
    hsl(${skyHue.toFixed(0)} ${(58 + p * 20).toFixed(0)}% 62% / 0.30),
    hsl(${(skyHue - 16).toFixed(0)} ${(52 + p * 18).toFixed(0)}% 62% / 0.16) 42%,
    hsl(${(skyHue - 34).toFixed(0)} ${(46 + p * 16).toFixed(0)}% 58% / 0.26) 72%,
    hsl(${(skyHue - 46).toFixed(0)} 44% 52% / 0.34)), var(--surface-alt)`;

  return (
    <div className="relative overflow-hidden rounded-[28px] border border-[var(--border)]">
      <div className="relative w-full" style={{ height: heightPx, background: sky }}>
        {/* ---------------------------------------------------------------- */}
        {/* Sky                                                              */}
        {/* ---------------------------------------------------------------- */}
        <SkyLight percent={percentToGermany} className="left-[6%] top-[1.5%] h-28 w-28 opacity-80" />
        <Cloud className="top-[3%] w-40 sm:w-52" duration={96} opacity={0.62} />
        <Cloud className="top-[7.5%] w-28 sm:w-36" duration={140} delay={12} opacity={0.4} />
        <Cloud className="top-[14%] w-24 sm:w-32" duration={170} delay={40} opacity={0.28} />
        <CrossingPlane className="top-[5%] w-44 sm:w-56" />
        <Birds className="right-[12%] top-[10%] w-16 text-slate-600/60" />

        {/* ---------------------------------------------------------------- */}
        {/* Ground and scenery                                               */}
        {/* ---------------------------------------------------------------- */}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
          className="absolute inset-0 h-full w-full"
        >
          {/*
            Rolling ground: SIX bands, not three, and they run all the way to
            the bottom edge.

            Three bands ending at 58% is fine on a short road and a grey slab on
            a long one — the map is `stages × 138px` tall, so for a nurse's
            fifteen-stage road the bottom nine hundred pixels had no landscape
            in them at all, which is exactly where Germany is.

            GRASS IS GREEN WHATEVER THE GOAL IS. These hues were derived from
            `goal.hue`, so the care road (hue 168) rotated its ground to 238 and
            drew a blue field. The goal now tints the ground — a few degrees of
            hue and a little saturation — instead of choosing it.
          */}
          {[
            { d: "M0 22 Q22 15 42 21 T78 19 T100 24 L100 100 L0 100 Z", hue: 158, sat: 26, light: 64, alpha: 0.18 },
            { d: "M0 34 Q26 27 48 33 T84 31 T100 36 L100 100 L0 100 Z", hue: 148, sat: 30, light: 60, alpha: 0.2 },
            { d: "M0 52 Q30 44 56 51 T100 49 L100 100 L0 100 Z", hue: 138, sat: 34, light: 57, alpha: 0.22 },
            { d: "M0 68 Q24 61 52 67 T100 64 L100 100 L0 100 Z", hue: 126, sat: 36, light: 54, alpha: 0.24 },
            { d: "M0 82 Q34 76 60 81 T100 79 L100 100 L0 100 Z", hue: 112, sat: 38, light: 51, alpha: 0.26 },
            { d: "M0 93 Q28 89 58 92 T100 91 L100 100 L0 100 Z", hue: 98, sat: 40, light: 48, alpha: 0.3 },
          ].map((band) => (
            <path
              key={band.d}
              d={band.d}
              fill={`hsl(${(band.hue + (goal.hue - 160) * 0.12).toFixed(0)} ${band.sat}% ${band.light}% / ${band.alpha})`}
            />
          ))}
        </svg>

        {/*
          The goal's own landmarks, planted down both sides of the road.

          Distance is per-landmark rather than global: the one beside the
          destination stands at full size and full contrast, the ones behind it
          shrink and wash out, so the country literally comes into focus as the
          student descends. Sides alternate so the road always has something to
          run past rather than a bare stripe down one edge.

          Seven of them for a map that can be two thousand pixels tall. Three
          was a landmark every seven hundred pixels, which is a field.
        */}
        {[
          { kind: goal.scenery[2] ?? "alps", top: "9%", depth: 0.82, side: "right" as const, w: "w-20 sm:w-28" },
          { kind: "forest" as const, top: "18%", depth: 0.7, side: "left" as const, w: "w-20 sm:w-28" },
          { kind: goal.scenery[1] ?? "castle", top: "31%", depth: 0.55, side: "right" as const, w: "w-24 sm:w-32" },
          { kind: "houses" as const, top: "46%", depth: 0.4, side: "left" as const, w: "w-28 sm:w-36" },
          { kind: goal.scenery[2] ?? "alps", top: "58%", depth: 0.32, side: "right" as const, w: "w-28 sm:w-36" },
          { kind: goal.scenery[1] ?? "castle", top: "72%", depth: 0.18, side: "left" as const, w: "w-32 sm:w-44" },
          { kind: goal.scenery[0] ?? "gate", top: "86%", depth: 0, side: "right" as const, w: "w-36 sm:w-52" },
        ].map((item, index) => (
          <Landmark
            key={`${item.kind}-${index}`}
            kind={item.kind}
            palette={palette}
            depth={item.depth}
            className={`${item.side === "left" ? "left-[1%]" : "right-[1%]"} ${item.w}`}
            style={{ top: item.top }}
          />
        ))}

        {/* ---------------------------------------------------------------- */}
        {/* The road                                                         */}
        {/* ---------------------------------------------------------------- */}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
          className="absolute inset-0 h-full w-full"
        >
          <defs>
            {/* Unique per instance. `GermanyJourney` renders this map twice on
                a first visit — once on the dashboard and once inside the daily
                moment — and two <defs> sharing an id means the second copy
                quietly borrows the first one's gradient. */}
            <linearGradient id={litId} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#FF6600" />
              <stop offset="60%" stopColor="#fbbf24" />
              <stop offset="100%" stopColor="#fde68a" />
            </linearGradient>
            <filter id={glowId} x="-30%" y="-10%" width="160%" height="120%">
              <feGaussianBlur stdDeviation="2.4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Cast shadow, then kerb, then surface. Non-scaling strokes: the
              road must be the same width on a 320px phone as on a desktop. */}
          <path
            d={road}
            fill="none"
            stroke="rgba(2,6,23,0.26)"
            strokeWidth={34}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            transform="translate(0 0.6)"
          />
          <path
            d={road}
            fill="none"
            stroke={`hsl(${goal.hue} 18% 44%)`}
            strokeWidth={32}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={road}
            fill="none"
            stroke={`hsl(${goal.hue} 14% 78%)`}
            strokeWidth={26}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />

          {/* How far they have walked, lit. Its own shape, cut at the node —
              see `litRoad` for why this is not a dash. The reveal is a scale
              on the group rather than on the geometry, so nothing is
              recalculated during the animation. */}
          {lit ? (
            <motion.path
              d={lit}
              fill="none"
              stroke={`url(#${litId})`}
              strokeWidth={26}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              filter={`url(#${glowId})`}
              initial={reduced ? { opacity: 1 } : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1.1, ease: "easeOut", delay: 0.25 }}
            />
          ) : null}

          <path
            d={road}
            fill="none"
            stroke="rgba(255,255,255,0.75)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray="6 10"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* ---------------------------------------------------------------- */}
        {/* Act banners                                                      */}
        {/* ---------------------------------------------------------------- */}
        {regionMarks.map((mark) => (
          <div
            key={mark.key}
            className="pointer-events-none absolute left-1/2 z-[8] -translate-x-1/2 -translate-y-1/2 text-center"
            style={{ top: `${mark.y}%` }}
          >
            <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-white/70 drop-shadow">{mark.eyebrow}</p>
            <p className="mt-0.5 whitespace-nowrap rounded-full bg-slate-950/40 px-3 py-1 text-[11px] font-bold text-white backdrop-blur-sm">
              {mark.title}
            </p>
          </div>
        ))}

        {/* ---------------------------------------------------------------- */}
        {/* The places                                                       */}
        {/* ---------------------------------------------------------------- */}
        {points.map((point) => (
          <StageNode key={point.stage.id} placed={point} reduced={reduced} onOpen={() => setOpenId(point.stage.id)} />
        ))}

        {currentPoint ? (
          <Guide from={previousPoint} to={currentPoint} line={guideLine} reduced={reduced} />
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {/* The end of the road                                              */}
        {/* ---------------------------------------------------------------- */}
        {/* Planted BESIDE THE LAST NODE rather than in the corner of the card.
            In the corner it is a decoration that happens to be a flag, and it
            sat underneath the portal's fixed theme switcher; here it is the
            thing standing at the end of the road, which is what it is for.
            It takes the side the guide is not on. */}
        {finish ? (
          <div
            // The cap has to be narrower than the longest destination on one
            // line, or it caps nothing and the label never wraps — 42vw was
            // 157px against a 142px label, so it sat there in a single line
            // and ran off the map. 104px is just over the flag's own width,
            // which is the real floor for this column.
            className="pointer-events-none absolute z-[60] flex max-w-[104px] flex-col items-center sm:max-w-[220px]"
            style={{
              left: `${finish.x}%`,
              top: `${finish.y}%`,
              // `>=`, matching the guide: a finish sitting exactly on the
              // centre line used to go right, and the label beside it is real
              // pixels over a percentage layout, so on a phone it ran off the
              // edge and was clipped by the map's overflow-hidden.
              transform: `translate(${finish.x >= 50 ? "-100%" : "0"}, -34%) translateX(${finish.x >= 50 ? "-34px" : "34px"})`,
            }}
          >
            <GermanFlag className="h-24 w-auto sm:h-36" amplitude={p >= 0.9 ? 11 : 8} />
            {/* NOT whitespace-nowrap. The destination is the student's own
                goal — "a skilled job with my qualification", "your first
                lecture" — and on one line at 375px that is wider than the
                screen. It wraps and centres instead. */}
            <p className="mt-0.5 rounded-2xl bg-slate-950/45 px-2.5 py-1 text-center text-[10px] font-bold uppercase leading-tight tracking-[0.12em] text-white backdrop-blur-sm sm:tracking-[0.16em]">
              {goal.destination}
            </p>
          </div>
        ) : null}

        {/* A quiet, honest score line rather than a fake "only 3% get here". */}
        <div className="pointer-events-none absolute left-3 top-3 z-[60] flex items-center gap-1.5 rounded-full bg-slate-950/40 px-3 py-1.5 text-white backdrop-blur-sm sm:left-5 sm:top-5">
          <SparklesIcon className="h-3.5 w-3.5" />
          <span className="text-[11px] font-bold">{percentToGermany}% of the way</span>
        </div>
      </div>

      <AnimatePresence>
        {open ? (
          <StageSheet
            stage={open}
            goal={goal}
            onClose={() => setOpenId(null)}
            onClaim={onClaim}
            claiming={claimingStage === open.id}
            cta={renderStageCta?.(open)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
