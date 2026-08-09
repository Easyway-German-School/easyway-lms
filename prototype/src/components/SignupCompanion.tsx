"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

/**
 * DJINN — the enrolment companion.
 *
 * ---------------------------------------------------------------------------
 * WHY A NEW CHARACTER, AND WHY THIS ONE
 *
 * The scholar from the school crest (TourGuide) is the right character for the
 * portal: it points at things, it walks between them, and it stops when you
 * have arrived. It is also, deliberately, a blank — no eyes to speak of, no
 * mouth, no reaction. That is fine when its job is "look over there".
 *
 * Signup is a different job. Nobody needs anything pointed at during a form;
 * what they need is the feeling that somebody is on the other side of it. A
 * face is the cheapest way to produce that feeling and there is no substitute
 * for it — a character that cannot react is scenery, and scenery does not make
 * anyone finish a form.
 *
 * So this one is a djinn: it FLOATS. That is not decoration either. A form is a
 * stack of fields and a character with legs has to stand on one of them, which
 * is why the crest scholar always looks like it is standing on the page rather
 * than in it. A being of smoke has no such problem — it can hover beside the
 * question you are answering, drift when you move, and its tail can curl into
 * the space a pair of feet would have had to awkwardly occupy.
 *
 * The brand is carried in the palette (the crest's teal and orange, nothing
 * else), the mortarboard it borrowed from the scholar, and the gold band at its
 * waist. It reads as related to the crest character without being it.
 *
 * ---------------------------------------------------------------------------
 * THE FACE
 *
 * Five expressions, and the restraint is the point. A character that mugs at
 * every keystroke is exhausting inside thirty seconds, and this one has to
 * survive four minutes of somebody typing their address. So it is calm by
 * default and reacts only to things that actually happened:
 *
 *   greeting    arriving, and at the top of the form. Open, a little raised.
 *   thinking    while a step is incomplete. Eyes off to one side, small mouth.
 *   pleased     a step just cleared. The one genuinely warm expression.
 *   cheering    the final step. Wide, both arms up.
 *   concerned   something went wrong. NOT sad — attentive. A mascot that looks
 *               devastated when you mistype an email is emotional blackmail.
 *
 * Everything is drawn from parts that morph rather than swapped as whole faces,
 * so an expression change is a face MOVING. Cutting between two static faces
 * reads as a slideshow of a character rather than a character.
 *
 * Blinks and eye drift run on their own clocks, unrelated to the expression, so
 * the idle state is never quite still — a face that holds perfectly still
 * between events looks switched off.
 *
 * All of it collapses under `prefers-reduced-motion`: it keeps the face and
 * loses the float, the blink and the sparkles.
 */

export type CompanionMood = "greeting" | "thinking" | "pleased" | "cheering" | "concerned";

/** The mouth, as a path per mood. Morphed between, never swapped. */
const MOUTH: Record<CompanionMood, string> = {
  // A soft open smile.
  greeting: "M84 118 q16 14 32 0 q-16 6 -32 0Z",
  // Small, off to one side — the face of somebody waiting for you to finish.
  thinking: "M92 119 q10 4 18 -1 q-9 6 -18 1Z",
  // Wider, fuller. The warm one.
  pleased: "M80 116 q20 20 40 0 q-20 11 -40 0Z",
  // Open. A shout, not a grin.
  cheering: "M82 114 q18 26 36 0 q-8 20 -36 0Z",
  // Flat and level. Attentive, not miserable.
  concerned: "M88 121 q12 -3 24 0 q-12 3 -24 0Z",
};

/** Eyebrow tilt in degrees, inner end. Positive lifts the inner corner. */
const BROW: Record<CompanionMood, { left: number; right: number; lift: number }> = {
  greeting: { left: -6, right: 6, lift: -2 },
  thinking: { left: -14, right: 4, lift: 0 },
  pleased: { left: -8, right: 8, lift: -4 },
  cheering: { left: -12, right: 12, lift: -7 },
  concerned: { left: 12, right: -12, lift: 1 },
};

/** Where the pupils sit, as an offset from centre. */
const GAZE: Record<CompanionMood, { x: number; y: number }> = {
  greeting: { x: 0, y: 0 },
  thinking: { x: 3.5, y: -2 },
  pleased: { x: 0, y: 0.5 },
  cheering: { x: 0, y: -1.5 },
  concerned: { x: -1, y: 1 },
};

export default function SignupCompanion({
  mood = "greeting",
  className = "",
}: {
  mood?: CompanionMood;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();

  /**
   * Blinking on its own clock.
   *
   * Not a CSS animation with a fixed period: a perfectly regular blink is
   * uncanny in a way people notice without being able to say why. The interval
   * is re-randomised after each blink, between roughly two and six seconds,
   * which is close enough to a real one.
   */
  const [blinking, setBlinking] = useState(false);
  useEffect(() => {
    if (reduceMotion) return;
    let timer: number;
    const schedule = () => {
      timer = window.setTimeout(() => {
        setBlinking(true);
        window.setTimeout(() => {
          setBlinking(false);
          schedule();
        }, 130);
      }, 2200 + Math.random() * 3800);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [reduceMotion]);

  /**
   * A slow drift of the eyes around wherever the mood is pointing them.
   *
   * Real eyes make small involuntary movements constantly. Without this the
   * character looks like it is staring through you, which on a signup form
   * lands somewhere between unsettling and broken.
   */
  const [drift, setDrift] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (reduceMotion) return;
    const timer = window.setInterval(() => {
      setDrift({ x: (Math.random() - 0.5) * 2.6, y: (Math.random() - 0.5) * 1.8 });
    }, 1900);
    return () => window.clearInterval(timer);
  }, [reduceMotion]);

  const gaze = GAZE[mood];
  const brow = BROW[mood];
  const pupilX = gaze.x + drift.x;
  const pupilY = gaze.y + drift.y;

  const armsUp = mood === "cheering";

  // The whole body drifts. Slower and wider than the crest scholar's bob,
  // because this one is weightless rather than standing.
  const float = reduceMotion
    ? {}
    : {
        y: [0, -7, 0, -3, 0],
        rotate: [0, 1.2, 0, -1.2, 0],
        transition: { duration: 6.5, repeat: Infinity, ease: "easeInOut" as const },
      };

  return (
    <motion.svg
      viewBox="0 0 200 250"
      className={className}
      role="img"
      aria-label="Your enrolment guide"
      animate={float}
    >
      <defs>
        <linearGradient id="djinn-body" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0%" stopColor="#16a3a6" />
          <stop offset="55%" stopColor="#0D7C7E" />
          <stop offset="100%" stopColor="#0a5f61" />
        </linearGradient>
        <linearGradient id="djinn-tail" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0D7C7E" stopOpacity="0.95" />
          <stop offset="60%" stopColor="#0D7C7E" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#0D7C7E" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="djinn-cap" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ff9a4d" />
          <stop offset="100%" stopColor="#FF6600" />
        </linearGradient>
        <radialGradient id="djinn-face" cx="0.4" cy="0.34" r="0.8">
          <stop offset="0%" stopColor="#3fd0d3" />
          <stop offset="100%" stopColor="#12939a" />
        </radialGradient>
        <radialGradient id="djinn-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#FF6600" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#FF6600" stopOpacity="0" />
        </radialGradient>
        <filter id="djinn-soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3.2" />
        </filter>
      </defs>

      {/* The lamp-light it is rising out of. Sells "conjured" in one shape. */}
      <ellipse cx="100" cy="196" rx="72" ry="52" fill="url(#djinn-glow)" />

      {/*
        THE TAIL.
        Two curls counter-rotating on different periods, so the smoke never
        repeats a shape you can catch. A single wagging curl reads as a fish.
      */}
      <motion.g
        animate={
          reduceMotion
            ? {}
            : { rotate: [0, 4, -3, 0], x: [0, 3, -2, 0] }
        }
        transition={{ duration: 7.5, repeat: Infinity, ease: "easeInOut" }}
        style={{ originX: "100px", originY: "160px" }}
      >
        <path
          d="M84 158c-6 18-2 32 8 40 10 8 22 6 26-4 3-8-2-16-10-16-6 0-10 4-9 9"
          fill="none"
          stroke="url(#djinn-tail)"
          strokeWidth="17"
          strokeLinecap="round"
        />
      </motion.g>
      <motion.g
        animate={reduceMotion ? {} : { rotate: [0, -5, 3, 0] }}
        transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut" }}
        style={{ originX: "108px", originY: "158px" }}
      >
        <path
          d="M112 156c8 14 8 27 1 35"
          fill="none"
          stroke="url(#djinn-tail)"
          strokeWidth="11"
          strokeLinecap="round"
          opacity="0.7"
        />
      </motion.g>

      {/* Body: shoulders tapering into the smoke, no waist and no legs. */}
      <path d="M100 74c26 0 42 20 44 46 2 20-4 34-14 42-12 9-48 9-60 0-10-8-16-22-14-42 2-26 18-46 44-46Z" fill="url(#djinn-body)" />

      {/* The gold band. The one piece of jewellery, at the narrowest point. */}
      <path d="M66 150c10 7 58 7 68 0" fill="none" stroke="#FFC46B" strokeWidth="6" strokeLinecap="round" />
      <circle cx="100" cy="153" r="4.5" fill="#FF6600" />

      {/* ARMS. Folded and calm by default; both thrown up when cheering. */}
      <motion.g
        animate={{ rotate: armsUp ? -58 : 0, y: armsUp ? -6 : 0 }}
        transition={{ type: "spring", stiffness: 150, damping: 13 }}
        style={{ originX: "62px", originY: "108px" }}
      >
        <path d="M62 108c-14 6-20 18-18 30" fill="none" stroke="url(#djinn-body)" strokeWidth="15" strokeLinecap="round" />
        <circle cx="45" cy="140" r="9" fill="#12939a" />
      </motion.g>
      <motion.g
        animate={{ rotate: armsUp ? 58 : 0, y: armsUp ? -6 : 0 }}
        transition={{ type: "spring", stiffness: 150, damping: 13 }}
        style={{ originX: "138px", originY: "108px" }}
      >
        <path d="M138 108c14 6 20 18 18 30" fill="none" stroke="url(#djinn-body)" strokeWidth="15" strokeLinecap="round" />
        <circle cx="155" cy="140" r="9" fill="#12939a" />
      </motion.g>

      {/* Face plate, a shade lighter than the body so features read at 56px. */}
      <ellipse cx="100" cy="102" rx="42" ry="40" fill="url(#djinn-face)" />

      {/* EYES.
          Whites are real whites: at the size this renders in the signup header
          — about 56 pixels tall — a pupil on a coloured field is a smudge, and
          the single thing that makes a face legible when small is contrast
          between sclera and pupil. */}
      <g>
        {[80, 120].map((cx) => (
          <g key={cx}>
            <ellipse cx={cx} cy="96" rx="12" ry={blinking ? 1.4 : 13} fill="#ffffff" />
            {!blinking && (
              <>
                <motion.circle
                  cx={cx}
                  cy="97"
                  r="6.4"
                  fill="#0b3d3e"
                  animate={{ cx: cx + pupilX, cy: 97 + pupilY }}
                  transition={{ type: "spring", stiffness: 120, damping: 16 }}
                />
                {/* Catchlight. Fixed, not tracking — it is a reflection of the
                    room, so it must NOT follow the pupil or the eye reads as
                    glass. */}
                <circle cx={cx - 3} cy="92" r="2.4" fill="#ffffff" opacity="0.9" />
              </>
            )}
          </g>
        ))}
      </g>

      {/* BROWS. The single most expressive part of a face, and the cheapest. */}
      <motion.g animate={{ y: brow.lift }} transition={{ type: "spring", stiffness: 200, damping: 18 }}>
        <motion.path
          d="M68 78h22"
          stroke="#0b3d3e"
          strokeWidth="5"
          strokeLinecap="round"
          animate={{ rotate: brow.left }}
          transition={{ type: "spring", stiffness: 200, damping: 18 }}
          style={{ originX: "90px", originY: "78px" }}
        />
        <motion.path
          d="M110 78h22"
          stroke="#0b3d3e"
          strokeWidth="5"
          strokeLinecap="round"
          animate={{ rotate: brow.right }}
          transition={{ type: "spring", stiffness: 200, damping: 18 }}
          style={{ originX: "110px", originY: "78px" }}
        />
      </motion.g>

      {/* MOUTH. Morphed between the five shapes. */}
      <motion.path
        fill="#0b3d3e"
        initial={false}
        animate={{ d: MOUTH[mood] }}
        transition={{ type: "spring", stiffness: 180, damping: 20 }}
      />

      {/* Cheeks, and only on the two warm moods. Warmth you cannot switch off
          is not warmth, it is a permanent flush. */}
      <AnimatePresence>
        {(mood === "pleased" || mood === "cheering") && (
          <motion.g
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.35 }}
            exit={{ opacity: 0 }}
            filter="url(#djinn-soft)"
          >
            <ellipse cx="70" cy="115" rx="9" ry="6" fill="#FF6600" />
            <ellipse cx="130" cy="115" rx="9" ry="6" fill="#FF6600" />
          </motion.g>
        )}
      </AnimatePresence>

      {/* The mortarboard, inherited from the crest scholar. This is the whole
          visual argument that the two characters belong to the same school. */}
      <g>
        <path d="M100 26 158 50l-58 23-58-23z" fill="url(#djinn-cap)" />
        <path d="M78 58v11c0 6 10 10 22 10s22-4 22-10V58l-22 8z" fill="#e65c00" />
        <path d="M153 52v22" stroke="#e65c00" strokeWidth="3.5" strokeLinecap="round" />
        <motion.circle
          cx="153"
          cy="78"
          r="6"
          fill="#FFC46B"
          animate={reduceMotion ? {} : { x: [0, 5, 0, -3, 0], rotate: [0, 10, 0] }}
          transition={{ duration: 6.5, repeat: Infinity, ease: "easeInOut" }}
        />
      </g>

      {/* Sparkles. Three, on different periods, and gone entirely under reduced
          motion — a static sparkle is just a dot. */}
      {!reduceMotion &&
        [
          { cx: 40, cy: 66, d: 0 },
          { cx: 166, cy: 96, d: 1.4 },
          { cx: 52, cy: 176, d: 2.6 },
        ].map((spark) => (
          <motion.path
            key={`${spark.cx}-${spark.cy}`}
            d={`M${spark.cx} ${spark.cy - 7}l2 5 5 2-5 2-2 5-2-5-5-2 5-2z`}
            fill="#FFC46B"
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: [0, 1, 0], scale: [0.4, 1.15, 0.4], rotate: [0, 90] }}
            transition={{ duration: 3.4, repeat: Infinity, delay: spark.d, ease: "easeInOut" }}
          />
        ))}
    </motion.svg>
  );
}
