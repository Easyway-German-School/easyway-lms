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
 * What carries mood here instead, in order of how much work they do:
 *   1. A coloured glow behind her, which shifts with the mood — the single
 *      biggest signal, and the one every other mood-driven UI in this app
 *      already leans on (accent colour = emotional register).
 *   2. The same accessory effects the djinn used — cheek blush, steam,
 *      a sweat drop, sparkles — reused verbatim rather than reinvented, so
 *      the vocabulary a returning user already learned still means the same
 *      thing.
 *   3. Body motion: a float/bob for idle, a tighter one for `walking`, and a
 *      bigger bounce for `celebrating`.
 *   4. A blink, on the same randomised clock the djinn used, so she is never
 *      quite still.
 *
 * `pointAngle` cannot bend a fixed-pose photo's arm the way it swung the
 * djinn's. Instead a small arrow badge appears beside her and rotates to the
 * bearing — the tour needs something that points, not specifically an arm.
 *
 * ---------------------------------------------------------------------------
 * WHY THE MASK
 * ---------------------------------------------------------------------------
 * The source photo is a studio render on a plain light background with a
 * display base at her feet — a product shot, not a cutout. An elliptical CSS
 * mask fades that rectangle to transparent at the edges and crops the base
 * off entirely, so she reads as a floating character on whatever colour the
 * surrounding page happens to be, the same job the djinn's smoke-tail did.
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
  /** The glow colour behind her — the primary way mood reads at a glance. */
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

  const float = reduceMotion
    ? {}
    : walking
      ? { y: [0, -8, 0], transition: { duration: 0.5, repeat: Infinity, ease: "easeInOut" as const } }
      : spec.bounce
        ? { y: [0, -12, 0, -6, 0], rotate: [0, 1.5, 0, -1.5, 0], transition: { duration: 1.1, repeat: Infinity, ease: "easeInOut" as const } }
        : { y: [0, -6, 0, -3, 0], rotate: [0, 1, 0, -1, 0], transition: { duration: 6.5, repeat: Infinity, ease: "easeInOut" as const } };

  return (
    <motion.div className={`relative ${className}`} animate={float} style={{ transformOrigin: "50% 100%" }}>
      {/* The mood glow. Sized generously and blurred hard, so it reads as
          ambient light rather than a coloured disc. */}
      <motion.div
        className="absolute inset-0 rounded-full blur-2xl"
        style={{ background: spec.glow, opacity: 0.4 }}
        animate={reduceMotion ? {} : { opacity: [0.3, 0.45, 0.3] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />

      <div
        className="relative h-full w-full"
        style={{
          maskImage: "radial-gradient(ellipse 62% 66% at 50% 42%, #000 58%, transparent 92%)",
          WebkitMaskImage: "radial-gradient(ellipse 62% 66% at 50% 42%, #000 58%, transparent 92%)",
        }}
      >
        <img
          src="/mascot/becca.jpg"
          alt="Your EasyWay guide"
          className="h-full w-full select-none"
          style={{ objectFit: "cover", objectPosition: "50% 8%" }}
          draggable={false}
        />

        {/* Blink: a soft, blurred shadow rather than a hard-edged patch, so it
            reads as closing eyes even if the placement is not pixel-perfect
            against a photo (unlike a drawn face, there is no ground truth to
            snap to). */}
        <AnimatePresence>
          {blinking && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.85 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.06 }}
              className="pointer-events-none absolute"
              style={{
                left: "38%",
                top: "22.5%",
                width: "26%",
                height: "4.5%",
                background: "radial-gradient(ellipse, rgba(40,24,14,0.9) 0%, rgba(40,24,14,0.5) 55%, transparent 85%)",
                filter: "blur(1.5px)",
                borderRadius: "50%",
              }}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Cheeks — the djinn's own warm blush, repositioned for a photo face. */}
      <AnimatePresence>
        {spec.cheeks && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 0.5 }} exit={{ opacity: 0 }}>
            <div
              className="absolute rounded-full blur-[3px]"
              style={{ left: "27%", top: "27%", width: "10%", height: "5%", background: "#FF6600" }}
            />
            <div
              className="absolute rounded-full blur-[3px]"
              style={{ left: "63%", top: "27%", width: "10%", height: "5%", background: "#FF6600" }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sweat, for `concerned`. One drop, on the temple. */}
      <AnimatePresence>
        {spec.sweat && !reduceMotion && (
          <motion.div
            className="absolute rounded-full"
            style={{ left: "66%", top: "16%", width: "5%", height: "4%", background: "#7fd7ff" }}
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
              { left: "12%", top: "2%", d: 0 },
              { left: "78%", top: "4%", d: 0.7 },
            ].map((puff) => (
              <motion.div
                key={puff.left}
                className="absolute rounded-full blur-[2px]"
                style={{ left: puff.left, top: puff.top, width: "9%", height: "4%", background: "#cfeff0" }}
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
            { x: "6%", y: "18%", d: 0 },
            { x: "92%", y: "30%", d: 1.4 },
            { x: "14%", y: "78%", d: 2.6 },
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
          style={{ right: "-6%", top: "38%", width: "22%", height: "22%" }}
          animate={reduceMotion ? { rotate: pointAngle! } : { rotate: pointAngle!, x: [0, 3, 0], y: [0, -2, 0] }}
          transition={{ duration: 1.1, repeat: reduceMotion ? 0 : Infinity, ease: "easeInOut" }}
        >
          <svg viewBox="0 0 24 24" className="h-3/5 w-3/5" fill="none">
            <path d="M4 12h14M13 6l6 6-6 6" stroke="#FF6600" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </motion.div>
      )}
    </motion.div>
  );
}
