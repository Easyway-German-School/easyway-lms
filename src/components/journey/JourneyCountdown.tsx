"use client";

/**
 * The clock.
 *
 * Daily, weekly and monthly at once, because those three answer different
 * questions and a student asks all three at different points in a level:
 *
 *   day    "is today one of the ones that counts?"      — habit
 *   week   "how far in am I?"                           — orientation
 *   month  "am I nearly finished?"                      — the goal gradient
 *
 * The ring shows elapsed rather than remaining. A ring that empties as the
 * level runs makes finishing look like loss; one that fills makes it look like
 * accumulation, and it is the same number either way.
 *
 * The HEADLINE flips at the halfway mark — "Day 6 of your A1" early on, "12
 * days of A1 left" late on. That flip happens in `buildCountdown`, not here, so
 * the email and the admin console read the same sentence the student does.
 */

import { motion, useReducedMotion } from "framer-motion";
import type { LevelCountdown } from "@/lib/germany-journey";

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const PHASE_NOTE: Record<LevelCountdown["phase"], string> = {
  "settling-in": "Early days. Turning up is the whole job right now.",
  climbing: "You are properly into it. This is where most of the German lands.",
  "home-straight": "Past halfway. The end of this level is closer than the start.",
  "final-week": "Last week. Whatever you have been putting off, this is the week.",
  overdue: "Your two months are up. Your branch signs the level off from here.",
};

export default function JourneyCountdown({ countdown, className = "" }: { countdown: LevelCountdown; className?: string }) {
  const reduced = useReducedMotion() ?? false;
  const dash = (countdown.percent / 100) * CIRCUMFERENCE;

  const cells = [
    { value: countdown.daysElapsed + 1, of: countdown.totalDays, unit: "Day" },
    { value: countdown.weekNumber, of: countdown.weeksTotal, unit: "Week" },
    { value: countdown.monthNumber, of: countdown.monthsTotal, unit: "Month" },
  ];

  return (
    <div className={`rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6 ${className}`}>
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
        <div className="relative h-32 w-32 shrink-0">
          <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
            <circle cx="60" cy="60" r={RADIUS} fill="none" stroke="var(--border)" strokeWidth="10" />
            <motion.circle
              cx="60"
              cy="60"
              r={RADIUS}
              fill="none"
              stroke="url(#countdown-gradient)"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              initial={reduced ? false : { strokeDashoffset: CIRCUMFERENCE }}
              animate={{ strokeDashoffset: CIRCUMFERENCE - dash }}
              transition={{ duration: 1.1, ease: "easeOut" }}
            />
            <defs>
              <linearGradient id="countdown-gradient" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#0D7C7E" />
                <stop offset="100%" stopColor="#FF6600" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <div className="text-center">
              <p className="text-3xl font-bold leading-none text-[var(--foreground)]">{countdown.percent}%</p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
                of {countdown.level}
              </p>
            </div>
          </div>
        </div>

        <div className="min-w-0 flex-1 text-center sm:text-left">
          <p className="text-lg font-bold leading-tight text-[var(--foreground)] sm:text-xl">{countdown.headline}</p>
          <p className="mt-1 text-sm text-[var(--muted)]">{countdown.subline}</p>

          <div className="mt-4 grid grid-cols-3 gap-2">
            {cells.map((cell) => (
              <div key={cell.unit} className="rounded-2xl bg-[var(--surface-alt)] px-2 py-3 text-center">
                <p className="text-xl font-bold leading-none text-[var(--foreground)]">
                  {cell.value}
                  <span className="text-xs font-semibold text-[var(--muted)]">/{cell.of}</span>
                </p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">{cell.unit}</p>
              </div>
            ))}
          </div>

          <p className="mt-3 text-xs leading-5 text-[var(--foreground-soft)]">{PHASE_NOTE[countdown.phase]}</p>

          <p className="mt-2 text-[11px] text-[var(--muted)]">
            Started {new Date(countdown.startedOn).toLocaleDateString(undefined, { day: "numeric", month: "long" })} ·
            ends {new Date(countdown.endsOn).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
      </div>
    </div>
  );
}
