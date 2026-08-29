"use client";

/**
 * "Have you started classes yet?"
 *
 * The single most consequential button in the portal: it starts the two-month
 * clock, moves them into the Doers, and is the only thing standing between a
 * paid seat and a live journey map.
 *
 * FOUR RULES it was designed against, all of them learned from how this kind of
 * dialog usually fails:
 *
 *  1. NEVER TRAP THEM. "Not yet" is a full-sized button beside "Yes", not a
 *     grey link in the corner. A dialog with only one real exit gets dismissed
 *     without being read, and by the third day they are clicking past it
 *     blind — which is exactly when we need them to read it.
 *
 *  2. "NOT YET" IS NOT A FAILURE. It asks WHY, offers four honest reasons, and
 *     answers each one with something true. Two of those reasons are things the
 *     branch can fix in a phone call, which is why the answer is stored.
 *
 *  3. THE DATE IS THEIRS. Somebody confirming on Thursday may have started on
 *     Monday, and silently starting their two months three days late is a small
 *     unfairness they would be entirely right to resent.
 *
 *  4. IT SOFTENS, NEVER HARDENS. The copy on the fifth ask is gentler than the
 *     first, not sterner. A portal that nags a student who is struggling with
 *     their fees is a portal that loses them.
 */

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { CalendarIcon, CheckCircleIcon, ClockIcon } from "@/components/icons";
import { NOT_STARTED_REASONS, type StartPrompt } from "@/lib/germany-journey";

type Answer =
  | { started: true; startedOn: string }
  | { started: false; reason: string };

function isoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function StartClassesPrompt({
  prompt,
  level,
  branchName,
  registeredAt,
  busy,
  onAnswer,
  reply,
  className = "",
}: {
  prompt: StartPrompt;
  level: string;
  branchName: string | null;
  /** Nobody can have started before they registered. */
  registeredAt: string | null;
  busy: boolean;
  onAnswer: (answer: Answer) => void;
  /** What the server said back after the last answer. */
  reply: string | null;
  className?: string;
}) {
  const today = useMemo(() => new Date(), []);
  const [mode, setMode] = useState<"ask" | "when" | "why">("ask");
  const [startedOn, setStartedOn] = useState(() => isoDay(new Date()));

  const minDate = registeredAt ? isoDay(new Date(registeredAt)) : undefined;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={`overflow-hidden rounded-[28px] border-2 border-[var(--accent)] bg-[var(--surface)] shadow-[0_20px_60px_-24px_rgba(255,102,0,0.6)] ${className}`}
    >
      <div className="relative overflow-hidden bg-gradient-to-br from-[#0D7C7E] to-[#FF6600] px-6 py-5 text-white">
        <div className="pointer-events-none absolute -right-6 -top-6 h-28 w-28 rounded-full bg-[var(--surface-alt)] blur-2xl" />
        <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-white/75">
          {prompt.askedBefore === 0 ? "One question" : `Asked ${prompt.askedBefore + 1} times — no pressure`}
        </p>
        <h3 className="mt-2 text-xl font-bold leading-tight sm:text-2xl">{prompt.question}</h3>
        <p className="mt-2 max-w-lg text-sm leading-6 text-white/85">{prompt.reassurance}</p>
      </div>

      <div className="space-y-4 p-5 sm:p-6">
        {mode === "ask" ? (
          <>
            <div className="rounded-2xl bg-[var(--surface-alt)] p-4">
              <div className="flex items-start gap-3">
                <ClockIcon className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent-ink)]" />
                <p className="text-sm leading-6 text-[var(--foreground-soft)]">
                  Your {level} runs for two months from the day you first sit in class
                  {branchName ? ` at ${branchName}` : ""} — not from the day you paid. Nothing has started
                  counting yet.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setMode("when")}
                className="rounded-full bg-[var(--accent)] px-6 py-3.5 text-sm font-bold text-white shadow-lg transition hover:brightness-110 disabled:opacity-50"
              >
                Yes — I have started
              </button>
              {/* Same size, same weight, no shame. See rule 1. */}
              <button
                type="button"
                disabled={busy}
                onClick={() => setMode("why")}
                className="rounded-full border-2 border-[var(--border-strong)] px-6 py-3.5 text-sm font-bold text-[var(--foreground)] transition hover:bg-[var(--surface-alt)] disabled:opacity-50"
              >
                Not yet
              </button>
            </div>
          </>
        ) : null}

        {mode === "when" ? (
          <>
            <div className="flex items-start gap-3">
              <CalendarIcon className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent-ink)]" />
              <div>
                <p className="text-sm font-bold text-[var(--foreground)]">Which day did you first sit in class?</p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  If it was last week, say so — your two months should count from the real day, not from today.
                </p>
              </div>
            </div>

            <input
              type="date"
              value={startedOn}
              min={minDate}
              max={isoDay(today)}
              onChange={(event) => setStartedOn(event.target.value)}
              className="w-full rounded-2xl border border-[var(--border-strong)] bg-[var(--surface-alt)] px-4 py-3 text-sm font-semibold text-[var(--foreground)]"
            />

            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <button
                type="button"
                disabled={busy}
                onClick={() => onAnswer({ started: true, startedOn })}
                className="rounded-full bg-[var(--accent)] px-6 py-3.5 text-sm font-bold text-white shadow-lg transition hover:brightness-110 disabled:opacity-50"
              >
                {busy ? "Starting your clock…" : "Start my two months"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setMode("ask")}
                className="rounded-full border border-[var(--border)] px-6 py-3.5 text-sm font-semibold text-[var(--muted)] transition hover:bg-[var(--surface-alt)]"
              >
                Back
              </button>
            </div>
          </>
        ) : null}

        {mode === "why" ? (
          <>
            <p className="text-sm font-bold text-[var(--foreground)]">What is holding it up?</p>
            <p className="text-xs leading-5 text-[var(--muted)]">
              Two of these your branch can fix today. Nothing here counts against you.
            </p>

            <div className="space-y-2">
              {NOT_STARTED_REASONS.map((reason) => (
                <button
                  key={reason.id}
                  type="button"
                  disabled={busy}
                  onClick={() => onAnswer({ started: false, reason: reason.id })}
                  className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3 text-left text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--accent)] hover:bg-[var(--surface)] disabled:opacity-50"
                >
                  {reason.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() => setMode("ask")}
              className="w-full rounded-full border border-[var(--border)] px-6 py-3 text-sm font-semibold text-[var(--muted)] transition hover:bg-[var(--surface-alt)]"
            >
              Back
            </button>
          </>
        ) : null}

        {reply ? (
          <div className="flex items-start gap-2 rounded-2xl bg-[var(--success-soft)] p-3">
            <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--success)]" />
            <p className="text-sm leading-5 text-[var(--success)]">{reply}</p>
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}
