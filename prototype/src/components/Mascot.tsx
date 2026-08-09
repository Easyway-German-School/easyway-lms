"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useId, useState } from "react";

/**
 * DJINN — the one character in this product.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS ONLY ONE OF THESE NOW
 *
 * There used to be two, and they were the same drawing twice: `TuitionMascot`
 * (the crest scholar, standing still, pointing right) and `TourGuide` (the crest
 * scholar, smaller, with an arm that could point anywhere). Both had a circle
 * for a head, two dots for eyes and a single arc for a mouth that never moved.
 *
 * That is a logo with legs, not a character. It could indicate — "look over
 * there" — and nothing else, which meant the moments that actually needed a
 * character got nothing from it: the paywall where somebody is deciding whether
 * to spend ₦400,000, the signup form they are four minutes into, the goal
 * picker asking them why they want to learn German at all. A face that cannot
 * react is scenery, and scenery does not change anyone's mind.
 *
 * So: one djinn, eleven expressions, used everywhere the old two were. It
 * FLOATS, which is the other half of the fix — a character with legs has to
 * stand on something, and on a stack of form fields there is nothing to stand
 * on, which is why the old mascot always looked pasted onto the page rather
 * than in it. A being of smoke has no such problem.
 *
 * The brand survives the change: the crest's teal and orange, and the scholar's
 * mortarboard, which is what makes this read as the same school rather than a
 * different product.
 *
 * ---------------------------------------------------------------------------
 * THE FACE
 *
 * Eleven moods, built from five parts that MORPH rather than swap — mouth,
 * brows, eye shape, gaze, and the extras (cheeks, steam, sweat). Cutting
 * between two finished faces reads as a slideshow of a character; moving the
 * parts reads as a character.
 *
 * Restraint is doing as much work as the range here. It is calm by default and
 * only reacts to things that actually happened, because a mascot that mugs at
 * every keystroke is unbearable inside thirty seconds. `angry` and `frowning`
 * in particular are for when the SCHOOL is annoyed on the student's behalf —
 * never at the student. A character that scowls at somebody for mistyping their
 * email is not charming, it is a reason to close the tab.
 *
 * Blinks and eye-drift run on their own randomised clocks, unrelated to mood,
 * so the idle face is never quite still. A face that holds perfectly still
 * between events looks switched off.
 *
 * Everything collapses under `prefers-reduced-motion`: the face stays, the
 * float, blink, steam and sparkles go.
 */

export type MascotMood =
  /** Neutral-warm. The resting state and the way it arrives. */
  | "greeting"
  /** Plainly pleased. The everyday positive. */
  | "happy"
  /** Beaming, eyes arced shut. For things genuinely worth celebrating. */
  | "cheerful"
  /** A small closed-mouth smile. Approving without making a fuss. */
  | "smiling"
  /** Eyes off to one side, small mouth. Waiting for you to finish. */
  | "thinking"
  /** Head-tilt energy. Asking something. */
  | "curious"
  /** Chest up, eyes arced, arms in. Proud OF THEM, not of itself. */
  | "proud"
  /** Downturned mouth. Disappointed at a situation. */
  | "frowning"
  /** Brows down, steam. Cross on the student's behalf, never at them. */
  | "angry"
  /** Attentive and a little worried. NOT devastated. */
  | "concerned"
  /** Arms up, mouth open. The finish line. */
  | "celebrating";

type EyeStyle = "open" | "arc" | "narrow" | "wide";

type MoodSpec = {
  mouth: string;
  /** Inner-corner rotation per brow, and a shared vertical lift. */
  brow: { left: number; right: number; lift: number };
  gaze: { x: number; y: number };
  eyes: EyeStyle;
  cheeks?: boolean;
  steam?: boolean;
  sweat?: boolean;
  /** Both arms thrown up. */
  armsUp?: boolean;
  /** A whole-body tilt, in degrees. Reads as a head-tilt at small sizes. */
  tilt?: number;
};

/**
 * The table. Every mood is one row, so adding a twelfth is a row rather than a
 * new branch in five different places — which is exactly how the old mascot
 * ended up with one expression.
 */
const MOODS: Record<MascotMood, MoodSpec> = {
  greeting: {
    mouth: "M84 118 q16 14 32 0 q-16 6 -32 0Z",
    brow: { left: -6, right: 6, lift: -2 },
    gaze: { x: 0, y: 0 },
    eyes: "open",
  },
  happy: {
    mouth: "M80 116 q20 20 40 0 q-20 11 -40 0Z",
    brow: { left: -8, right: 8, lift: -4 },
    gaze: { x: 0, y: 0.5 },
    eyes: "open",
    cheeks: true,
  },
  cheerful: {
    mouth: "M78 114 q22 24 44 0 q-22 14 -44 0Z",
    brow: { left: -12, right: 12, lift: -7 },
    gaze: { x: 0, y: 0 },
    eyes: "arc",
    cheeks: true,
  },
  smiling: {
    mouth: "M86 117 q14 9 28 0",
    brow: { left: -5, right: 5, lift: -3 },
    gaze: { x: 0, y: 0.5 },
    eyes: "open",
    cheeks: true,
  },
  thinking: {
    mouth: "M92 119 q10 4 18 -1 q-9 6 -18 1Z",
    brow: { left: -14, right: 4, lift: 0 },
    gaze: { x: 3.5, y: -2 },
    eyes: "open",
  },
  curious: {
    mouth: "M92 118 q9 8 17 0 q-8 5 -17 0Z",
    brow: { left: -18, right: 2, lift: -5 },
    gaze: { x: 2, y: -1 },
    eyes: "wide",
    tilt: -7,
  },
  proud: {
    mouth: "M82 116 q18 16 36 0 q-18 9 -36 0Z",
    brow: { left: -10, right: 10, lift: -6 },
    gaze: { x: 0, y: 0 },
    eyes: "arc",
    cheeks: true,
  },
  frowning: {
    // The mirror of the smile: same curve, other way up.
    mouth: "M84 124 q16 -14 32 0 q-16 -6 -32 0Z",
    brow: { left: 10, right: -10, lift: 2 },
    gaze: { x: 0, y: 1 },
    eyes: "open",
  },
  angry: {
    mouth: "M84 124 q16 -12 32 0 q-16 -5 -32 0Z",
    brow: { left: 24, right: -24, lift: 4 },
    gaze: { x: 0, y: 1.5 },
    eyes: "narrow",
    steam: true,
  },
  concerned: {
    mouth: "M88 121 q12 -3 24 0 q-12 3 -24 0Z",
    brow: { left: 12, right: -12, lift: 1 },
    gaze: { x: -1, y: 1 },
    eyes: "open",
    sweat: true,
  },
  celebrating: {
    mouth: "M82 114 q18 26 36 0 q-8 20 -36 0Z",
    brow: { left: -12, right: 12, lift: -7 },
    gaze: { x: 0, y: -1.5 },
    eyes: "wide",
    cheeks: true,
    armsUp: true,
  },
};

export default function Mascot({
  mood = "greeting",
  /**
   * Degrees clockwise from pointing right. Given a number, the right arm
   * becomes a pointing arm and swings to that bearing — this is what the
   * welcome tour needs, and it is the only reason the old TourGuide existed
   * separately. `null` leaves both arms resting.
   */
  pointAngle = null,
  /** A travelling bob, used while the tour moves it between steps. */
  walking = false,
  className = "",
}: {
  mood?: MascotMood;
  pointAngle?: number | null;
  walking?: boolean;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const spec = MOODS[mood];

  /**
   * EVERY GRADIENT AND FILTER ID IS SCOPED PER INSTANCE.
   *
   * SVG ids are global to the document, not to the <svg> that declares them, and
   * `url(#dj-body)` resolves to the FIRST match in the page. Two mascots on one
   * screen — the welcome tour beside the moment dock, or the eleven in the dev
   * gallery — therefore all painted themselves out of the first one's defs.
   *
   * That renders identically, which is exactly why it survives review. It stops
   * being invisible the moment the first mascot unmounts: its <defs> go with it,
   * every surviving mascot's `url(#…)` resolves to nothing, and they all turn
   * flat black mid-animation. `useId` gives each instance its own namespace.
   */
  const uid = useId().replace(/:/g, "");
  const ref = (name: string) => `${name}-${uid}`;
  const url = (name: string) => `url(#${name}-${uid})`;

  /**
   * Blinking on its own clock, re-randomised after each blink.
   *
   * A perfectly regular blink is uncanny in a way people notice without being
   * able to say why. Two to six seconds is close enough to a real one. Skipped
   * entirely for the arc-eyed moods, where the eyes are already shut.
   */
  const [blinking, setBlinking] = useState(false);
  useEffect(() => {
    if (reduceMotion || spec.eyes === "arc") return;
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
  }, [reduceMotion, spec.eyes]);

  /**
   * A slow drift around wherever the mood is looking.
   *
   * Real eyes move constantly and involuntarily. Without this the character
   * stares through you, which lands somewhere between unsettling and broken.
   */
  const [drift, setDrift] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (reduceMotion) return;
    const timer = window.setInterval(() => {
      setDrift({ x: (Math.random() - 0.5) * 2.6, y: (Math.random() - 0.5) * 1.8 });
    }, 1900);
    return () => window.clearInterval(timer);
  }, [reduceMotion]);

  const pupilX = spec.gaze.x + drift.x;
  const pupilY = spec.gaze.y + drift.y;
  const pointing = typeof pointAngle === "number";
  const armsUp = Boolean(spec.armsUp) && !pointing;

  // Weightless, so the drift is slower and wider than a walk cycle would be.
  // Walking tightens it into something with a beat.
  const float = reduceMotion
    ? {}
    : walking
      ? { y: [0, -9, 0], transition: { duration: 0.5, repeat: Infinity, ease: "easeInOut" as const } }
      : {
          y: [0, -7, 0, -3, 0],
          rotate: [0, 1.2, 0, -1.2, 0],
          transition: { duration: 6.5, repeat: Infinity, ease: "easeInOut" as const },
        };

  const eyeCentres = [80, 120];

  /**
   * The box is cropped to the character, and widened only when it points.
   *
   * `0 0 200 250` was the drawing's coordinate space, not its contents: the
   * character occupies x 36–164 and y 26–198, so a square container letterboxed
   * it on all four sides and threw away about a third of the height it had to
   * play with. At the 64px this renders at in the signup header that is the
   * difference between a readable face and a smudge.
   *
   * The pointing arm is the exception — fully extended it reaches x≈208, so the
   * tour's variant keeps the room it needs rather than clipping the hand off
   * the thing it is pointing at.
   */
  const viewBox = pointing ? "18 12 196 200" : "28 16 144 190";

  return (
    <motion.svg
      viewBox={viewBox}
      className={className}
      role="img"
      aria-label="Your EasyWay guide"
      animate={float}
      style={{ rotate: spec.tilt ?? 0 }}
    >
      <defs>
        <linearGradient {...{id: ref("dj-body")}} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0%" stopColor="#16a3a6" />
          <stop offset="55%" stopColor="#0D7C7E" />
          <stop offset="100%" stopColor="#0a5f61" />
        </linearGradient>
        <linearGradient {...{id: ref("dj-tail")}} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0D7C7E" stopOpacity="0.95" />
          <stop offset="60%" stopColor="#0D7C7E" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#0D7C7E" stopOpacity="0" />
        </linearGradient>
        <linearGradient {...{id: ref("dj-cap")}} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ff9a4d" />
          <stop offset="100%" stopColor="#FF6600" />
        </linearGradient>
        <radialGradient {...{id: ref("dj-face")}} cx="0.4" cy="0.34" r="0.8">
          <stop offset="0%" stopColor="#3fd0d3" />
          <stop offset="100%" stopColor="#12939a" />
        </radialGradient>
        <radialGradient {...{id: ref("dj-glow")}} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#FF6600" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#FF6600" stopOpacity="0" />
        </radialGradient>
        {/* A rim light down the left edge. This is the single cheapest thing
            that lifts a flat vector shape off the page — one soft highlight
            where a light source would be, and the silhouette stops reading as
            a sticker. */}
        <linearGradient {...{id: ref("dj-rim")}} x1="0" y1="0" x2="1" y2="0.4">
          <stop offset="0%" stopColor="#7ff0f2" stopOpacity="0.55" />
          <stop offset="45%" stopColor="#7ff0f2" stopOpacity="0" />
        </linearGradient>
        <filter {...{id: ref("dj-soft")}} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3.2" />
        </filter>
        <filter {...{id: ref("dj-drop")}} x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="7" stdDeviation="7" floodColor="#04252b" floodOpacity="0.35" />
        </filter>
      </defs>

      {/* The lamp-light it is rising out of. Sells "conjured" in one shape. */}
      <ellipse cx="100" cy="196" rx="72" ry="52" fill={url("dj-glow")} />

      <g filter={url("dj-drop")}>
        {/* THE TAIL. Two curls on different periods so the smoke never repeats
            a shape you can catch — a single wagging curl reads as a fish. */}
        <motion.g
          animate={reduceMotion ? {} : { rotate: [0, 4, -3, 0], x: [0, 3, -2, 0] }}
          transition={{ duration: 7.5, repeat: Infinity, ease: "easeInOut" }}
          style={{ originX: "100px", originY: "160px" }}
        >
          <path
            d="M84 158c-6 18-2 32 8 40 10 8 22 6 26-4 3-8-2-16-10-16-6 0-10 4-9 9"
            fill="none"
            stroke={url("dj-tail")}
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
            stroke={url("dj-tail")}
            strokeWidth="11"
            strokeLinecap="round"
            opacity="0.7"
          />
        </motion.g>

        {/* Body: shoulders tapering into smoke. No waist, no legs. */}
        <path d="M100 74c26 0 42 20 44 46 2 20-4 34-14 42-12 9-48 9-60 0-10-8-16-22-14-42 2-26 18-46 44-46Z" fill={url("dj-body")} />
        <path d="M100 74c26 0 42 20 44 46 2 20-4 34-14 42-12 9-48 9-60 0-10-8-16-22-14-42 2-26 18-46 44-46Z" fill={url("dj-rim")} />

        {/* The gold band, at the narrowest point. Its one piece of jewellery. */}
        <path d="M66 150c10 7 58 7 68 0" fill="none" stroke="#FFC46B" strokeWidth="6" strokeLinecap="round" />
        <circle cx="100" cy="153" r="4.5" fill="#FF6600" />

        {/* LEFT ARM. Resting, or up when celebrating. */}
        <motion.g
          animate={{ rotate: armsUp ? -58 : 0, y: armsUp ? -6 : 0 }}
          transition={{ type: "spring", stiffness: 150, damping: 13 }}
          style={{ originX: "62px", originY: "108px" }}
        >
          <path d="M62 108c-14 6-20 18-18 30" fill="none" stroke={url("dj-body")} strokeWidth="15" strokeLinecap="round" />
          <circle cx="45" cy="140" r="9" fill="#12939a" />
        </motion.g>

        {/*
          RIGHT ARM, which has two jobs.

          Given a `pointAngle` it becomes the pointing arm the welcome tour
          needs — swinging about the shoulder to whatever bearing the tour
          computed, clamped so it never folds back through the body. Otherwise
          it rests, or goes up with the other one.
        */}
        <motion.g
          animate={{
            rotate: pointing ? Math.max(-110, Math.min(110, pointAngle!)) : armsUp ? 58 : 0,
            y: armsUp ? -6 : 0,
          }}
          transition={{ type: "spring", stiffness: 150, damping: 13 }}
          style={{ originX: "138px", originY: "108px" }}
        >
          {pointing ? (
            <>
              <path d="M138 108c20 0 34 -2 46 -5" fill="none" stroke={url("dj-body")} strokeWidth="14" strokeLinecap="round" />
              <circle cx="188" cy="102" r="10" fill="#3fd0d3" />
              <path d="M196 100h10" stroke="#3fd0d3" strokeWidth="6.5" strokeLinecap="round" />
            </>
          ) : (
            <>
              <path d="M138 108c14 6 20 18 18 30" fill="none" stroke={url("dj-body")} strokeWidth="15" strokeLinecap="round" />
              <circle cx="155" cy="140" r="9" fill="#12939a" />
            </>
          )}
        </motion.g>

        {/* Face plate, a shade lighter than the body so the features read even
            at the 56–64px this renders at in a signup header. */}
        <ellipse cx="100" cy="102" rx="42" ry="40" fill={url("dj-face")} />

        {/* EYES.
            Real whites, and that is the single decision that makes this face
            legible when small: a pupil on a coloured field is a smudge, and
            contrast between sclera and pupil is the only thing that survives
            being scaled down. */}
        <g>
          {eyeCentres.map((cx, i) => {
            if (spec.eyes === "arc") {
              // Happy eyes: an upward arc, no sclera at all. Mirrored, so both
              // curve away from the nose rather than both leaning one way.
              return (
                <path
                  key={cx}
                  d={i === 0 ? "M69 99q11 -14 22 0" : "M109 99q11 -14 22 0"}
                  fill="none"
                  stroke="#0b3d3e"
                  strokeWidth="5.5"
                  strokeLinecap="round"
                />
              );
            }

            const ry = blinking ? 1.4 : spec.eyes === "wide" ? 15 : spec.eyes === "narrow" ? 7 : 13;
            return (
              <g key={cx}>
                <ellipse cx={cx} cy="96" rx={spec.eyes === "wide" ? 13 : 12} ry={ry} fill="#ffffff" />
                {!blinking && (
                  <>
                    <motion.circle
                      cx={cx}
                      cy="97"
                      r={spec.eyes === "narrow" ? 5.4 : 6.4}
                      fill="#0b3d3e"
                      animate={{ cx: cx + pupilX, cy: 97 + pupilY }}
                      transition={{ type: "spring", stiffness: 120, damping: 16 }}
                    />
                    {/* Catchlight. FIXED, not tracking — it is a reflection of
                        the room, so following the pupil would turn the eye to
                        glass. */}
                    <circle cx={cx - 3} cy="92" r="2.4" fill="#ffffff" opacity="0.9" />
                  </>
                )}
                {/* An angry lid, cutting the top of the eye at a slant. Drawn in
                    the face colour so it reads as skin coming down over the eye
                    rather than a bar across it. */}
                {spec.eyes === "narrow" && (
                  <path
                    d={i === 0 ? "M67 96l26 -9v-12h-26z" : "M107 87l26 9v-21h-26z"}
                    fill={url("dj-face")}
                  />
                )}
              </g>
            );
          })}
        </g>

        {/* BROWS. The most expressive part of any face and by far the cheapest. */}
        <motion.g animate={{ y: spec.brow.lift }} transition={{ type: "spring", stiffness: 200, damping: 18 }}>
          <motion.path
            d="M68 78h22"
            stroke="#0b3d3e"
            strokeWidth="5"
            strokeLinecap="round"
            animate={{ rotate: spec.brow.left }}
            transition={{ type: "spring", stiffness: 200, damping: 18 }}
            style={{ originX: "90px", originY: "78px" }}
          />
          <motion.path
            d="M110 78h22"
            stroke="#0b3d3e"
            strokeWidth="5"
            strokeLinecap="round"
            animate={{ rotate: spec.brow.right }}
            transition={{ type: "spring", stiffness: 200, damping: 18 }}
            style={{ originX: "110px", originY: "78px" }}
          />
        </motion.g>

        {/* MOUTH. Morphed between the eleven shapes. `smiling` is the one that
            is a stroke rather than a fill — a closed-mouth smile has no inside. */}
        <motion.path
          fill={mood === "smiling" ? "none" : "#0b3d3e"}
          stroke={mood === "smiling" ? "#0b3d3e" : "none"}
          strokeWidth={mood === "smiling" ? 5 : 0}
          strokeLinecap="round"
          initial={false}
          animate={{ d: spec.mouth }}
          transition={{ type: "spring", stiffness: 180, damping: 20 }}
        />

        {/* Cheeks, on the warm moods only. Warmth you cannot switch off is not
            warmth, it is a permanent flush. */}
        <AnimatePresence>
          {spec.cheeks && (
            <motion.g initial={{ opacity: 0 }} animate={{ opacity: 0.35 }} exit={{ opacity: 0 }} filter={url("dj-soft")}>
              <ellipse cx="70" cy="115" rx="9" ry="6" fill="#FF6600" />
              <ellipse cx="130" cy="115" rx="9" ry="6" fill="#FF6600" />
            </motion.g>
          )}
        </AnimatePresence>

        {/* A bead of sweat for `concerned`. One, on the temple. Two would be
            slapstick, and this mood is meant to read as attentive. */}
        <AnimatePresence>
          {spec.sweat && !reduceMotion && (
            <motion.path
              d="M140 78c0 0 -6 8 -6 12a6 6 0 0 0 12 0c0-4-6-12-6-12z"
              fill="#7fd7ff"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: [0, 1, 1, 0], y: [-6, 0, 4, 10] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
        </AnimatePresence>

        {/* Steam for `angry`. Two puffs off the top of the head, offset in time
            so they do not pulse in lockstep. */}
        <AnimatePresence>
          {spec.steam && !reduceMotion && (
            <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {[
                { cx: 56, cy: 72, d: 0 },
                { cx: 146, cy: 74, d: 0.7 },
              ].map((puff) => (
                <motion.circle
                  key={puff.cx}
                  cx={puff.cx}
                  cy={puff.cy}
                  r="7"
                  fill="#cfeff0"
                  filter={url("dj-soft")}
                  animate={{ y: [0, -18], opacity: [0.75, 0], scale: [0.7, 1.5] }}
                  transition={{ duration: 1.5, repeat: Infinity, delay: puff.d, ease: "easeOut" }}
                />
              ))}
            </motion.g>
          )}
        </AnimatePresence>

        {/* The mortarboard, inherited from the crest scholar. This is the whole
            visual argument that this is still the same school's character. */}
        <g>
          <path d="M100 26 158 50l-58 23-58-23z" fill={url("dj-cap")} />
          <path d="M78 58v11c0 6 10 10 22 10s22-4 22-10V58l-22 8z" fill="#e65c00" />
          <path d="M153 52v22" stroke="#e65c00" strokeWidth="3.5" strokeLinecap="round" />
          <motion.circle
            cx="153"
            cy="78"
            r="6"
            fill="#FFC46B"
            animate={reduceMotion ? {} : { x: [0, 5, 0, -3, 0], rotate: [0, 10, 0] }}
            transition={{ duration: walking ? 0.5 : 6.5, repeat: Infinity, ease: "easeInOut" }}
          />
        </g>
      </g>

      {/* Sparkles. Gone entirely under reduced motion — a static sparkle is
          just a dot — and gone when cross, because a scowl surrounded by
          twinkling stars reads as neither. */}
      {!reduceMotion && !spec.steam &&
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
