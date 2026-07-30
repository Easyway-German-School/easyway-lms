"use client";

import { motion, useReducedMotion } from "framer-motion";

/**
 * The little scholar from the school crest, animated.
 *
 * The logo already has two tan-headed figures in teal robes flanking the globe,
 * so the mascot is drawn as one of them stepping forward rather than as a new
 * character — same tan head, same teal body, same orange cap.
 *
 * `pointing` swings the arm out towards whatever sits to its right. The arm is
 * its own <g> with an explicit transform origin on the shoulder joint, so the
 * rotation reads as a shoulder movement instead of the whole sleeve sliding.
 */
export default function TuitionMascot({
  pointing = false,
  className = "",
}: {
  pointing?: boolean;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();

  const idle = reduceMotion
    ? {}
    : { y: [0, -7, 0], transition: { duration: 3.2, repeat: Infinity, ease: "easeInOut" as const } };

  return (
    <motion.svg
      viewBox="0 0 250 260"
      className={className}
      role="img"
      aria-label="A small scholar pointing at the tuition message"
      animate={idle}
    >
      <defs>
        <linearGradient id="mascot-robe" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#12939a" />
          <stop offset="100%" stopColor="#0D7C7E" />
        </linearGradient>
        <linearGradient id="mascot-cap" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ff8534" />
          <stop offset="100%" stopColor="#FF6600" />
        </linearGradient>
        <radialGradient id="mascot-skin" cx="0.38" cy="0.32" r="0.78">
          <stop offset="0%" stopColor="#ffe0bd" />
          <stop offset="100%" stopColor="#f6c99f" />
        </radialGradient>
        <filter id="mascot-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="8" stdDeviation="10" floodColor="#020617" floodOpacity="0.35" />
        </filter>
      </defs>

      <ellipse cx="110" cy="246" rx="52" ry="9" fill="#020617" opacity="0.28" />

      <g filter="url(#mascot-shadow)">
        {/* Robe */}
        <path
          d="M62 246c0-46 8-78 20-92h56c12 14 20 46 20 92z"
          fill="url(#mascot-robe)"
        />
        {/* Open book held against the robe, as on the crest */}
        <path d="M78 196h64l-6 26H84z" fill="#f6d9ae" />
        <path d="M110 196v26" stroke="#c9a874" strokeWidth="3" />

        {/* Resting arm */}
        <path
          d="M78 158c-12 8-16 26-12 44"
          stroke="url(#mascot-robe)"
          strokeWidth="17"
          strokeLinecap="round"
          fill="none"
        />

        {/* Pointing arm — rotates about the shoulder at (142,158) */}
        <motion.g
          style={{ originX: "142px", originY: "158px" }}
          initial={{ rotate: 46 }}
          animate={
            pointing
              ? reduceMotion
                ? { rotate: -6 }
                : { rotate: [46, -14, -2, -8] }
              : { rotate: 46 }
          }
          transition={
            pointing
              ? { duration: 0.9, times: [0, 0.45, 0.75, 1], ease: "backOut" }
              : { type: "spring", stiffness: 120, damping: 14 }
          }
        >
          {/* Long enough to read as a deliberate point rather than a shrug */}
          <path
            d="M142 158c26 0 44-2 58-6"
            stroke="url(#mascot-robe)"
            strokeWidth="17"
            strokeLinecap="round"
            fill="none"
          />
          {/* Hand with the index finger extended */}
          <circle cx="203" cy="151" r="13" fill="url(#mascot-skin)" />
          <path
            d="M214 149h26"
            stroke="url(#mascot-skin)"
            strokeWidth="8"
            strokeLinecap="round"
          />
        </motion.g>

        {/* Head */}
        <circle cx="110" cy="120" r="38" fill="url(#mascot-skin)" />

        {/* Eyes — blink on a loop */}
        <motion.g
          animate={reduceMotion ? {} : { scaleY: [1, 1, 0.1, 1] }}
          transition={{ duration: 4, repeat: Infinity, times: [0, 0.9, 0.94, 1] }}
          style={{ originX: "110px", originY: "118px" }}
        >
          <circle cx="97" cy="118" r="4.6" fill="#1f2937" />
          <circle cx="123" cy="118" r="4.6" fill="#1f2937" />
        </motion.g>

        {/* Encouraging half smile */}
        <path
          d="M100 136q10 8 20 0"
          stroke="#1f2937"
          strokeWidth="3.4"
          strokeLinecap="round"
          fill="none"
        />

        {/* Mortarboard */}
        <path d="M110 60L182 88l-72 28-72-28z" fill="url(#mascot-cap)" />
        <path d="M84 98v16c0 8 12 13 26 13s26-5 26-13V98l-26 10z" fill="#e65c00" />
        <path
          d="M176 91v28"
          stroke="#e65c00"
          strokeWidth="4"
          strokeLinecap="round"
        />
        {/* Tassel swings a beat behind the body */}
        <motion.circle
          cx="176"
          cy="124"
          r="7"
          fill="#ffb066"
          animate={reduceMotion ? {} : { x: [0, 5, 0], rotate: [0, 8, 0] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut", delay: 0.25 }}
        />
      </g>
    </motion.svg>
  );
}
