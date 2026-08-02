"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import TourGuide from "@/components/TourGuide";
import { CheckIcon } from "@/components/icons";

/**
 * The first sixty seconds in the portal, as a guided walk.
 *
 * What this replaces was four slides in a box with a Next button. It told a
 * student that Materials has a Watch tab; it did not show them where Materials
 * is, so on slide five they were back where they started, looking at thirteen
 * sidebar entries.
 *
 * This one points. Every step spotlights a REAL element in the portal — the
 * actual sidebar button, found by the `data-tour` attribute the shell puts on
 * it — cuts a hole in the dimmer around it, and stands the school's little
 * scholar next to it with an arm out and an arrow drawn from their hand to the
 * thing. Nothing here is a picture of the portal, so nothing here can drift
 * out of date with the portal.
 *
 * Mobile is the case that shaped the layout. Below `lg` the sidebar is a
 * drawer, so a nav step opens it first (the shell listens for
 * `easyway:tour-drawer`), the card sits along the bottom edge where a thumb
 * is, and the guide shrinks and tucks beside the card rather than standing in
 * the middle of a 375px screen.
 *
 * Progress is collected rather than counted: each step earns a stamp, and the
 * last one is a small celebration. It runs once per ACCOUNT, not per device
 * (`Student.welcomeTourSeenAt`), and skipping counts as seeing it.
 */

type Onboarding = {
  firstName: string | null;
  level: string;
  branchName: string | null;
  isOnlineBranch: boolean;
  /** physical | hybrid | online — see /api/student/onboarding. */
  deliveryMode?: string;
  sessionSlot: string;
  tourSeen: boolean;
};

type Step = {
  id: string;
  /** CSS selector for the element to spotlight. Absent = centre stage. */
  target?: string;
  /** Opens the mobile drawer first, because the target lives inside it. */
  inSidebar?: boolean;
  eyebrow: string;
  title: string;
  body: string;
  /** The word on the stamp this step earns. */
  stamp: string;
};

type Rect = { top: number; left: number; width: number; height: number };

const PAD = 8;
const CARD_GAP = 18;

function buildSteps(profile: Onboarding): Step[] {
  // Three products, not two. A hybrid student is at a campus and has a live
  // room; introducing them as one or the other describes half their portal.
  const mode = profile.deliveryMode ?? (profile.isOnlineBranch ? "online" : "physical");
  const isOnline = mode === "online";
  const isHybrid = mode === "hybrid";

  const where = isOnline
    ? "You study online, so your classroom travels with you."
    : isHybrid && profile.branchName
      ? `You are at our ${profile.branchName} campus, and you can join the same class live over video when you cannot get in.`
      : profile.branchName
        ? `You are at our ${profile.branchName} campus.`
        : "";

  return [
    {
      id: "welcome",
      eyebrow: "Willkommen",
      title: profile.firstName ? `Hallo, ${profile.firstName}.` : "Hallo.",
      body: `You are starting at ${profile.level}. ${where} Give me forty seconds and I will show you the four things you will actually use — then you never have to see me again.`,
      stamp: "Hallo",
    },
    {
      id: "classes",
      target: isOnline ? '[data-tour="nav:/live"]' : '[data-tour="nav:/calendar"]',
      inSidebar: true,
      eyebrow: "Every week",
      title: isOnline ? "Your class opens here" : "Your timetable lives here",
      body: isOnline
        ? `Your ${profile.sessionSlot} session runs live over video. Pick your video quality before you join — on mobile data, Data saver keeps the lesson steady instead of frozen.`
        : isHybrid
          ? `Your ${profile.sessionSlot} session, the topic for each day, and anything your tutor attaches are all on this calendar. If a class is postponed it turns pink here with the new date. Live class, just below, is the same lesson over video.`
          : `Your ${profile.sessionSlot} session, the topic for each day, and anything your tutor attaches are all on this calendar. If a class is postponed it turns pink here with the new date.`,
      stamp: "Class",
    },
    {
      id: "materials",
      target: '[data-tour="nav:/materials"]',
      inSidebar: true,
      eyebrow: "If you miss one",
      title: "Every class is recorded",
      body: "Materials has a Watch tab. Recordings land there the same day, and the player picks up exactly where your connection dropped. Missing a class costs you minutes, not the lesson.",
      stamp: "Watch",
    },
    {
      id: "community",
      target: '[data-tour="nav:/community"]',
      inSidebar: true,
      eyebrow: "You are not alone in this",
      title: "Your class is in here",
      body: "Your branch and level have their own space. Ask questions between classes and practise with the people sitting the same exam as you — students who post in their first week finish at nearly twice the rate.",
      stamp: "Talk",
    },
    {
      id: "payments",
      target: '[data-tour="nav:/payments"]',
      inSidebar: true,
      eyebrow: "The one to know about",
      title: "Tuition lives here",
      body: "Your balance, what is due and every receipt. Classes, assignments and certificates unlock once tuition is settled, and you can pay in parts — this page always shows exactly what is left, with no surprises.",
      stamp: "Fees",
    },
    {
      id: "done",
      eyebrow: "That is everything",
      title: "You are ready.",
      body: "Viel Erfolg. If you forget where something is, everything I showed you is in the menu on the left — in that order.",
      stamp: "Los!",
    },
  ];
}

/**
 * Where the target sits, in viewport coordinates. Null while unknown.
 *
 * This keeps measuring for a beat rather than measuring once. On a phone the
 * target is a button inside the sidebar drawer, and the drawer takes 300ms to
 * slide in — a single measurement catches it at x = -272, off the left edge,
 * and the spotlight and the arrow are then both drawn off-screen. So it
 * re-measures every frame until the rectangle stops moving, and keeps a slow
 * watch afterwards for anything that shifts the layout later.
 */
function useTargetRect(selector: string | undefined, step: number): Rect | null {
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

      // Stop once it has held still for ~8 frames, or after about two seconds
      // — whichever comes first, so a drawer that never settles cannot spin.
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
  }, [selector, step]);

  return rect;
}

export default function WelcomeTour() {
  const reduceMotion = useReducedMotion();
  const [profile, setProfile] = useState<Onboarding | null>(null);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [walking, setWalking] = useState(false);
  const [viewport, setViewport] = useState({ width: 1024, height: 768 });
  const walkTimer = useRef<number | null>(null);

  const steps = profile ? buildSteps(profile) : [];
  const step = steps[index];
  const isLast = index === steps.length - 1;
  const isMobile = viewport.width < 1024;

  const rect = useTargetRect(step?.target, index);

  useEffect(() => {
    const measure = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/student/onboarding", { cache: "no-store" });
        if (!res.ok) return;
        const data: Onboarding = await res.json();
        if (cancelled || data.tourSeen) return;
        setProfile(data);
        setOpen(true);
      } catch {
        // The tour is a nicety. A dashboard that renders without it is fine;
        // one that fails to render because of it is not.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The sidebar is a drawer on a phone, so a step pointing at a nav entry has
  // to ask the shell to open it. The shell owns that state; this only asks.
  useEffect(() => {
    if (!open || !step) return;
    window.dispatchEvent(
      new CustomEvent("easyway:tour-drawer", { detail: { open: Boolean(step.inSidebar) } }),
    );
  }, [open, step]);

  // Lock the page behind the tour.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const finish = useCallback(() => {
    setOpen(false);
    window.dispatchEvent(new CustomEvent("easyway:tour-drawer", { detail: { open: false } }));
    // Fire and forget: the tour is already gone from the screen, and a failed
    // write costs the student one repeat, not their session.
    void fetch("/api/student/onboarding", { method: "POST" }).catch(() => {});
  }, []);

  const go = useCallback(
    (next: number) => {
      if (next < 0 || next >= steps.length) return;
      setWalking(true);
      if (walkTimer.current) window.clearTimeout(walkTimer.current);
      walkTimer.current = window.setTimeout(() => setWalking(false), 520);
      setIndex(next);
    },
    [steps.length],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
      if (event.key === "ArrowRight") go(index + 1);
      if (event.key === "ArrowLeft") go(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, index, go, finish]);

  useEffect(
    () => () => {
      if (walkTimer.current) window.clearTimeout(walkTimer.current);
    },
    [],
  );

  if (!profile || !step) return null;

  // --- Layout -------------------------------------------------------------
  //
  // Everything below positions three things around the spotlight: the card,
  // the guide, and the arrow between the guide's hand and the target.

  const hole = rect
    ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }
    : null;

  const cardWidth = isMobile ? Math.min(viewport.width - 24, 460) : 420;
  const guideSize = isMobile ? 104 : 150;
  // Roughly how tall the card gets with its longest body text. Only used to
  // keep it inside the viewport; the card itself is not measured because it
  // has to be positioned in the same pass that renders it.
  const CARD_HEIGHT = 360;

  // On a phone the card owns one end of the screen; on a desktop it sits
  // beside the spotlight with the guide standing in the gap between them.
  let cardLeft: number;
  let cardTop: number;

  if (!hole) {
    cardLeft = (viewport.width - cardWidth) / 2;
    cardTop = isMobile ? viewport.height - 400 : viewport.height / 2 - 190;
  } else if (isMobile) {
    cardLeft = (viewport.width - cardWidth) / 2;
    // Along the bottom, where a thumb is — unless the spotlight is down there
    // too, in which case the card moves to the top rather than sitting on top
    // of the thing it is describing. A target low in a long sidebar is the
    // normal case, not the exception.
    const bottomCardTop = viewport.height - 340;
    cardTop = hole.top + hole.height > bottomCardTop - 24 ? 16 : bottomCardTop;
  } else {
    // Guide first, then the card beyond it. Placing the card first and backing
    // the guide out of it is what put the guide on top of the spotlight: the
    // gap between spotlight and card is exactly where the guide has to stand.
    const rightRoom = viewport.width - (hole.left + hole.width);
    cardLeft =
      rightRoom > cardWidth + guideSize + CARD_GAP * 2
        ? hole.left + hole.width + guideSize + CARD_GAP * 2
        : Math.max(16, hole.left - cardWidth - guideSize - CARD_GAP * 2);
    cardTop = Math.min(
      Math.max(16, hole.top + hole.height / 2 - CARD_HEIGHT / 2),
      Math.max(16, viewport.height - CARD_HEIGHT - 16),
    );
  }

  // The guide has to stand CLEAR of the spotlight, not over it — it is
  // pointing at the thing, and a guide standing on top of what it is pointing
  // at both hides it and leaves the arm with no direction to point in.
  //
  // On a phone that means beside the spotlight when there is room — and below
  // it when there is not. A 375px screen with a 272px drawer cannot fit the
  // guide next to a 248px-wide sidebar button, and clamping it to the edge
  // just puts it back on top of the target.
  const roomRight = hole ? viewport.width - (hole.left + hole.width) : 0;
  const roomLeft = hole ? hole.left : 0;
  const sideBySide = Math.max(roomRight, roomLeft) >= guideSize + 20;

  let guideLeft: number;
  let guideTop: number;

  if (!hole) {
    guideLeft = (viewport.width - guideSize) / 2;
    guideTop = cardTop - guideSize + 10;
  } else if (!isMobile) {
    // In the gap, hard against the spotlight it is pointing at, on whichever
    // side the card went.
    guideLeft =
      cardLeft > hole.left
        ? hole.left + hole.width + CARD_GAP
        : Math.max(12, hole.left - guideSize - CARD_GAP);
    guideTop = Math.max(
      12,
      Math.min(hole.top + hole.height / 2 - guideSize / 2, viewport.height - guideSize - 12),
    );
  } else if (sideBySide) {
    guideLeft =
      roomRight >= roomLeft
        ? hole.left + hole.width + 12
        : Math.max(12, hole.left - guideSize - 12);
    guideTop = Math.max(
      12,
      Math.min(hole.top + hole.height / 2 - guideSize / 2, viewport.height - guideSize - 12),
    );
  } else {
    // Stacked. Above the spotlight when there is room above it, below when
    // there is not — clamping to the top edge instead would stand the guide's
    // feet in the spotlight, which is the thing this whole branch exists to
    // avoid. The card holds one end of the screen, so only the other is free.
    const cardAtTop = cardTop < viewport.height / 2;
    const freeAbove = hole.top - (cardAtTop ? cardTop + 300 : 12);
    const freeBelow = (cardAtTop ? viewport.height - 12 : cardTop) - (hole.top + hole.height);

    guideLeft = Math.max(
      12,
      Math.min(viewport.width - guideSize - 12, hole.left + hole.width - guideSize * 0.9),
    );
    guideTop =
      freeAbove >= guideSize + 12
        ? hole.top - guideSize - 12
        : freeBelow >= guideSize + 12
          ? hole.top + hole.height + 12
          : // Neither fits: sit it off the spotlight's right edge and accept
            // the tighter fit rather than covering the target.
            Math.max(12, Math.min(viewport.height - guideSize - 12, hole.top - guideSize / 2));
  }

  // The pointing hand sits at roughly 88% across and 55% down the artwork.
  const handX = guideLeft + guideSize * 0.88;
  const handY = guideTop + guideSize * 0.55;
  const targetX = hole ? hole.left + hole.width / 2 : 0;
  const targetY = hole ? hole.top + hole.height / 2 : 0;

  const angle = hole ? (Math.atan2(targetY - handY, targetX - handX) * 180) / Math.PI : 0;
  // The arm is drawn pointing right and swings about the shoulder; clamped so
  // it never folds back through the body.
  const armAngle = Math.max(-110, Math.min(110, angle));

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label="Welcome to your student portal"
          className="fixed inset-0 z-[130]"
        >
          {/* The dimmer, with a hole cut in it. An SVG mask rather than four
              divs around the target, so the corners can be rounded and the
              hole can animate from one element to the next. */}
          <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
            <defs>
              <mask id="tour-spotlight">
                <rect width="100%" height="100%" fill="white" />
                {hole && (
                  // The hole is moved by translating a <g>, not by animating
                  // x/y on the <rect>. Framer maps x and y to a transform on
                  // some SVG elements and to attributes on others; on the rect
                  // it set neither, and the hole stayed at the origin.
                  <motion.g
                    initial={false}
                    animate={{ x: hole.left, y: hole.top }}
                    transition={
                      reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 30 }
                    }
                  >
                    <rect width={hole.width} height={hole.height} rx={16} fill="black" />
                  </motion.g>
                )}
              </mask>
            </defs>
            <rect width="100%" height="100%" fill="rgb(2 6 23 / 0.82)" mask="url(#tour-spotlight)" />
          </svg>

          {/* A ring around the spotlight, so the hole reads as deliberate. */}
          {hole && (
            <motion.div
              initial={false}
              animate={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
              transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 30 }}
              className="pointer-events-none absolute rounded-2xl ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-transparent"
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

          {/* The arrow from the guide's hand to the spotlight. Quadratic, with
              the control point pushed perpendicular to the line, so it bows
              rather than cutting straight across the artwork. */}
          {hole && (
            <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
              <defs>
                <marker id="tour-arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                  <path d="M0 0 L10 5 L0 10 z" fill="var(--accent)" />
                </marker>
              </defs>
              <motion.path
                key={step.id}
                d={(() => {
                  const midX = (handX + targetX) / 2;
                  const midY = (handY + targetY) / 2;
                  const dx = targetX - handX;
                  const dy = targetY - handY;
                  const length = Math.hypot(dx, dy) || 1;
                  const bow = Math.min(60, length * 0.22);
                  return `M ${handX} ${handY} Q ${midX - (dy / length) * bow} ${midY + (dx / length) * bow} ${targetX - (dx / length) * 26} ${targetY - (dy / length) * 26}`;
                })()}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={3}
                strokeLinecap="round"
                strokeDasharray="7 7"
                markerEnd="url(#tour-arrowhead)"
                initial={reduceMotion ? { pathLength: 1 } : { pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: reduceMotion ? 0 : 0.5, delay: reduceMotion ? 0 : 0.25 }}
              />
            </svg>
          )}

          {/* The guide */}
          <motion.div
            initial={false}
            animate={{ left: guideLeft, top: guideTop }}
            transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 180, damping: 22 }}
            className="pointer-events-none absolute"
            style={{ width: guideSize, height: guideSize }}
          >
            <TourGuide
              angle={armAngle}
              walking={walking}
              celebrating={isLast}
              className="h-full w-full drop-shadow-2xl"
            />
          </motion.div>

          {/* The card */}
          <motion.div
            initial={false}
            animate={{ left: cardLeft, top: cardTop }}
            transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 200, damping: 26 }}
            className="absolute overflow-hidden rounded-[26px] bg-[var(--surface)] shadow-2xl"
            style={{ width: cardWidth }}
          >
            <div className="h-1.5 w-full bg-[var(--border)]">
              <motion.div
                className="h-full bg-[var(--accent)]"
                initial={false}
                animate={{ width: `${((index + 1) / steps.length) * 100}%` }}
                transition={{ type: "spring", stiffness: 200, damping: 28 }}
              />
            </div>

            <div className="p-5 sm:p-6">
              {/* Stamps. Collected, not counted — a step you have done stays
                  visibly done, which is the whole difference from "3 of 6". */}
              <div className="flex items-center gap-1.5">
                {steps.map((s, i) => {
                  const done = i < index;
                  const current = i === index;
                  return (
                    <button
                      key={s.id}
                      onClick={() => go(i)}
                      aria-label={`Step ${i + 1}: ${s.title}`}
                      className={`flex h-6 items-center gap-1 rounded-full px-2 text-[10px] font-bold uppercase tracking-wide transition-all ${
                        current
                          ? "bg-[var(--accent)] text-white"
                          : done
                            ? "bg-emerald-500/15 text-emerald-600"
                            : "bg-[var(--border)]/60 text-[var(--muted)]"
                      }`}
                    >
                      {done && <CheckIcon className="h-2.5 w-2.5" strokeWidth={3} />}
                      {(current || done) && <span>{s.stamp}</span>}
                    </button>
                  );
                })}
              </div>

              <motion.p
                key={`eyebrow-${step.id}`}
                initial={reduceMotion ? {} : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 text-[11px] font-bold uppercase tracking-[0.28em] text-[var(--accent)]"
              >
                {step.eyebrow}
              </motion.p>

              <motion.h2
                key={`title-${step.id}`}
                initial={reduceMotion ? {} : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 }}
                className="mt-1.5 text-xl font-bold leading-tight sm:text-2xl"
              >
                {step.title}
              </motion.h2>

              <motion.p
                key={`body-${step.id}`}
                initial={reduceMotion ? {} : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="mt-2.5 min-h-[76px] text-sm leading-relaxed text-[var(--muted)]"
              >
                {step.body}
              </motion.p>

              <div className="mt-5 flex items-center gap-2.5">
                {index > 0 && (
                  <button
                    onClick={() => go(index - 1)}
                    className="rounded-full border border-[var(--border)] px-4 py-3 text-sm font-semibold text-[var(--muted)] transition hover:text-[var(--foreground)]"
                  >
                    Back
                  </button>
                )}
                <button
                  onClick={() => (isLast ? finish() : go(index + 1))}
                  className="flex-1 rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-bold text-white shadow-lg shadow-[var(--accent)]/25 transition hover:brightness-110"
                >
                  {isLast ? "Take me in" : "Show me"}
                </button>
              </div>

              {!isLast && (
                <button
                  onClick={finish}
                  className="mt-2.5 w-full text-center text-xs text-[var(--muted)] transition hover:underline"
                >
                  Skip — I will find my way
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
