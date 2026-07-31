"use client";

import { motion, useReducedMotion } from "framer-motion";

/**
 * The little scholar from the school crest, as a tour guide.
 *
 * TuitionMascot is the same character sitting still and pointing right. This
 * one has to point in whatever direction the thing it is talking about happens
 * to be, and has to survive being 96px tall on a phone, so it is drawn smaller
 * and simpler: no book, shorter robe, and one arm that swings anywhere.
 *
 * `angle` is degrees clockwise from pointing right, matching how the tour
 * computes the bearing from the mascot to the highlighted element. `walking`
 * is used while it moves between steps — a little bob and a lean, enough to
 * read as travel rather than teleporting.
 */
export default function TourGuide({
  angle = 0,
  walking = false,
  celebrating = false,
  className = "",
}: {
  angle?: number;
  walking?: boolean;
  celebrating?: boolean;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();

  const bob = reduceMotion
    ? {}
    : celebrating
      ? { y: [0, -18, 0, -10, 0], transition: { duration: 1.1, ease: "easeOut" as const } }
      : walking
        ? { y: [0, -5, 0], transition: { duration: 0.45, repeat: Infinity, ease: "easeInOut" as const } }
        : { y: [0, -6, 0], transition: { duration: 2.8, repeat: Infinity, ease: "easeInOut" as const } };

  return (
    <motion.svg
      viewBox="0 0 200 210"
      className={className}
      role="img"
      aria-label="Your guide, pointing at the next thing to look at"
      animate={bob}
    >
      <defs>
        <linearGradient id="guide-robe" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#12939a" />
          <stop offset="100%" stopColor="#0D7C7E" />
        </linearGradient>
        <linearGradient id="guide-cap" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ff8534" />
          <stop offset="100%" stopColor="#FF6600" />
        </linearGradient>
        <radialGradient id="guide-skin" cx="0.38" cy="0.32" r="0.78">
          <stop offset="0%" stopColor="#ffe0bd" />
          <stop offset="100%" stopColor="#f6c99f" />
        </radialGradient>
        <filter id="guide-shadow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#020617" floodOpacity="0.4" />
        </filter>
      </defs>

      <ellipse cx="96" cy="200" rx="40" ry="7" fill="#020617" opacity="0.25" />

      <g filter="url(#guide-shadow)">
        {/* Legs, so it reads as a character with somewhere to walk to */}
        <motion.g
          animate={
            reduceMotion || !walking
              ? {}
              : { rotate: [-9, 9, -9] }
          }
          transition={{ duration: 0.45, repeat: Infinity, ease: "easeInOut" }}
          style={{ originX: "96px", originY: "168px" }}
        >
          <path d="M84 168v22" stroke="url(#guide-robe)" strokeWidth="12" strokeLinecap="round" />
          <path d="M108 168v22" stroke="url(#guide-robe)" strokeWidth="12" strokeLinecap="round" />
        </motion.g>

        {/* Robe */}
        <path d="M62 178c0-38 7-62 17-72h34c10 10 17 34 17 72z" fill="url(#guide-robe)" />

        {/* Resting arm */}
        <path
          d="M72 122c-10 7-13 21-10 35"
          stroke="url(#guide-robe)"
          strokeWidth="14"
          strokeLinecap="round"
          fill="none"
        />

        {/* Pointing arm. Rotates about the shoulder, so it reads as a shoulder
            movement rather than the sleeve sliding across the body. */}
        <motion.g
          style={{ originX: "120px", originY: "122px" }}
          animate={{ rotate: celebrating ? -75 : angle }}
          transition={{ type: "spring", stiffness: 140, damping: 14 }}
        >
          <path
            d="M120 122c22 0 37-2 49-5"
            stroke="url(#guide-robe)"
            strokeWidth="14"
            strokeLinecap="round"
            fill="none"
          />
          <circle cx="173" cy="116" r="11" fill="url(#guide-skin)" />
          <path d="M182 114h14" stroke="url(#guide-skin)" strokeWidth="7" strokeLinecap="round" />
        </motion.g>

        {/* Head */}
        <circle cx="96" cy="88" r="32" fill="url(#guide-skin)" />

        <motion.g
          animate={reduceMotion ? {} : { scaleY: [1, 1, 0.1, 1] }}
          transition={{ duration: 4.5, repeat: Infinity, times: [0, 0.9, 0.94, 1] }}
          style={{ originX: "96px", originY: "86px" }}
        >
          <circle cx="85" cy="86" r="4" fill="#1f2937" />
          <circle cx="107" cy="86" r="4" fill="#1f2937" />
        </motion.g>

        <path
          d={celebrating ? "M86 100q10 12 20 0" : "M87 101q9 7 18 0"}
          stroke="#1f2937"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />

        {/* Mortarboard */}
        <path d="M96 36 156 60l-60 24-60-24z" fill="url(#guide-cap)" />
        <path d="M74 68v13c0 7 10 11 22 11s22-4 22-11V68l-22 8z" fill="#e65c00" />
        <path d="M151 62v23" stroke="#e65c00" strokeWidth="3.5" strokeLinecap="round" />
        <motion.circle
          cx="151"
          cy="89"
          r="6"
          fill="#ffb066"
          animate={reduceMotion ? {} : { x: [0, 4, 0], rotate: [0, 8, 0] }}
          transition={{ duration: walking ? 0.45 : 2.8, repeat: Infinity, ease: "easeInOut", delay: 0.2 }}
        />
      </g>
    </motion.svg>
  );
}
