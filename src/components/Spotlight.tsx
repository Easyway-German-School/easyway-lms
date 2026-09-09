"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useId, useLayoutEffect, useState } from "react";

/**
 * The coach-mark primitives — a dimmer with a hole cut in it, a pulsing ring
 * around the hole, and a bowed arrow drawn to it.
 *
 * Lifted out of WelcomeTour so PhotoUnlockGuide can point at a control the same
 * way the tour points at a sidebar entry, without a second copy of the fiddly
 * bits: the rAF re-measure loop that waits for a drawer to finish sliding, the
 * SVG mask (four divs cannot round the corner or animate the hole between
 * targets), and the quadratic arrow whose control point is pushed perpendicular
 * so it bows rather than cutting across the artwork.
 *
 * Each instance gets its own mask/marker ids (`useId`) so two spotlights can be
 * mounted at once — the tour for a brand-new student, this guide for a photoless
 * one — without their `<defs>` colliding.
 */

export type Rect = { top: number; left: number; width: number; height: number };
export type Point = { x: number; y: number };

/**
 * Where the target sits, in viewport coordinates. Null while unknown.
 *
 * Keeps measuring for a beat rather than measuring once: on a phone the target
 * can be inside a drawer that takes 300ms to slide in, and a single measurement
 * catches it off-screen. Re-measures every frame until the rectangle holds
 * still, then keeps a slow watch for later layout shifts.
 */
export function useTargetRect(selector: string | undefined, key: unknown): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);

  useLayoutEffect(() => {
    if (!selector) {
      setRect(null);
      return;
    }

    let frame = 0;
    let elapsed = 0;
    let stableFor = 0;
    let last: Rect | null = null;

    const read = (): Rect | null => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) return null;
      return { top: box.top, left: box.left, width: box.width, height: box.height };
    };

    const same = (a: Rect | null, b: Rect | null) =>
      a !== null &&
      b !== null &&
      Math.abs(a.top - b.top) < 0.5 &&
      Math.abs(a.left - b.left) < 0.5 &&
      Math.abs(a.width - b.width) < 0.5 &&
      Math.abs(a.height - b.height) < 0.5;

    let scrolled = false;

    const settle = () => {
      elapsed += 1;
      const next = read();

      if (next) {
        if (!scrolled) {
          scrolled = true;
          document.querySelector(selector)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
        if (!same(next, last)) {
          last = next;
          stableFor = 0;
          setRect(next);
        } else {
          stableFor += 1;
        }
      }

      if (stableFor < 8 && elapsed < 120) {
        frame = requestAnimationFrame(settle);
      }
    };

    frame = requestAnimationFrame(settle);

    const remeasure = () => {
      const next = read();
      if (next && !same(next, last)) {
        last = next;
        setRect(next);
      }
    };

    window.addEventListener("resize", remeasure);
    window.addEventListener("scroll", remeasure, true);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", remeasure);
      window.removeEventListener("scroll", remeasure, true);
    };
  }, [selector, key]);

  return rect;
}

/** Grows a rect by `pad` on every side, e.g. to leave breathing room round the hole. */
export function inflate(rect: Rect, pad: number): Rect {
  return { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 };
}

const SPRING = { type: "spring" as const, stiffness: 260, damping: 30 };

/**
 * The dimmer with a hole, plus the ring around it. Fixed to the viewport, so it
 * works whether or not it is inside a full-screen overlay. `zIndex` is the
 * dimmer's; the ring sits one above.
 */
export function SpotlightMask({
  hole,
  zIndex = 130,
  dim = "rgb(2 6 23 / 0.82)",
}: {
  hole: Rect | null;
  zIndex?: number;
  dim?: string;
}) {
  const reduceMotion = useReducedMotion();
  const maskId = useId().replace(/:/g, "");

  return (
    <>
      <svg className="pointer-events-none fixed inset-0 h-full w-full" style={{ zIndex }} aria-hidden>
        <defs>
          <mask id={maskId}>
            <rect width="100%" height="100%" fill="white" />
            {hole && (
              // Moved by translating a <g>, not by animating x/y on the <rect> —
              // Framer maps those to a transform on some SVG elements and to
              // attributes on others, and on a bare rect it set neither.
              <motion.g
                initial={false}
                animate={{ x: hole.left, y: hole.top }}
                transition={reduceMotion ? { duration: 0 } : SPRING}
              >
                <rect width={hole.width} height={hole.height} rx={16} fill="black" />
              </motion.g>
            )}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill={dim} mask={`url(#${maskId})`} />
      </svg>

      {hole && (
        // Same z as the dimmer, and after it in the DOM, so it paints just
        // above the dim without lifting over any card placed at a higher z.
        <motion.div
          initial={false}
          animate={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
          transition={reduceMotion ? { duration: 0 } : SPRING}
          className="pointer-events-none fixed rounded-2xl ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-transparent"
          style={{ zIndex }}
        >
          {!reduceMotion && (
            <motion.span
              className="absolute inset-0 rounded-2xl ring-2 ring-[var(--accent)]"
              animate={{ opacity: [0.7, 0], scale: [1, 1.35] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
            />
          )}
        </motion.div>
      )}
    </>
  );
}

/**
 * A dashed, arrow-headed curve from `from` (a hand) to `to` (the target). The
 * control point is pushed perpendicular to the line so it bows. `redrawKey`
 * re-runs the draw-in animation when it changes — pass the current step id.
 */
export function SpotlightArrow({
  from,
  to,
  zIndex = 130,
  redrawKey,
}: {
  from: Point;
  to: Point;
  zIndex?: number;
  redrawKey?: string | number;
}) {
  const reduceMotion = useReducedMotion();
  const markerId = useId().replace(/:/g, "");

  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const bow = Math.min(60, length * 0.22);
  const d = `M ${from.x} ${from.y} Q ${midX - (dy / length) * bow} ${midY + (dx / length) * bow} ${
    to.x - (dx / length) * 26
  } ${to.y - (dy / length) * 26}`;

  return (
    <svg className="pointer-events-none fixed inset-0 h-full w-full" style={{ zIndex }} aria-hidden>
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto"
        >
          <path d="M0 0 L10 5 L0 10 z" fill="var(--accent)" />
        </marker>
      </defs>
      <motion.path
        key={redrawKey}
        d={d}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray="7 7"
        markerEnd={`url(#${markerId})`}
        initial={reduceMotion ? { pathLength: 1 } : { pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: reduceMotion ? 0 : 0.5, delay: reduceMotion ? 0 : 0.25 }}
      />
    </svg>
  );
}
