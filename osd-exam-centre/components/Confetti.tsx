"use client";

import { useEffect, useRef } from "react";

const COLORS = ["#FF6600", "#FF7A1A", "#0b1f3a", "#FFE4CC", "#1f6f4a"];

type Particle = {
  x: number; y: number; vx: number; vy: number;
  size: number; color: string; rotation: number; spin: number;
};

/**
 * A one-shot confetti burst for the single moment on this site that earns
 * one — a booking actually going through. No library: this fires once per
 * page load and a dependency for ~80 rectangles for three seconds isn't
 * worth the install. Respects prefers-reduced-motion by not running at all.
 */
export default function Confetti() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const count = 110;
    const particles: Particle[] = Array.from({ length: count }, () => ({
      x: Math.random() * window.innerWidth,
      y: -20 - Math.random() * window.innerHeight * 0.4,
      vx: (Math.random() - 0.5) * 3.2,
      vy: 2.5 + Math.random() * 3.5,
      size: 5 + Math.random() * 5,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rotation: Math.random() * 360,
      spin: (Math.random() - 0.5) * 12,
    }));

    const start = performance.now();
    const DURATION = 3200;
    let frame: number;

    function tick(now: number) {
      const elapsed = now - start;
      ctx!.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.035;
        p.rotation += p.spin;
        ctx!.save();
        ctx!.translate(p.x, p.y);
        ctx!.rotate((p.rotation * Math.PI) / 180);
        ctx!.fillStyle = p.color;
        ctx!.globalAlpha = Math.max(0, 1 - elapsed / DURATION);
        ctx!.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx!.restore();
      }
      if (elapsed < DURATION) {
        frame = requestAnimationFrame(tick);
      }
    }
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-50"
    />
  );
}
