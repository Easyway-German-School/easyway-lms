"use client";

import { useEffect, useState } from "react";

/**
 * The school's loading state, built around the emblem.
 *
 *   <BrandLoader />                    inline, drops into a card or a panel
 *   <BrandLoader fullscreen />         covers the viewport, for route changes
 *
 * The emblem breathes inside two counter-rotating orbit rings, with a light
 * sweep across the badge. It deliberately does not spin the artwork: the
 * mortarboard gives the logo a fixed "up", and rotating it reads as a bug.
 *
 * Copy rotates through German/English pairs — the wait is a few free seconds
 * of exposure to the language, which beats "Loading…". Motion is disabled
 * under prefers-reduced-motion (see globals.css); the phrase rotation stops
 * too, since moving text is the part that actually causes trouble.
 */

const MARK_SRC = "/logo-mark.png";

/**
 * The school's name, under the emblem, on every loading screen.
 *
 * The mark alone is not a brand to somebody who has seen it twice — a student
 * waiting for their dashboard on a slow Nigerian connection is looking at this
 * screen for several seconds, and those seconds should tell them whose school
 * they are in. The rotating German phrase sits below it and keeps doing its
 * job; this replaces nothing, it just stops the wordless emblem being the only
 * thing on the screen.
 */
const SCHOOL_NAME = "EasyWay Language School";

/** German first, gloss second. Kept short so they don't wrap on mobile. */
const PHRASES: ReadonlyArray<{ de: string; en: string }> = [
  { de: "Einen Moment, bitte…", en: "One moment, please" },
  { de: "Wir bereiten alles vor.", en: "We're getting everything ready" },
  { de: "Fast fertig!", en: "Almost there" },
  { de: "Deine Klasse wird geladen.", en: "Loading your classroom" },
  { de: "Übung macht den Meister.", en: "Practice makes perfect" },
];

const SIZES = {
  sm: { box: 72, ring: 104, text: "text-xs" },
  md: { box: 112, ring: 156, text: "text-sm" },
  lg: { box: 152, ring: 212, text: "text-base" },
} as const;

type Size = keyof typeof SIZES;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

/**
 * The emblem, orbit rings and glow. Exported on its own so headers and buttons
 * can borrow the animated mark without the surrounding copy.
 */
export function BrandLoaderMark({ size = "md" }: { size?: Size }) {
  const { box, ring } = SIZES[size];

  return (
    <div className="relative flex shrink-0 items-center justify-center" style={{ width: ring, height: ring }}>
      {/* Soft brand glow behind everything. */}
      <div
        aria-hidden
        className="absolute inset-0 rounded-full blur-2xl"
        style={{
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--accent) 35%, transparent), transparent 68%)",
        }}
      />

      {/* Ripples pushing outward, staggered so there is always one mid-flight. */}
      {[0, 1.4].map((delay) => (
        <div
          key={delay}
          aria-hidden
          className="ew-ripple absolute inset-0 rounded-full border"
          style={{ borderColor: "color-mix(in srgb, var(--accent-strong) 45%, transparent)", animationDelay: `${delay}s` }}
        />
      ))}

      {/* Orbit ring — orange, clockwise. A conic gradient masked to a hairline
          ring gives a comet tail without any SVG. */}
      <div
        aria-hidden
        className="ew-orbit absolute inset-0 rounded-full"
        style={{
          background: `conic-gradient(from 0deg, transparent 0deg, transparent 200deg, var(--accent) 340deg, transparent 360deg)`,
          mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))",
          WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))",
        }}
      />

      {/* Orbit ring — teal, counter-clockwise and slower, inset slightly. */}
      <div
        aria-hidden
        className="ew-orbit-reverse absolute rounded-full"
        style={{
          inset: 8,
          background: `conic-gradient(from 0deg, transparent 0deg, transparent 250deg, var(--accent-strong) 350deg, transparent 360deg)`,
          mask: "radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px))",
          WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px))",
        }}
      />

      {/* The emblem. */}
      <div className="ew-breathe relative" style={{ width: box, height: box }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={MARK_SRC}
          alt=""
          width={box}
          height={box}
          className="h-full w-full object-contain drop-shadow-[0_10px_24px_rgba(13,124,126,0.28)]"
          // Decoding synchronously avoids a one-frame gap where the loader
          // itself appears to be loading.
          decoding="sync"
          fetchPriority="high"
        />

        {/* Light sweep, clipped to the emblem's box. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[22%]">
          <div
            className="ew-sweep absolute inset-y-0 w-1/3"
            style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)" }}
          />
        </div>
      </div>
    </div>
  );
}

export default function BrandLoader({
  size = "md",
  title,
  message,
  fullscreen = false,
  fill = false,
  className = "",
}: {
  size?: Size;
  /** Overrides the rotating German phrase. */
  title?: string;
  /** Secondary line. Defaults to the gloss of the current phrase. */
  message?: string;
  /**
   * Cover the viewport with a fixed, opaque backdrop. For waits that own the
   * whole screen and must not be scrolled away from — submitting a sign-in.
   */
  fullscreen?: boolean;
  /**
   * Fill the viewport height but stay in normal flow. For route-level
   * loading.tsx, where a fixed overlay would sit above modals and toasts.
   */
  fill?: boolean;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const { text } = SIZES[size];

  useEffect(() => {
    // A fixed title means the caller is describing a specific wait; rotating
    // generic phrases underneath it would just be noise.
    if (reduced || title) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % PHRASES.length);
    }, 2600);
    return () => window.clearInterval(timer);
  }, [reduced, title]);

  const phrase = PHRASES[index];

  const body = (
    <div className={`flex flex-col items-center gap-5 text-center ${className}`}>
      <BrandLoaderMark size={size} />

      <div className="space-y-1.5">
        <p className="text-[0.7rem] font-bold uppercase tracking-[0.28em] text-[var(--accent)] sm:text-xs">
          {SCHOOL_NAME}
        </p>

        {/* key on the phrase so each swap re-triggers the fade-up. */}
        <p
          key={title ?? phrase.de}
          className="ew-fade-up text-lg font-semibold tracking-tight text-[var(--foreground)] sm:text-xl"
        >
          {title ?? phrase.de}
        </p>
        <p className={`${text} text-[var(--muted)]`}>{message ?? phrase.en}</p>
      </div>

      {/* Indeterminate track. */}
      <div
        className="relative h-1 w-40 overflow-hidden rounded-full sm:w-52"
        style={{ background: "color-mix(in srgb, var(--accent-strong) 14%, transparent)" }}
      >
        <div
          className="ew-track absolute inset-y-0 w-1/3 rounded-full"
          style={{ background: "linear-gradient(90deg, var(--accent-strong), var(--accent))" }}
        />
      </div>
    </div>
  );

  // Announced politely so screen readers report the wait without stealing
  // focus from whatever the user was doing.
  const a11y = { role: "status", "aria-live": "polite" as const, "aria-busy": true };

  if (!fullscreen && !fill) {
    return (
      <div {...a11y} className="flex w-full items-center justify-center py-12">
        {body}
        <span className="sr-only">{title ?? phrase.en}</span>
      </div>
    );
  }

  return (
    <div
      {...a11y}
      className={
        fullscreen
          ? "fixed inset-0 z-[100] flex items-center justify-center overflow-hidden px-6"
          : "relative flex min-h-[80svh] w-full items-center justify-center overflow-hidden px-6"
      }
      // The `background` shorthand, not Tailwind's bg-[var(--background)]:
      // that compiles to `background-color`, which silently discards a value
      // like `linear-gradient(...)` — leaving this overlay transparent and the
      // page behind it showing through.
      style={fullscreen ? { background: "var(--background)" } : undefined}
    >
      {/* Two drifting auroras in the brand colours, so a whole-screen wait has
          some depth instead of reading as a dead page. The fill variant sits
          on top of PageContainer's own scene, so these stay subtle. */}
      <div
        aria-hidden
        className="animate-blob pointer-events-none absolute -left-24 top-0 h-[26rem] w-[26rem] rounded-full blur-[100px]"
        style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--accent) 22%, transparent), transparent 60%)" }}
      />
      <div
        aria-hidden
        className="animate-blob animation-delay-4000 pointer-events-none absolute -right-24 bottom-0 h-[26rem] w-[26rem] rounded-full blur-[100px]"
        style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--accent-strong) 22%, transparent), transparent 60%)" }}
      />
      <div className="relative z-10">{body}</div>
      <span className="sr-only">{title ?? phrase.en}</span>
    </div>
  );
}
