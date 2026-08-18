"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import Mascot, { type MascotMood } from "@/components/Mascot";
import { CheckIcon } from "@/components/icons";

/**
 * SIGNUP AS THE FIRST STEP OF THE JOURNEY, NOT THE TOLL BOOTH BEFORE IT.
 *
 * The form this replaces the header of was three numbered circles, a grey
 * progress bar and the words "Step 1 of 3". Accurate, and exactly wrong for
 * what is happening at that moment: somebody has decided to learn a language,
 * which is a two-year commitment they are quietly frightened of, and the first
 * thing the school says to them is that they are 33% of the way through a form.
 *
 * Everything here is aimed at one number — how many people who start the form
 * finish it — and three ideas hold it up:
 *
 * 1. SOMEBODY IS ON THE OTHER SIDE OF THE FORM. The djinn (Mascot)
 *    hovers beside the questions with a face that reacts to what the student is
 *    actually doing — waiting while a step is unfinished, pleased when one
 *    clears, cheering at the end. It wears the crest scholar's mortarboard, so
 *    it reads as the same school as the guide they meet on their first login,
 *    without being the same character doing a job it was not drawn for.
 *
 * 2. PROGRESS THAT IS COLLECTED, NOT COUNTED. "Step 2 of 3" measures how much is
 *    left. A stamp you have earned measures what you have done, and it stays on
 *    the screen. Same information, opposite feeling — and it is the metaphor the
 *    welcome tour already uses, so it is a language the student learns once.
 *
 * 3. THE DESTINATION IS ALWAYS VISIBLE. The road ends at a flag, not at a
 *    "Submit" button. Nobody fills in a form because they want to fill in a
 *    form.
 *
 * It is deliberately NOT a game. No points, no confetti cannon, no levelling
 * up. This is a real enrolment involving real money, and a form that plays
 * fanfares while asking for a date of birth reads as unserious — which is the
 * one thing a school taking ₦400,000 cannot afford to read as.
 */

export type JourneyMilestone = {
  /** Short label under the marker. Two words at most — it renders at 10px. */
  label: string;
  /** The stamp earned by clearing this one. */
  stamp: string;
  /** What the guide says while the student is standing here. */
  line: string;
};

export default function SignupJourney({
  milestones,
  current,
  /**
   * Whether the student can move on from where they are.
   *
   * This is what gives the face something true to react to. Without it the
   * companion could only respond to the step number — which changes three times
   * in four minutes — and a character that reacts to nothing for ninety seconds
   * at a stretch is a picture, not a companion.
   */
  ready = false,
  /** Something went wrong. Attentive, not devastated. */
  errored = false,
  className = "",
}: {
  milestones: JourneyMilestone[];
  /** 1-based, matching the form's own `step`. */
  current: number;
  ready?: boolean;
  errored?: boolean;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const previous = useRef(current);
  const [walking, setWalking] = useState(false);

  /**
   * The walk is a state with a timer, not a transition callback.
   *
   * Framer's `onAnimationComplete` does not fire when a spring is interrupted by
   * a second change, so a student clicking Next twice quickly would leave the
   * character walking on the spot for the rest of the form.
   */
  const [justCleared, setJustCleared] = useState(false);

  useEffect(() => {
    if (previous.current === current) return;
    previous.current = current;
    if (reduceMotion) return;

    // ONE effect, because both reactions read `previous.current` and the first
    // one to run updates it. Split across two, the second would always find the
    // step already recorded and never fire — a bug with no symptom except a
    // companion that mysteriously never looks pleased.
    setWalking(true);
    setJustCleared(true);
    const stopWalking = window.setTimeout(() => setWalking(false), 900);
    const stopSmiling = window.setTimeout(() => setJustCleared(false), 1800);
    return () => {
      window.clearTimeout(stopWalking);
      window.clearTimeout(stopSmiling);
    };
  }, [current, reduceMotion]);

  const total = milestones.length;
  const index = Math.min(Math.max(current, 1), total) - 1;
  const step = milestones[index];

  /**
   * The order here is a priority list, not a lookup, and it is worth reading in
   * order: a problem outranks a celebration, the finish line outranks a step
   * clearing, and "waiting for you" is the resting state rather than the
   * exception. Getting this backwards produces a mascot grinning at somebody
   * who has just been told their email is already registered.
   */
  const mood: MascotMood = errored
    ? "concerned"
    : current >= total
      ? "celebrating"
      : justCleared
        ? "cheerful"
        : ready
          ? "smiling"
          : "thinking";

  /**
   * Where the character stands, as a percentage across the road.
   *
   * Milestones are spaced so the first sits at the left edge and the last at the
   * right, which means a two-milestone road is 0% and 100% rather than 33% and
   * 66%. Getting this wrong is what makes a stepper look like it starts already
   * partly done.
   */
  const markerAt = (i: number) => (total === 1 ? 50 : (i / (total - 1)) * 100);
  const walkerAt = markerAt(index);

  return (
    <div className={`relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#0D7C7E] via-[#0D7C7E] to-[#0b6668] px-4 pb-5 pt-5 text-white shadow-xl sm:px-8 sm:pb-6 sm:pt-6 ${className}`}>
      {/* A wash of warmth behind the road. Purely atmosphere, and clipped by the
          parent's overflow so it cannot widen the layout on a phone. */}
      <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[#FF6600]/25 blur-3xl" aria-hidden />

      <div className="relative">
        {/* What the guide is saying. Keyed on the step so it re-animates —
            without the key React reuses the node and the text simply swaps,
            which reads as a typo correcting itself rather than someone speaking. */}
        {/*
          THE LAYOUT FLIPS AT sm, AND IT HAS TO.

          Beside-the-text is the right shape for a speech bubble and it is what
          runs on a laptop. On a 375px phone it is arithmetic that does not
          work: the page, the form and this card take 84px of padding between
          them, the character takes 65 more, and the bubble is left with under
          200 — measured at 197px, which wrapped a three-sentence line into a
          187px-tall column about five words across. Unreadable, and it made the
          card the tallest thing on the screen before a single question.

          So on a phone the djinn moves ABOVE the bubble, beside the step label,
          and the text spans the full card. It reads as the character
          introducing the step rather than speaking it — a slightly weaker
          metaphor bought for ~110px of line length, which at this size is not a
          close trade.
        */}
        <div className="sm:flex sm:items-start sm:gap-4">
          <div className="flex items-center gap-2.5 sm:block">
            {/*
              SIXTY-FOUR PIXELS IS A FLOOR, not a preference. Below roughly that
              the whites of the eyes stop resolving and the face becomes a
              smudge — at which point the character costs layout and returns
              nothing, which is the worst of both.
            */}
            <motion.div
              className="-mt-1 h-16 w-16 shrink-0 sm:h-[4.5rem] sm:w-[4.5rem]"
              animate={reduceMotion ? {} : { x: walking ? [0, 5, 0] : 0 }}
              transition={{ duration: 0.7, ease: "easeInOut" }}
            >
              <Mascot mood={mood} className="h-full w-full drop-shadow-lg" />
            </motion.div>

            {/* The step label rides beside the face on a phone, and inside the
                bubble on a laptop. It is never in both places at once. */}
            <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-white/60 sm:hidden">
              {step.label}
            </p>
          </div>

          <div className="mt-2.5 min-w-0 flex-1 sm:mt-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={step.label}
                initial={reduceMotion ? {} : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? {} : { opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
                // The clipped corner is what turns a box into speech. It points
                // up on a phone (the face is above) and left on a laptop.
                className="relative rounded-2xl rounded-tl-sm bg-[var(--surface)]/12 px-4 py-3 backdrop-blur-sm"
              >
                <p className="hidden text-[10px] font-bold uppercase tracking-[0.28em] text-white/60 sm:block">
                  {step.label}
                </p>
                <p className="text-sm leading-6 text-white/95 sm:mt-1 sm:text-[15px]">{step.line}</p>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* The road */}
        <div className="relative mt-7 h-px sm:mt-8">
          <div className="absolute inset-x-0 top-0 h-1.5 -translate-y-1/2 rounded-full bg-[var(--surface-alt)]" />
          <motion.div
            className="absolute left-0 top-0 h-1.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-[#FF6600] to-[#ffa04d]"
            initial={false}
            animate={{ width: `${walkerAt}%` }}
            transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 120, damping: 20 }}
          />

          {milestones.map((milestone, i) => {
            const done = i < index;
            const here = i === index;
            return (
              <div
                key={milestone.label}
                className="absolute top-0 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
                style={{ left: `${markerAt(i)}%` }}
              >
                <motion.span
                  initial={false}
                  animate={{ scale: here ? 1.15 : 1 }}
                  transition={{ type: "spring", stiffness: 300, damping: 18 }}
                  className={`grid h-7 w-7 place-items-center rounded-full text-[10px] font-bold ring-4 ring-[#0D7C7E] transition-colors ${
                    done
                      ? "bg-[#FF6600] text-white"
                      : here
                        ? "bg-[var(--surface)] text-[#0D7C7E]"
                        : "bg-[var(--surface-alt)] text-white/60"
                  }`}
                >
                  {done ? <CheckIcon className="h-3.5 w-3.5" strokeWidth={3.5} /> : i + 1}
                </motion.span>
              </div>
            );
          })}
        </div>

        {/* Labels on their own row rather than under each marker: at 375px, three
            centred labels under three markers collide, and the outer two run off
            both edges of the card. */}
        <div className="mt-5 flex items-center justify-between gap-2">
          {milestones.map((milestone, i) => (
            <span
              key={milestone.label}
              className={`min-w-0 truncate text-[10px] font-bold uppercase tracking-[0.16em] ${
                i === index ? "text-white" : i < index ? "text-[#ffa04d]" : "text-white/40"
              } ${i === 0 ? "text-left" : i === milestones.length - 1 ? "text-right" : "text-center"}`}
              style={{ flex: "1 1 0" }}
            >
              {milestone.label}
            </span>
          ))}
        </div>

        {/* THE STAMPS. What you have, not what is left. */}
        <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-[var(--border)] pt-4">
          <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">Collected</span>
          {milestones.map((milestone, i) => {
            const earned = i < index;
            return (
              <motion.span
                key={milestone.stamp}
                initial={false}
                animate={
                  earned && !reduceMotion
                    ? { scale: [1, 1.18, 1], rotate: [0, -4, 0] }
                    : {}
                }
                transition={{ duration: 0.4 }}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors ${
                  earned ? "bg-[#FF6600] text-white" : "bg-[var(--surface-alt)] text-white/35"
                }`}
              >
                {earned && <CheckIcon className="h-2.5 w-2.5" strokeWidth={3.5} />}
                {milestone.stamp}
              </motion.span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
