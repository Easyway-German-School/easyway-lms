"use client";

/**
 * The German flag, actually waving.
 *
 * The map used to end with the word "Deutschland" in tracking-wide capitals and
 * a generic outline flag glyph. The thing at the end of a six-month road has to
 * be worth six months, and a flag that moves is worth more than a flag that is
 * a rectangle — this is the single image the whole feature is walking towards.
 *
 * HOW THE WAVE WORKS, so nobody replaces it with a GIF:
 *
 *   Each of the three bands is its own path, sampled from one shared wave
 *   function, so the boundaries between black, red and gold ripple TOGETHER
 *   the way cloth does. Clipping three flat rectangles to one wavy outline —
 *   the obvious build — gives you straight internal seams inside a rippling
 *   silhouette, which reads as a sticker rather than a flag.
 *
 *   Amplitude grows with distance from the pole (`x/width`), because the end
 *   held by a pole does not flap. That one term is most of the realism.
 *
 *   The four `d` keyframes are the same wave at four phases and interpolate
 *   cleanly because every keyframe has an identical command sequence. Framer
 *   Motion will happily animate `d` between paths of matching structure and
 *   will silently snap between paths of differing structure, which is why
 *   `SAMPLES` is a constant and not a prop.
 *
 * COLOURS ARE THE OFFICIAL ONES: #000000 / #DD0000 / #FFCE00. Not "black, red,
 * yellow" as a designer's eye judges them. Somebody from Germany will look at
 * this.
 */

import { useId } from "react";
import { motion, useReducedMotion } from "framer-motion";

const W = 168;
const H = 104;
const SAMPLES = 14;

/** Height of one band. The Bundesflagge is three equal horizontal bands. */
const BAND = H / 3;

/**
 * The vertical displacement of the cloth at `x`, for a given phase.
 *
 * Two sine terms at different frequencies, because a single sine reads as a
 * corrugated roof. The `(x / W)` factor pins the hoist edge to the pole.
 */
function wave(x: number, phase: number, amp: number): number {
  const t = x / W;
  return (Math.sin(t * Math.PI * 2.1 + phase) * 0.7 + Math.sin(t * Math.PI * 3.6 + phase * 1.4) * 0.3) * amp * t;
}

/** One horizontal band as a closed path, rippled. */
function bandPath(top: number, bottom: number, phase: number, amp: number): string {
  const forward: string[] = [];
  const back: string[] = [];

  for (let i = 0; i <= SAMPLES; i += 1) {
    const x = (i / SAMPLES) * W;
    const lift = wave(x, phase, amp);
    forward.push(`${i === 0 ? "M" : "L"}${x.toFixed(2)} ${(top + lift).toFixed(2)}`);
    back.unshift(`L${x.toFixed(2)} ${(bottom + lift).toFixed(2)}`);
  }

  return `${forward.join(" ")} ${back.join(" ")} Z`;
}

/** The whole cloth, used for the fold-shading clip. */
function clothPath(phase: number, amp: number): string {
  return bandPath(0, H, phase, amp);
}

const PHASES = [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2, Math.PI * 2];

function keyframes(top: number, bottom: number, amp: number): string[] {
  return PHASES.map((phase) => bandPath(top, bottom, phase, amp));
}

export default function GermanFlag({
  className = "",
  /** How hard the wind is blowing. 0 stills it entirely. */
  amplitude = 9,
  /** Seconds for one full ripple. Slower reads as heavier, more expensive cloth. */
  period = 4.2,
  /** The flag alone, no pole — for a header or a chip. */
  pole = true,
}: {
  className?: string;
  amplitude?: number;
  period?: number;
  pole?: boolean;
}) {
  const reduced = useReducedMotion() ?? false;
  const amp = reduced ? 3 : amplitude;

  // The flag flies at the end of the road AND in the header chip AND in the
  // goal picker. Two of these on one page with hardcoded ids means the second
  // one silently borrows the first one's clip path and disappears.
  const uid = useId().replace(/:/g, "");
  const id = (name: string) => `${name}-${uid}`;

  const bands = [
    { top: 0, bottom: BAND, fill: "#000000" },
    { top: BAND, bottom: BAND * 2, fill: "#DD0000" },
    { top: BAND * 2, bottom: H, fill: "#FFCE00" },
  ];

  const loop = {
    duration: period,
    repeat: Infinity,
    ease: "easeInOut" as const,
    times: [0, 0.25, 0.5, 0.75, 1],
  };

  const cloth = (
    <>
      <defs>
        {/*
          The folds. A band of highlight and a band of shadow that slide across
          the cloth; without them the flag is three flat colours in a wavy
          outline and the eye reads it as paper.
        */}
        <linearGradient id={id("flag-folds")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="14%" stopColor="#ffffff" stopOpacity="0.30" />
          <stop offset="30%" stopColor="#000000" stopOpacity="0.22" />
          <stop offset="46%" stopColor="#ffffff" stopOpacity="0.24" />
          <stop offset="62%" stopColor="#000000" stopOpacity="0.20" />
          <stop offset="80%" stopColor="#ffffff" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.12" />
        </linearGradient>

        {/* The cloth is thin: the hoist edge sits in the pole's own shadow. */}
        <linearGradient id={id("flag-hoist")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#000000" stopOpacity="0.35" />
          <stop offset="12%" stopColor="#000000" stopOpacity="0" />
        </linearGradient>

        <clipPath id={id("flag-cloth-clip")} clipPathUnits="userSpaceOnUse">
          <motion.path
            d={clothPath(0, amp)}
            animate={reduced ? undefined : { d: keyframes(0, H, amp) }}
            transition={loop}
          />
        </clipPath>

        <filter id={id("flag-shadow")} x="-20%" y="-20%" width="150%" height="150%">
          <feDropShadow dx="3" dy="6" stdDeviation="5" floodColor="#0b1220" floodOpacity="0.35" />
        </filter>
      </defs>

      <g filter={`url(#${id("flag-shadow")})`}>
        {bands.map((band) => (
          <motion.path
            key={band.fill}
            d={bandPath(band.top, band.bottom, 0, amp)}
            fill={band.fill}
            animate={reduced ? undefined : { d: keyframes(band.top, band.bottom, amp) }}
            transition={loop}
          />
        ))}

        {/* Folds, clipped to the cloth and sliding across it. The rect is wider
            than the flag so the gradient never runs out at either edge. */}
        <g clipPath={`url(#${id("flag-cloth-clip")})`}>
          <motion.rect
            x={-W * 0.6}
            y={-amp * 2}
            width={W * 1.6}
            height={H + amp * 4}
            fill={`url(#${id("flag-folds")})`}
            animate={reduced ? undefined : { x: [-W * 0.6, 0, -W * 0.6] }}
            transition={{ duration: period * 1.6, repeat: Infinity, ease: "easeInOut" }}
          />
          <rect x={0} y={-amp * 2} width={W} height={H + amp * 4} fill={`url(#${id("flag-hoist")})`} />
        </g>
      </g>
    </>
  );

  if (!pole) {
    return (
      <svg
        viewBox={`0 ${-amp} ${W} ${H + amp * 2}`}
        className={className}
        role="img"
        aria-label="The German flag"
      >
        {cloth}
      </svg>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${W + 26} ${H + 96}`}
      className={className}
      role="img"
      aria-label="The German flag, flying"
    >
      <defs>
        <linearGradient id={id("flag-pole")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#6b7280" />
          <stop offset="35%" stopColor="#e5e7eb" />
          <stop offset="70%" stopColor="#9ca3af" />
          <stop offset="100%" stopColor="#4b5563" />
        </linearGradient>
        <radialGradient id={id("flag-finial")} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="100%" stopColor="#b45309" />
        </radialGradient>
      </defs>

      {/* The pole is planted, so it gets a contact shadow on the ground. */}
      <ellipse cx="14" cy={H + 92} rx="20" ry="5" fill="#0b1220" opacity="0.25" />
      <rect x="10" y="14" width="8" height={H + 78} rx="4" fill={`url(#${id("flag-pole")})`} />
      <circle cx="14" cy="10" r="7" fill={`url(#${id("flag-finial")})`} />

      <g transform="translate(18, 22)">{cloth}</g>
    </svg>
  );
}
