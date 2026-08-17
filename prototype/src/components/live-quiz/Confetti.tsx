"use client";

/**
 * The paper that falls on the podium.
 *
 * A canvas rather than a few hundred animated DOM nodes, and no library: this
 * runs on a school laptop that is also holding a video call open, and the
 * cheapest way to drop two hundred rectangles is to draw them yourself. The
 * whole thing is one element, one rAF loop, and it removes itself when the
 * pieces have landed.
 *
 * It STOPS. A permanent celebration is wallpaper — the tutor still has to read
 * the scores off this screen, and confetti falling behind a leaderboard for the
 * rest of the lesson makes the names harder to read for no further payoff.
 */

import { useEffect, useRef } from "react";

type Piece = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  spin: number;
  angle: number;
  colour: string;
};

/** Brand orange, the teal the countdown uses, and two neutrals to break it up. */
const COLOURS = ["#FF6600", "#FFA347", "#2dd4bf", "#f4fbfa", "#fdba74"];

const PIECES = 180;
/** Long enough to be seen from the back of a room, short enough not to nag. */
const RUN_MS = 5200;

export default function Confetti() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    // Guard the whole thing: a browser that cannot give us a canvas context
    // must lose the confetti, not the final scores.
    let frame = 0;
    let running = true;

    // Capped at 2 — a 3x device pixel ratio on a large projector is a canvas
    // big enough to drop frames, and this is decoration.
    const scale = Math.min(2, window.devicePixelRatio || 1);

    function resize() {
      if (!canvas) return;
      canvas.width = Math.floor(window.innerWidth * scale);
      canvas.height = Math.floor(window.innerHeight * scale);
    }
    resize();
    window.addEventListener("resize", resize);

    const pieces: Piece[] = Array.from({ length: PIECES }, () => ({
      x: Math.random() * canvas.width,
      // Staggered above the top edge so they arrive as a shower rather than a
      // single curtain crossing the screen.
      y: -Math.random() * canvas.height * 0.6,
      vx: (Math.random() - 0.5) * 0.9 * scale,
      vy: (1.6 + Math.random() * 2.4) * scale,
      size: (5 + Math.random() * 7) * scale,
      spin: (Math.random() - 0.5) * 0.22,
      angle: Math.random() * Math.PI,
      colour: COLOURS[Math.floor(Math.random() * COLOURS.length)],
    }));

    const started = performance.now();

    function draw(now: number) {
      if (!running || !canvas || !context) return;

      const elapsed = now - started;
      // Fades over the last second instead of vanishing mid-air.
      const fade = elapsed > RUN_MS - 1000 ? Math.max(0, (RUN_MS - elapsed) / 1000) : 1;

      context.clearRect(0, 0, canvas.width, canvas.height);
      context.globalAlpha = fade;

      for (const piece of pieces) {
        piece.x += piece.vx;
        piece.y += piece.vy;
        piece.angle += piece.spin;
        // Drift, so they do not fall in straight lines.
        piece.vx += (Math.random() - 0.5) * 0.06 * scale;

        if (piece.y > canvas.height + piece.size) {
          piece.y = -piece.size;
          piece.x = Math.random() * canvas.width;
        }

        context.save();
        context.translate(piece.x, piece.y);
        context.rotate(piece.angle);
        context.fillStyle = piece.colour;
        // Half height, so a spinning piece reads as paper rather than a cube.
        context.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
        context.restore();
      }

      context.globalAlpha = 1;

      if (elapsed < RUN_MS) frame = requestAnimationFrame(draw);
      else context.clearRect(0, 0, canvas.width, canvas.height);
    }

    frame = requestAnimationFrame(draw);

    return () => {
      running = false;
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        // Above the podium, but it must never eat the tutor's clicks — the
        // "End game" button is underneath this.
        pointerEvents: "none",
        zIndex: 5,
      }}
    />
  );
}
