"use client";

/**
 * The road, drawn.
 *
 * GEOMETRY, so nobody re-derives it and re-breaks it:
 *
 * There is no path maths here at all, and that is deliberate. The class-day map
 * on /calendar draws a real Catmull-Rom spline and pays for it with three
 * hydration and measurement traps (see JourneyMap.tsx). This map has a harder
 * job — the cards are different heights, the copy reflows, and it has to work
 * from 320px to a wide desktop — so the road is built out of PER-ROW SEGMENTS
 * instead of one long path:
 *
 *   every stage is a grid row; the spine column holds a half-height line above
 *   the node and a half-height line below it, and the node sits at the row's
 *   vertical centre.
 *
 * Consecutive rows join seamlessly because each row's lower half meets the next
 * row's upper half. Nothing is measured, nothing is positioned in pixels, and a
 * card that grows by two lines of text simply makes its own segment longer.
 * The partially-lit segment under the current stage is a CSS gradient stop, not
 * a stroke-dash calculation.
 *
 * LAYOUT: the spine runs down the left on a phone with every card to its right,
 * and moves to the centre with cards alternating from `sm` up. Alternating at
 * 320px gives you two 130px columns, which is where a first-person sentence
 * goes to die.
 */

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CheckIcon, LockIcon, ChevronDownIcon, FlagIcon, SparklesIcon } from "@/components/icons";
import type { JourneyStage, StageStatus } from "@/lib/germany-journey";

/* -------------------------------------------------------------------------- */
/* The sky                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The map warms up as they get closer.
 *
 * Cold lilac at the start, gold at the end. It is a slow, cumulative reward the
 * student never has to be told about — the screen simply looks different in
 * month six than it did in week one, and they notice without noticing. The
 * reference designs did this and it is the best idea in them after the
 * first-person voice.
 *
 * The stops are TRANSLUCENT and layered over `--surface-alt` rather than being
 * opaque colours. A fixed 96%-lightness sky is a white slab in Nacht and
 * Dämmerung, and this school ships three themes — so the hue is the school's
 * and the lightness is the theme's.
 */
function skyFor(percent: number): string {
  const p = Math.max(0, Math.min(100, percent)) / 100;
  // Hue travels 265° (cold violet) → 38° (gold) the short way round the wheel.
  const hue = 265 - p * 227;
  const sat = 46 + p * 26;
  const stop = (shift: number, alpha: number) =>
    `hsl(${(hue - shift).toFixed(0)} ${(sat - shift / 2).toFixed(0)}% 62% / ${alpha})`;

  return `linear-gradient(160deg, ${stop(0, 0.24)}, ${stop(14, 0.16)} 55%, ${stop(30, 0.26)}), var(--surface-alt)`;
}

/* -------------------------------------------------------------------------- */
/* Landmarks                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Silhouettes behind the road: the Brandenburg Gate near the top, a Bavarian
 * castle in the middle, a Berlin skyline at the end. Drawn rather than
 * imported so the map never waits on artwork and never shows a torn-image icon
 * on somebody's dashboard because a file was renamed.
 */
function Landmark({ kind, className = "" }: { kind: "gate" | "castle" | "city"; className?: string }) {
  const shapes = {
    gate: (
      <>
        <rect x="8" y="30" width="84" height="6" />
        <rect x="14" y="36" width="8" height="34" />
        <rect x="30" y="36" width="8" height="34" />
        <rect x="46" y="36" width="8" height="34" />
        <rect x="62" y="36" width="8" height="34" />
        <rect x="78" y="36" width="8" height="34" />
        <rect x="4" y="70" width="92" height="6" />
        <rect x="38" y="18" width="24" height="12" />
      </>
    ),
    castle: (
      <>
        <path d="M20 76V44l12-16 12 16v32z" />
        <path d="M52 76V36l14-20 14 20v40z" />
        <rect x="14" y="72" width="72" height="6" />
        <path d="M32 28l4-10 4 10z" />
        <path d="M62 16l4-10 4 10z" />
      </>
    ),
    city: (
      <>
        <rect x="10" y="52" width="14" height="24" />
        <rect x="28" y="40" width="12" height="36" />
        <rect x="44" y="58" width="10" height="18" />
        <path d="M62 76V30l5-16 5 16v46z" />
        <rect x="78" y="46" width="12" height="30" />
        <rect x="6" y="74" width="88" height="4" />
      </>
    ),
  } as const;

  return (
    <svg
      viewBox="0 0 100 80"
      aria-hidden
      className={`pointer-events-none absolute select-none fill-current ${className}`}
    >
      {shapes[kind]}
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* The node on the spine                                                      */
/* -------------------------------------------------------------------------- */

function StageNode({ stage, reduced }: { stage: JourneyStage; reduced: boolean }) {
  const base = "relative z-10 grid place-items-center rounded-full font-bold transition-shadow";

  if (stage.status === "done") {
    return (
      <div
        className={`${base} h-11 w-11 bg-gradient-to-br from-[#0D7C7E] to-[#FF6600] text-white shadow-[0_6px_18px_-4px_rgba(13,124,126,0.6)]`}
      >
        <CheckIcon className="h-5 w-5" strokeWidth={3} />
      </div>
    );
  }

  if (stage.status === "current") {
    return (
      <div className="relative z-10 grid h-14 w-14 place-items-center">
        {/* Two rings, offset in time, so the pulse reads as a heartbeat rather
            than a blink. Suppressed entirely under prefers-reduced-motion —
            this is the one element on the page that never stops moving. */}
        {!reduced &&
          [0, 1].map((ring) => (
            <motion.span
              key={ring}
              aria-hidden
              initial={{ scale: 0.7, opacity: 0.55 }}
              animate={{ scale: 1.9, opacity: 0 }}
              transition={{ duration: 2.6, delay: ring * 1.3, repeat: Infinity, ease: "easeOut" }}
              className="absolute h-12 w-12 rounded-full border-2 border-[var(--accent)]"
            />
          ))}
        <div
          className={`${base} h-12 w-12 border-[3px] border-[var(--accent)] bg-[var(--surface)] text-base text-[var(--accent-ink)] shadow-[0_8px_24px_-6px_rgba(255,102,0,0.7)]`}
        >
          {stage.step}
        </div>
      </div>
    );
  }

  if (stage.status === "next") {
    return (
      <div
        className={`${base} h-11 w-11 border-2 border-dashed border-[var(--border-strong)] bg-[var(--surface)] text-sm text-[var(--muted)]`}
      >
        {stage.step}
      </div>
    );
  }

  return (
    <div className={`${base} h-10 w-10 bg-[var(--surface-alt)] text-[var(--muted)] ring-1 ring-[var(--border)]`}>
      <LockIcon className="h-4 w-4" />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The spine                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The two half-segments for one row.
 *
 * `litAbove` and `litBelow` are 0–1. The partial value is only ever used under
 * the stage they are standing on, where it shows how far through it they are —
 * so the road itself is the progress bar, and the level they are sitting in is
 * visibly half-paved.
 */
function Spine({ litAbove, litBelow, first, last }: { litAbove: number; litBelow: number; first: boolean; last: boolean }) {
  const dim = "var(--border)";
  const lit = "var(--accent-strong)";

  const gradient = (amount: number, direction: "to bottom" | "to top") =>
    amount >= 1
      ? lit
      : amount <= 0
        ? dim
        : `linear-gradient(${direction}, ${lit} ${(amount * 100).toFixed(0)}%, ${dim} ${(amount * 100).toFixed(0)}%)`;

  return (
    <>
      {!first ? (
        <span
          aria-hidden
          className="absolute left-1/2 top-0 h-1/2 w-[3px] -translate-x-1/2 rounded-full"
          // Drawn upward: the segment above a node fills from the node towards
          // the previous one, which is the direction the eye travelled.
          style={{ background: gradient(litAbove, "to top") }}
        />
      ) : null}
      {!last ? (
        <span
          aria-hidden
          className="absolute left-1/2 top-1/2 h-1/2 w-[3px] -translate-x-1/2 rounded-full"
          style={{ background: gradient(litBelow, "to bottom") }}
        />
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* The card                                                                   */
/* -------------------------------------------------------------------------- */

const CARD_TONE: Record<StageStatus, string> = {
  done: "border-[var(--accent-strong)]/25 bg-[var(--surface)]/85",
  current: "border-[var(--accent)] bg-[var(--surface)] shadow-[0_18px_50px_-18px_rgba(255,102,0,0.55)]",
  next: "border-[var(--border-strong)] bg-[var(--surface)]/75",
  locked: "border-[var(--border)] bg-[var(--surface-alt)]/60",
};

function StageCard({
  stage,
  expanded,
  onToggle,
  onClaim,
  claiming,
  cta,
}: {
  stage: JourneyStage;
  expanded: boolean;
  onToggle: () => void;
  onClaim?: (stage: JourneyStage, undo: boolean) => void;
  claiming: boolean;
  cta?: React.ReactNode;
}) {
  const sealed = stage.status === "locked";

  return (
    <motion.div layout className={`rounded-3xl border backdrop-blur-sm ${CARD_TONE[stage.status]}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-start gap-3 rounded-3xl p-4 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--muted)]">
              Step {stage.step}
            </span>
            {stage.status === "current" ? (
              <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                You are here
              </span>
            ) : null}
            {/* The next stage keeps its first-person line — reading the sentence
                you are about to earn is the point of showing it early. But
                without this pill an unearned "I finished A2" sits on the card
                looking exactly like the four above it that are true. */}
            {stage.status === "next" ? (
              <span className="rounded-full border border-[var(--border-strong)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
                Next up
              </span>
            ) : null}
            {stage.tribe && stage.status === "done" ? (
              <span className="rounded-full bg-[var(--success-soft)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--success)]">
                {stage.tribe}
              </span>
            ) : null}
          </div>

          {/* THE SENTENCE IS THE PRIZE, and it is only in quotation marks once
              it is true.

              A stage they have cleared says "I paid. My seat is mine." in their
              own voice, as a fact. A stage they have NOT cleared shows the same
              sentence as the thing waiting for them — because printing an
              unearned claim as though it were said is not just weak
              psychology, it is wrong: "I paid. My seat is mine." was appearing
              on the payment lock screen of somebody being asked to pay.

              A sealed stage gets no sentence at all. You cannot preview a line
              about a level you have not reached without spending it. */}
          {sealed ? (
            <>
              <p className="mt-1.5 text-base font-bold text-[var(--muted)]">{stage.label}</p>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{stage.teaser}</p>
            </>
          ) : stage.status === "done" ? (
            <>
              <p className="mt-1.5 text-[15px] font-bold leading-6 text-[var(--foreground)]">
                &ldquo;{stage.voice}&rdquo;
              </p>
              <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                {stage.label}
              </p>
            </>
          ) : (
            <>
              <p className="mt-1.5 text-base font-bold text-[var(--foreground)]">{stage.label}</p>
              <div className="mt-2 border-l-2 border-[var(--accent)]/40 pl-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                  Clear this and you get to say
                </p>
                <p className="mt-0.5 text-sm font-semibold italic leading-5 text-[var(--foreground-soft)]">
                  {stage.voice}
                </p>
              </div>
            </>
          )}

          {stage.status === "current" && stage.percent > 0 ? (
            <div className="mt-3">
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--border)]">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${stage.percent}%` }}
                  transition={{ duration: 0.9, ease: "easeOut" }}
                  className="h-full rounded-full bg-gradient-to-r from-[#0D7C7E] to-[#FF6600]"
                />
              </div>
              <p className="mt-1 text-[11px] font-semibold text-[var(--accent-ink)]">{stage.percent}% through</p>
            </div>
          ) : null}
        </div>

        <ChevronDownIcon
          className={`mt-1 h-4 w-4 shrink-0 text-[var(--muted)] transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="space-y-3 border-t border-[var(--border)] px-4 pb-4 pt-3">
              <p className="text-sm leading-6 text-[var(--foreground-soft)]">
                {stage.status === "done" ? stage.echo : stage.teaser}
              </p>

              {stage.clearedAt ? (
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--success)]">
                  Stamped {new Date(stage.clearedAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}
                </p>
              ) : null}

              {stage.note ? (
                <p className="rounded-2xl bg-[var(--surface-alt)] p-3 text-sm text-[var(--foreground-soft)]">{stage.note}</p>
              ) : null}

              {cta}

              {/* The stages after the classroom are the student's word. They can
                  mark them, and — just as importantly — unmark them, because
                  somebody who taps "I have my visa" a fortnight early must be
                  able to take it back without ringing the branch. */}
              {stage.selfReported && onClaim && stage.status !== "locked" ? (
                <button
                  type="button"
                  disabled={claiming}
                  onClick={() => onClaim(stage, stage.status === "done")}
                  className={`w-full rounded-full px-4 py-2.5 text-sm font-bold transition disabled:opacity-50 ${
                    stage.status === "done"
                      ? "border border-[var(--border-strong)] text-[var(--muted)] hover:bg-[var(--surface-alt)]"
                      : "bg-[var(--accent)] text-white hover:brightness-110"
                  }`}
                >
                  {stage.status === "done" ? "Undo — this has not happened yet" : `Yes — ${stage.label.toLowerCase()} is done`}
                </button>
              ) : null}

              {stage.selfReported && stage.status !== "done" ? (
                <p className="text-[11px] leading-5 text-[var(--muted)]">
                  We cannot see this one from here — you tell us, and your branch confirms it.
                </p>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/* The road                                                                   */
/* -------------------------------------------------------------------------- */

export default function JourneyRoad({
  stages,
  percentToGermany,
  onClaim,
  claimingStage,
  renderStageCta,
}: {
  stages: JourneyStage[];
  percentToGermany: number;
  onClaim?: (stage: JourneyStage, undo: boolean) => void;
  claimingStage?: string | null;
  /** Lets the dashboard drop the "I have started" button into the right card. */
  renderStageCta?: (stage: JourneyStage) => React.ReactNode;
}) {
  const reduced = useReducedMotion() ?? false;
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="relative overflow-hidden rounded-[28px] p-4 sm:p-6" style={{ background: skyFor(percentToGermany) }}>
      {/* Landmarks sit behind the road and get slightly bolder as the sky warms,
          so the destination literally comes into focus. */}
      <div
        className="pointer-events-none absolute inset-0 text-[var(--accent-strong)]"
        style={{ opacity: 0.08 + (percentToGermany / 100) * 0.1 }}
        aria-hidden
      >
        <Landmark kind="gate" className="right-2 top-10 w-28 sm:w-36" />
        <Landmark kind="castle" className="left-2 top-1/2 w-24 sm:w-32" />
        <Landmark kind="city" className="bottom-8 right-4 w-28 sm:w-40" />
      </div>

      <ol className="relative space-y-1">
        {stages.map((stage, index) => {
          const previous = stages[index - 1];
          const litAbove = previous?.status === "done" ? 1 : 0;
          const litBelow = stage.status === "done" ? 1 : stage.status === "current" ? stage.percent / 100 : 0;
          const alignRight = index % 2 === 1;

          return (
            <motion.li
              key={stage.id}
              initial={reduced ? false : { opacity: 0, y: 14 }}
              whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.4, delay: Math.min(index * 0.04, 0.4) }}
              className="relative grid grid-cols-[56px_minmax(0,1fr)] items-center gap-x-3 sm:grid-cols-[minmax(0,1fr)_84px_minmax(0,1fr)] sm:gap-x-4"
            >
              {/* Spacer that only exists on desktop, and only for right-aligned
                  rows. On a phone there is no left column at all. */}
              {alignRight ? <div className="hidden sm:block" aria-hidden /> : null}

              <div
                className={`relative flex h-full min-h-[76px] items-center justify-center ${
                  alignRight ? "col-start-1 row-start-1 sm:col-start-2" : "sm:col-start-2"
                }`}
              >
                <Spine
                  litAbove={litAbove}
                  litBelow={litBelow}
                  first={index === 0}
                  last={index === stages.length - 1}
                />
                <StageNode stage={stage} reduced={reduced} />
              </div>

              <div className={alignRight ? "col-start-2 row-start-1 sm:col-start-3" : "sm:col-start-1 sm:row-start-1"}>
                <StageCard
                  stage={stage}
                  expanded={openId === stage.id}
                  onToggle={() => setOpenId((current) => (current === stage.id ? null : stage.id))}
                  onClaim={onClaim}
                  claiming={claimingStage === stage.id}
                  cta={renderStageCta?.(stage)}
                />
              </div>
            </motion.li>
          );
        })}
      </ol>

      {/* The finish line. Every road needs a visible end or the last card just
          stops. */}
      <div className="relative mt-4 flex items-center justify-center gap-2 text-[var(--muted)]">
        <FlagIcon className="h-4 w-4" />
        <span className="text-[11px] font-bold uppercase tracking-[0.24em]">Deutschland</span>
        <SparklesIcon className="h-4 w-4" />
      </div>
    </div>
  );
}
