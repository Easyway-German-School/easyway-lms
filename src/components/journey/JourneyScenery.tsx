"use client";

/**
 * The world the road runs through.
 *
 * Everything here is DRAWN, not imported. A map that waits on artwork is a map
 * that ships as a broken-image icon on somebody's dashboard the day a file gets
 * renamed — the printed poster (`JourneyMapPoster`) already has that dependency
 * and it is exactly why that component has to probe for its own file before it
 * dares render. This one has no assets and cannot break that way.
 *
 * THE 3D IS LIGHTING, NOT GEOMETRY. There is no WebGL here and there should not
 * be. Every solid gets a lit face and a shadow face with the light coming from
 * the upper left, a contact shadow on the ground, and a size that shrinks with
 * distance up the map. That is how the games this is modelled on do it too —
 * what reads as "3D" to a person looking at a phone is consistent lighting and
 * consistent perspective, not vertices. A real 3D scene would cost a megabyte,
 * drop frames on the mid-range Androids most of this school's students use, and
 * look worse.
 *
 * Every landmark is a real place a student might actually stand in front of:
 * the Brandenburg Gate, a Bavarian castle, Cologne cathedral, the Berlin
 * television tower. Generic "European building" shapes would be safer to draw
 * and would mean nothing to anybody.
 */

import { useId } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { SceneryKind } from "@/lib/germany-goals";

export type ScenePalette = {
  /** The face the light hits. */
  light: string;
  /** The face turned away from it. */
  dark: string;
  /** Roofs, doors, flags — the one saturated colour per building. */
  accent: string;
  /** Contact shadows on the ground. */
  shadow: string;
};

/**
 * A palette built from the goal's hue.
 *
 * Lightness is fixed rather than themed on purpose: these are objects in a
 * lit scene, and a castle that turns dark grey in Nacht is a castle at night
 * standing in a daylit field. The SKY is themed (see JourneyWorld); the things
 * standing in it keep their own colour, exactly as they would in a photograph.
 */
export function paletteFor(hue: number): ScenePalette {
  return {
    light: `hsl(${hue} 24% 82%)`,
    dark: `hsl(${hue} 22% 66%)`,
    accent: `hsl(${(hue + 190) % 360} 62% 58%)`,
    shadow: `hsl(${hue} 30% 34%)`,
  };
}

/* -------------------------------------------------------------------------- */
/* Landmarks                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Each landmark draws inside a 120x100 box standing on y=94, so they line up
 * along a common ground line whatever mix a goal asks for.
 */
function art(kind: SceneryKind, p: ScenePalette) {
  switch (kind) {
    /* The Brandenburg Gate. Six columns, a quadriga on top. */
    case "gate":
      return (
        <>
          <rect x="16" y="30" width="88" height="8" fill={p.light} />
          <rect x="16" y="38" width="88" height="4" fill={p.dark} />
          {[22, 36, 50, 64, 78, 92].map((x) => (
            <g key={x}>
              <rect x={x} y="42" width="7" height="48" fill={p.light} />
              <rect x={x + 5} y="42" width="2" height="48" fill={p.dark} />
            </g>
          ))}
          <rect x="12" y="90" width="96" height="6" fill={p.dark} />
          {/* Quadriga: a chariot and four horses, at this size a silhouette. */}
          <rect x="48" y="20" width="24" height="10" fill={p.dark} />
          <path d="M50 20c2-6 6-8 10-8s8 2 10 8z" fill={p.accent} />
        </>
      );

    /* Neuschwanstein: the castle every picture of Germany has on it. */
    case "castle":
      return (
        <>
          <path d="M28 92V52l10-12 10 12v40z" fill={p.light} />
          <path d="M38 40l10 12v40h-6V52z" fill={p.dark} />
          <path d="M56 92V38l14-18 14 18v54z" fill={p.light} />
          <path d="M70 20l14 18v54h-8V38z" fill={p.dark} />
          <path d="M34 40l4-14 4 14z" fill={p.accent} />
          <path d="M64 20l6-16 6 16z" fill={p.accent} />
          <path d="M84 46l4-12 4 12z" fill={p.accent} />
          <rect x="84" y="46" width="8" height="46" fill={p.light} />
          <rect x="44" y="66" width="6" height="14" rx="3" fill={p.shadow} opacity="0.5" />
          <rect x="66" y="52" width="6" height="14" rx="3" fill={p.shadow} opacity="0.5" />
          <rect x="20" y="90" width="80" height="6" fill={p.dark} />
        </>
      );

    /* Cologne cathedral: two spires, and the rose window between them. */
    case "cathedral":
      return (
        <>
          <path d="M36 92V34l8-24 8 24v58z" fill={p.light} />
          <path d="M44 10l8 24v58h-5V34z" fill={p.dark} />
          <path d="M68 92V34l8-24 8 24v58z" fill={p.light} />
          <path d="M76 10l8 24v58h-5V34z" fill={p.dark} />
          <rect x="52" y="48" width="16" height="44" fill={p.light} />
          <circle cx="60" cy="60" r="6" fill={p.accent} />
          <path d="M54 92V78a6 6 0 0 1 12 0v14z" fill={p.shadow} opacity="0.55" />
          <rect x="30" y="90" width="60" height="6" fill={p.dark} />
        </>
      );

    /* The Berlin Fernsehturm. */
    case "tower":
      return (
        <>
          <path d="M56 92 58 46h4l2 46z" fill={p.light} />
          <path d="M62 46h2l2 46h-4z" fill={p.dark} />
          <circle cx="60" cy="40" r="12" fill={p.light} />
          <path d="M60 28a12 12 0 0 1 0 24z" fill={p.dark} />
          <circle cx="56" cy="36" r="3" fill={p.accent} />
          <path d="M60 28V10" stroke={p.dark} strokeWidth="3" />
          <circle cx="60" cy="8" r="3" fill={p.accent} />
          <rect x="44" y="90" width="32" height="6" fill={p.dark} />
        </>
      );

    /* A university: a portico and a clock. */
    case "campus":
      return (
        <>
          <rect x="20" y="46" width="80" height="46" fill={p.light} />
          <rect x="20" y="46" width="80" height="6" fill={p.dark} />
          <path d="M16 46 60 22l44 24z" fill={p.accent} />
          {[28, 44, 60, 76, 90].map((x) => (
            <rect key={x} x={x} y="56" width="6" height="36" fill={p.dark} opacity="0.45" />
          ))}
          <circle cx="60" cy="38" r="7" fill={p.light} />
          <path d="M60 34v4l3 2" stroke={p.shadow} strokeWidth="1.6" fill="none" />
          <rect x="14" y="90" width="92" height="6" fill={p.dark} />
        </>
      );

    /* A hospital. The cross is the only universally read symbol on this map. */
    case "clinic":
      return (
        <>
          <rect x="26" y="38" width="68" height="54" fill={p.light} />
          <rect x="26" y="38" width="68" height="7" fill={p.dark} />
          <rect x="82" y="38" width="12" height="54" fill={p.dark} opacity="0.5" />
          {[34, 48, 62].map((x) =>
            [52, 66, 80].map((y) => (
              <rect key={`${x}-${y}`} x={x} y={y} width="9" height="8" rx="1.5" fill={p.accent} opacity="0.55" />
            )),
          )}
          <rect x="54" y="22" width="12" height="16" fill={p.light} />
          <path d="M57 24h6v4h4v6h-4v4h-6v-4h-4v-6h4z" fill="#dc2626" />
          <rect x="20" y="90" width="80" height="6" fill={p.dark} />
        </>
      );

    /* A workshop — the Ausbildung road. Saw-tooth roof, like a real Werkstatt. */
    case "workshop":
      return (
        <>
          <rect x="20" y="52" width="80" height="40" fill={p.light} />
          {[20, 40, 60, 80].map((x) => (
            <path key={x} d={`M${x} 52v-12l20 12z`} fill={p.accent} />
          ))}
          <rect x="20" y="52" width="80" height="4" fill={p.dark} />
          <rect x="34" y="66" width="18" height="26" fill={p.shadow} opacity="0.5" />
          <rect x="62" y="64" width="24" height="14" rx="2" fill={p.dark} opacity="0.5" />
          <rect x="14" y="90" width="92" height="6" fill={p.dark} />
        </>
      );

    /* One house. The family and settling roads end at a door, not a skyline. */
    case "home":
      return (
        <>
          <rect x="34" y="54" width="52" height="38" fill={p.light} />
          <path d="M28 54 60 30l32 24z" fill={p.accent} />
          <path d="M60 30l32 24H60z" fill={p.accent} opacity="0.75" />
          <rect x="54" y="70" width="14" height="22" rx="1.5" fill={p.shadow} opacity="0.65" />
          <rect x="40" y="62" width="10" height="10" rx="1.5" fill={p.dark} />
          <rect x="72" y="62" width="10" height="10" rx="1.5" fill={p.dark} />
          <rect x="76" y="34" width="7" height="14" fill={p.dark} />
          <rect x="26" y="90" width="68" height="6" fill={p.dark} />
        </>
      );

    /* A German street: gabled townhouses shoulder to shoulder. */
    case "houses":
      return (
        <>
          {[
            { x: 16, w: 26, h: 44, gable: 14 },
            { x: 44, w: 30, h: 54, gable: 18 },
            { x: 76, w: 26, h: 38, gable: 12 },
          ].map((house) => (
            <g key={house.x}>
              <rect x={house.x} y={92 - house.h} width={house.w} height={house.h} fill={p.light} />
              <path
                d={`M${house.x - 3} ${92 - house.h} ${house.x + house.w / 2} ${92 - house.h - house.gable} ${house.x + house.w + 3} ${92 - house.h}z`}
                fill={p.accent}
              />
              <rect
                x={house.x + house.w - 8}
                y={92 - house.h}
                width="8"
                height={house.h}
                fill={p.dark}
                opacity="0.5"
              />
              <rect x={house.x + 5} y={92 - house.h + 12} width="7" height="8" fill={p.dark} />
              <rect x={house.x + 5} y={92 - house.h + 26} width="7" height="8" fill={p.dark} />
            </g>
          ))}
          <rect x="10" y="90" width="100" height="6" fill={p.dark} />
        </>
      );

    /* Wind turbines. Genuinely what the drive in from a German airport looks like. */
    case "turbines":
      return (
        <>
          {[
            { x: 34, s: 1 },
            { x: 74, s: 0.72 },
          ].map((t) => (
            <g key={t.x} transform={`translate(${t.x} 92) scale(${t.s}) translate(${-t.x} -92)`}>
              <path d={`M${t.x - 3} 92 ${t.x - 1.5} 40h3L${t.x + 3} 92z`} fill={p.light} />
              <circle cx={t.x} cy="38" r="3.5" fill={p.dark} />
              <path d={`M${t.x} 38 ${t.x} 12`} stroke={p.light} strokeWidth="3.5" strokeLinecap="round" />
              <path d={`M${t.x} 38 ${t.x + 22} 50`} stroke={p.light} strokeWidth="3.5" strokeLinecap="round" />
              <path d={`M${t.x} 38 ${t.x - 22} 50`} stroke={p.light} strokeWidth="3.5" strokeLinecap="round" />
            </g>
          ))}
          <rect x="14" y="90" width="92" height="6" fill={p.dark} />
        </>
      );

    /* Black Forest pines. */
    case "forest":
      return (
        <>
          {[
            { x: 26, h: 46 },
            { x: 48, h: 62 },
            { x: 72, h: 40 },
            { x: 92, h: 52 },
          ].map((tree) => (
            <g key={tree.x}>
              <rect x={tree.x - 2.5} y={92 - tree.h * 0.22} width="5" height={tree.h * 0.22} fill={p.shadow} />
              <path
                d={`M${tree.x} ${92 - tree.h} ${tree.x + tree.h * 0.3} ${92 - tree.h * 0.2} ${tree.x - tree.h * 0.3} ${92 - tree.h * 0.2}z`}
                fill={p.dark}
              />
              <path
                d={`M${tree.x} ${92 - tree.h} ${tree.x + tree.h * 0.3} ${92 - tree.h * 0.2} ${tree.x} ${92 - tree.h * 0.2}z`}
                fill={p.shadow}
                opacity="0.35"
              />
            </g>
          ))}
          <rect x="14" y="90" width="94" height="6" fill={p.dark} />
        </>
      );

    /* The Alps on the horizon. */
    case "alps":
    default:
      return (
        <>
          <path d="M6 92 40 30l22 30 16-20 30 52z" fill={p.dark} />
          <path d="M40 30 62 60 46 60z" fill="#ffffff" opacity="0.85" />
          <path d="M78 40 96 68 86 68z" fill="#ffffff" opacity="0.8" />
          <path d="M6 92 40 30l10 14L20 92z" fill={p.light} opacity="0.55" />
        </>
      );
  }
}

export function Landmark({
  kind,
  palette,
  className = "",
  style,
  /** How far away it is: scales it down and washes it out. 0 near, 1 far. */
  depth = 0,
}: {
  kind: SceneryKind;
  palette: ScenePalette;
  className?: string;
  style?: React.CSSProperties;
  depth?: number;
}) {
  const d = Math.max(0, Math.min(1, depth));
  return (
    <svg
      viewBox="0 0 120 100"
      className={`pointer-events-none absolute select-none ${className}`}
      aria-hidden
      style={{
        ...style,
        // Atmospheric perspective: distant things lose contrast before they
        // lose size. Without this the far landmarks read as small near ones.
        opacity: 1 - d * 0.55,
        filter: d > 0.35 ? `saturate(${(1 - d * 0.6).toFixed(2)}) blur(${(d * 1.4).toFixed(1)}px)` : undefined,
      }}
    >
      {art(kind, palette)}
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* The sky                                                                    */
/* -------------------------------------------------------------------------- */

/** A cloud that drifts across and wraps round. */
export function Cloud({
  className = "",
  duration = 60,
  delay = 0,
  opacity = 0.75,
}: {
  className?: string;
  duration?: number;
  delay?: number;
  opacity?: number;
}) {
  const reduced = useReducedMotion() ?? false;
  return (
    <motion.svg
      viewBox="0 0 120 46"
      aria-hidden
      className={`pointer-events-none absolute select-none ${className}`}
      style={{ opacity }}
      // `left`, not `x`. A percentage in `x` is a percentage of the CLOUD, so
      // a 160px cloud animated to `x: 130%` travels 208px and parks halfway
      // across the sky. `left` is a percentage of the map.
      initial={{ left: "-18%" }}
      animate={reduced ? undefined : { left: ["-18%", "108%"] }}
      transition={{ duration, delay, repeat: Infinity, ease: "linear" }}
    >
      <g fill="#ffffff">
        <ellipse cx="34" cy="30" rx="24" ry="14" />
        <ellipse cx="58" cy="22" rx="20" ry="17" />
        <ellipse cx="82" cy="30" rx="22" ry="13" />
        <rect x="26" y="30" width="66" height="12" rx="6" />
      </g>
      {/* Clouds are lit from above; the underside is where they read as solid. */}
      <rect x="26" y="36" width="66" height="6" rx="3" fill="#cbd5e1" opacity="0.55" />
    </motion.svg>
  );
}

/**
 * The plane.
 *
 * Crosses the sky every so often, trailing a dotted line. It is the most
 * on-the-nose thing in the whole map and it stays: a student two months from an
 * embassy appointment does not need subtlety, they need the aeroplane.
 */
export function CrossingPlane({ className = "" }: { className?: string }) {
  const reduced = useReducedMotion() ?? false;
  if (reduced) return null;

  return (
    <motion.svg
      viewBox="0 0 160 40"
      aria-hidden
      className={`pointer-events-none absolute select-none ${className}`}
      initial={{ left: "-30%", opacity: 0 }}
      animate={{ left: ["-30%", "115%"], opacity: [0, 0.85, 0.85, 0] }}
      transition={{ duration: 22, repeat: Infinity, repeatDelay: 16, ease: "linear", times: [0, 0.12, 0.8, 1] }}
    >
      <path
        d="M6 24h96"
        stroke="#ffffff"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="2 9"
        opacity="0.7"
      />
      <g transform="translate(104 12)">
        <path d="M2 12 30 6l10-4-6 10 12 2-12 2 6 10-10-4L2 16z" fill="#ffffff" />
        <path d="M2 12 30 6l4 6-4 6z" fill="#cbd5e1" />
      </g>
    </motion.svg>
  );
}

/** Two birds, because an empty sky is a poster and a sky with birds is a place. */
export function Birds({ className = "" }: { className?: string }) {
  const reduced = useReducedMotion() ?? false;
  return (
    <motion.svg
      viewBox="0 0 60 30"
      aria-hidden
      className={`pointer-events-none absolute select-none ${className}`}
      initial={{ x: 0 }}
      animate={reduced ? undefined : { x: [0, 26, 0], y: [0, -6, 0] }}
      transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      fill="none"
    >
      <motion.path
        d="M6 14q6-6 11 0"
        animate={reduced ? undefined : { d: ["M6 14q6-6 11 0", "M6 12q6 5 11 0", "M6 14q6-6 11 0"] }}
        transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.path
        d="M17 14q5-5 9 0"
        animate={reduced ? undefined : { d: ["M17 14q5-5 9 0", "M17 12q5 4 9 0", "M17 14q5-5 9 0"] }}
        transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut", delay: 0.22 }}
      />
      <motion.path
        d="M32 9q4-4 8 0"
        animate={reduced ? undefined : { d: ["M32 9q4-4 8 0", "M32 8q4 3 8 0", "M32 9q4-4 8 0"] }}
        transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut", delay: 0.45 }}
      />
    </motion.svg>
  );
}

/**
 * The sun, which becomes the moon.
 *
 * Tied to how far along the road they are, so late in the journey the map is
 * lit like an evening — the reward nobody has to be told about. Same idea as
 * the sky gradient, one layer closer to the eye.
 */
export function SkyLight({ percent, className = "" }: { percent: number; className?: string }) {
  const uid = useId().replace(/:/g, "");
  const p = Math.max(0, Math.min(100, percent)) / 100;
  const warm = `hsl(${(52 - p * 34).toFixed(0)} 96% ${(72 - p * 12).toFixed(0)}%)`;

  return (
    <svg viewBox="0 0 100 100" aria-hidden className={`pointer-events-none absolute select-none ${className}`}>
      <defs>
        <radialGradient id={`sun-${uid}`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor={warm} stopOpacity="1" />
          <stop offset="42%" stopColor={warm} stopOpacity="0.85" />
          <stop offset="100%" stopColor={warm} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="50" fill={`url(#sun-${uid})`} />
      <circle cx="50" cy="50" r="21" fill={warm} />
    </svg>
  );
}
