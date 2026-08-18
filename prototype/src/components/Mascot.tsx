"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

/**
 * BECCA — the one character in this product.
 *
 * ---------------------------------------------------------------------------
 * WHY A PHOTO, NOT A DRAWN CHARACTER
 * ---------------------------------------------------------------------------
 * The previous mascot (a djinn) was a hand-built SVG whose face was redrawn —
 * mouth, brows, eye shape all morphing — for eleven distinct moods. Becca is a
 * single rendered portrait, supplied as artwork rather than built as vector
 * shapes, so her face cannot be redrawn the same way. Redoing eleven
 * expressions by hand would mean eleven separate renders that would need to
 * agree on lighting, pose and framing closely enough to read as one character
 * — a different, much larger project than swapping a mascot's art.
 *
 * The first version of this component shipped the supplied JPEG almost as-is
 * — a studio product shot, backdrop and display plinth included, faded at the
 * edges with a CSS mask. It looked exactly like what it was: a photo taped
 * onto the page. Two things were wrong with that, and both are fixed at the
 * asset level now, not papered over with more CSS:
 *
 *   1. THE BACKGROUND WAS NEVER ACTUALLY REMOVED. A mask fades a rectangle's
 *      EDGES to transparent; the studio sweep nearest her — behind her hair,
 *      between her arm and her waist — is precisely the part a mask cannot
 *      touch, because it isn't at the edge. `scripts/clean-mascot.mjs` cuts
 *      her out for real: a flood fill from the border, a second pass for the
 *      pockets the border flood can't reach, `becca.png` /
 *      `becca-bust.png` with genuine alpha.
 *
 *   2. A FLAT BLURRED CIRCLE BEHIND A CUTOUT READS AS A STICKER, NOT LIGHT.
 *      What actually sells depth from one static photo — this is a rendered
 *      image, not a 3D model, so a new camera angle is not on the table — is
 *      a ground shadow that responds to how high she's floating, and a glow
 *      that follows HER SILHOUETTE (a coloured `drop-shadow`, which is alpha-
 *      aware) rather than a disc sitting behind a rectangle. Combined with a
 *      slight perspective tilt on her own float cycle, that is what makes a
 *      flat cutout read as an object occupying space rather than a
 *      photograph resting on top of the page.
 *
 * What carries MOOD, in order of how much work each does:
 *   1. The glow's colour — the single biggest signal, and the one every
 *      other mood-driven surface in this app already leans on.
 *   2. The djinn's own accessory vocabulary, reused rather than reinvented:
 *      cheek blush, a sweat drop, steam, sparkles. A returning user already
 *      learned what these mean; there is no reason to make them relearn it.
 *   3. Body motion: float for idle, a tighter bob for `walking`, a bigger
 *      bounce for `celebrating`, all with a matching ground shadow.
 *   4. A blink, on the same randomised clock the djinn used, so she is never
 *      quite still.
 *
 * `pointAngle` cannot bend a fixed-pose photo's arm the way it swung the
 * djinn's. A small arrow badge appears beside her and rotates to the bearing
 * instead — the tour needs something that points, not specifically an arm.
 *
 * ---------------------------------------------------------------------------
 * WHY THE BUST CROP, EVERYWHERE
 * ---------------------------------------------------------------------------
 * Every call site is a square-ish or landscape box, 56-224px — never a tall
 * portrait one — and the djinn's own comments already made this argument once
 * ("the difference between a readable face and a smudge"). `becca-bust.png`
 * (head, hair, shoulders, the waving hand) is what actually reads at those
 * sizes; a full-length figure in a 64px square puts her face at about
 * fifteen pixels. `becca.png` (full length) exists for a future spot that
 * wants it, but nothing here calls for it today.
 */

export type MascotMood =
  | "greeting"
  | "happy"
  | "cheerful"
  | "smiling"
  | "thinking"
  | "curious"
  | "proud"
  | "frowning"
  | "angry"
  | "concerned"
  | "celebrating";

type MoodSpec = {
  /** The glow colour hugging her silhouette — the primary way mood reads at a glance. */
  glow: string;
  cheeks?: boolean;
  steam?: boolean;
  sweat?: boolean;
  sparkle?: boolean;
  /** A bigger, bouncier float — reserved for genuinely good news. */
  bounce?: boolean;
};

const MOODS: Record<MascotMood, MoodSpec> = {
  greeting: { glow: "#0D7C7E" },
  happy: { glow: "#FF6600", cheeks: true },
  cheerful: { glow: "#FFC46B", cheeks: true, sparkle: true },
  smiling: { glow: "#0D7C7E", cheeks: true },
  thinking: { glow: "#5b8def" },
  curious: { glow: "#3fd0d3" },
  proud: { glow: "#FF6600", cheeks: true },
  frowning: { glow: "#64748b" },
  angry: { glow: "#e0654a", steam: true },
  concerned: { glow: "#7fd7ff", sweat: true },
  celebrating: { glow: "#FFC46B", cheeks: true, sparkle: true, bounce: true },
};

/**
 * Facial-feature positions, as fractions of `becca-bust.png` — measured
 * against the actual crop (see the verification pass in the commit that
 * added this file) rather than eyeballed against the original studio photo,
 * which is a different crop with different proportions.
 */
const FACE = {
  blink: { left: 31, top: 35.5, width: 32, height: 5 },
  cheekL: { left: 21, top: 48.5, width: 13, height: 6 },
  cheekR: { left: 60, top: 48.5, width: 13, height: 6 },
};

export default function Mascot({
  mood = "greeting",
  /** Degrees clockwise from pointing right. A pointer badge rotates to this bearing; `null` hides it. */
  pointAngle = null,
  /** A travelling bob, used while the tour moves her between steps. */
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
  const pointing = typeof pointAngle === "number";

  /** Same randomised-clock blink the djinn used — never quite still, never a metronome. */
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
   * One float cycle drives both the lift AND the ground shadow, so the two
   * never drift out of sync — the shadow shrinks and fades exactly as far as
   * she rises, which is the actual mechanism that reads as "floating above
   * something" instead of "drifting in a void."
   */
  const liftKeyframes = reduceMotion
    ? [0]
    : walking
      ? [0, -7, 0]
      : spec.bounce
        ? [0, -14, 0, -7, 0]
        : [0, -8, 0, -4, 0];
  const duration = reduceMotion ? 0 : walking ? 0.5 : spec.bounce ? 1.1 : 6.5;
  const liftRange = Math.max(1, Math.max(...liftKeyframes.map((v) => -v)));

  const float = reduceMotion
    ? {}
    : {
        y: liftKeyframes,
        rotate: walking || spec.bounce ? [0, 1.5, 0, -1.5, 0] : [0, 0.8, 0, -0.8, 0],
        rotateY: walking || spec.bounce ? [0, 0] : [-4, 4, -4],
        transition: { duration, repeat: Infinity, ease: "easeInOut" as const },
      };

  const shadow = reduceMotion
    ? { scaleX: 1, opacity: 0.4 }
    : {
        scaleX: liftKeyframes.map((v) => 1 - (Math.abs(v) / liftRange) * 0.4),
        opacity: liftKeyframes.map((v) => 0.42 - (Math.abs(v) / liftRange) * 0.22),
        transition: { duration, repeat: Infinity, ease: "easeInOut" as const },
      };

  return (
    <div className={`relative ${className}`} style={{ perspective: 600 }}>
      {/* The ground shadow. A cutout with no shadow at all is what makes a
          floating character look like it is stuck to the glass rather than
          hovering above the page — this is the single cheapest fix for that. */}
      <motion.div
        className="absolute rounded-full bg-black blur-md"
        style={{ left: "18%", right: "18%", bottom: "-6%", height: "12%" }}
        animate={shadow}
      />

      <motion.div className="relative h-full w-full" animate={float} style={{ transformOrigin: "50% 100%" }}>
        <img
          src="/mascot/becca-bust.png"
          alt="Your EasyWay guide"
          className="h-full w-full select-none"
          style={{
            objectFit: "contain",
            objectPosition: "50% 100%",
            // A coloured drop-shadow follows the PIXELS, not a bounding box —
            // unlike a blurred disc behind the image, this hugs her actual
            // silhouette, which is what makes it read as light on her rather
            // than a shape floating behind her. Kept deliberately soft —
            // stacking this any stronger stops reading as light and starts
            // reading as a sticker's outline, which is the exact look this
            // whole rebuild exists to get away from.
            filter: `drop-shadow(0 4px 9px ${spec.glow}6b) drop-shadow(0 1px 3px rgba(0,0,0,0.3))`,
          }}
          draggable={false}
        />

        {/* Blink: a soft, blurred shadow rather than a hard-edged patch, so
            it reads as closing eyes even without pixel-perfect placement
            against a photo — unlike a drawn face, there is no ground truth
            to snap to. */}
        <AnimatePresence>
          {blinking && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.85 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.06 }}
              className="pointer-events-none absolute"
              style={{
                left: `${FACE.blink.left}%`,
                top: `${FACE.blink.top}%`,
                width: `${FACE.blink.width}%`,
                height: `${FACE.blink.height}%`,
                background: "radial-gradient(ellipse, rgba(40,24,14,0.9) 0%, rgba(40,24,14,0.5) 55%, transparent 85%)",
                filter: "blur(1.5px)",
                borderRadius: "50%",
              }}
            />
          )}
        </AnimatePresence>

        {/* Cheeks — the djinn's own warm blush, repositioned for the bust crop. */}
        <AnimatePresence>
          {spec.cheeks && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 0.5 }} exit={{ opacity: 0 }}>
              <div
                className="absolute rounded-full blur-[3px]"
                style={{ left: `${FACE.cheekL.left}%`, top: `${FACE.cheekL.top}%`, width: `${FACE.cheekL.width}%`, height: `${FACE.cheekL.height}%`, background: "#FF6600" }}
              />
              <div
                className="absolute rounded-full blur-[3px]"
                style={{ left: `${FACE.cheekR.left}%`, top: `${FACE.cheekR.top}%`, width: `${FACE.cheekR.width}%`, height: `${FACE.cheekR.height}%`, background: "#FF6600" }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Sweat, for `concerned`. One drop, on the temple. */}
        <AnimatePresence>
          {spec.sweat && !reduceMotion && (
            <motion.div
              className="absolute rounded-full"
              style={{ left: "66%", top: "26%", width: "5%", height: "4%", background: "#7fd7ff" }}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: [0, 1, 1, 0], y: [-4, 0, 3, 7] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
        </AnimatePresence>

        {/* Steam, for `angry` — cross on the student's behalf, never at them. */}
        <AnimatePresence>
          {spec.steam && !reduceMotion && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {[
                { left: "10%", top: "6%", d: 0 },
                { left: "80%", top: "8%", d: 0.7 },
              ].map((puff) => (
                <motion.div
                  key={puff.left}
                  className="absolute rounded-full blur-[2px]"
                  style={{ left: puff.left, top: puff.top, width: "9%", height: "6%", background: "#cfeff0" }}
                  animate={{ y: [0, -14], opacity: [0.75, 0], scale: [0.7, 1.5] }}
                  transition={{ duration: 1.5, repeat: Infinity, delay: puff.d, ease: "easeOut" }}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Sparkles, for the genuinely good moods. */}
        {!reduceMotion && spec.sparkle && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
            {[
              { x: "4%", y: "22%", d: 0 },
              { x: "94%", y: "34%", d: 1.4 },
              { x: "10%", y: "84%", d: 2.6 },
            ].map((spark) => (
              <motion.path
                key={`${spark.x}-${spark.y}`}
                d="M0 -7l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"
                transform={`translate(${spark.x}, ${spark.y})`}
                fill="#FFC46B"
                initial={{ opacity: 0, scale: 0.4 }}
                animate={{ opacity: [0, 1, 0], scale: [0.4, 1.15, 0.4], rotate: [0, 90] }}
                transition={{ duration: 3.4, repeat: Infinity, delay: spark.d, ease: "easeInOut" }}
              />
            ))}
          </svg>
        )}

        {/* The pointer badge — what replaced bending an arm. Rotates to the
            bearing the tour computed, bobbing gently so it reads as "look
            there" rather than a static icon. */}
        {pointing && (
          <motion.div
            className="absolute grid place-items-center rounded-full bg-white shadow-lg"
            style={{ right: "-8%", top: "42%", width: "24%", height: "24%" }}
            animate={reduceMotion ? { rotate: pointAngle! } : { rotate: pointAngle!, x: [0, 3, 0], y: [0, -2, 0] }}
            transition={{ duration: 1.1, repeat: reduceMotion ? 0 : Infinity, ease: "easeInOut" }}
          >
            <svg viewBox="0 0 24 24" className="h-3/5 w-3/5" fill="none">
              <path d="M4 12h14M13 6l6 6-6 6" stroke="#FF6600" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
