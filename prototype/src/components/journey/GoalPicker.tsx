"use client";

/**
 * The one question.
 *
 * "Why German?" — asked once, answered in a tap, and the entire back half of
 * the journey map is rebuilt around the answer.
 *
 * WHY IT IS WORTH A FULL-SCREEN MOMENT, when almost nothing else is:
 *
 *   It is the only question in the portal whose answer changes what the portal
 *   shows. Everything else we ask — the sitting, the branch, the level — is
 *   administration. This one is the reason they are here at all, and the act of
 *   saying it out loud is itself the point: a person who has just declared
 *   "I am going for an Ausbildung" behaves like somebody going for an
 *   Ausbildung. That is commitment and consistency, and it is the cheapest and
 *   most durable thing this feature does. It costs one tap and it is the only
 *   tap in the product that buys that.
 *
 *   It is asked ONCE and then never again, and it is changeable forever from
 *   the map. A question that keeps coming back is a form; a question asked once
 *   at the right moment is a conversation.
 *
 * THE ORDER OF THE CARDS IS NOT ALPHABETICAL and is not arbitrary — it is the
 * order the branches actually see, commonest first, so most people find
 * themselves in the first two rows and never scroll. The ninth card is
 * "something else" with a real text box, because the honest answer to an
 * unpredicted goal is to ask, not to guess.
 *
 * NO SKIP BUTTON, AND NO TRAP EITHER. There is a "later" link, because a modal
 * you cannot leave is a modal people learn to hate — but it is a link and the
 * nine answers are buttons, which is the whole hierarchy in one sentence.
 */

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BriefcaseIcon,
  CareIcon,
  CompassIcon,
  CrossIcon,
  FamilyIcon,
  GraduationCapIcon,
  HeartIcon,
  HomeIcon,
  SparklesIcon,
  ToolboxIcon,
} from "@/components/icons";
import GermanFlag from "@/components/journey/GermanFlag";
import Mascot from "@/components/Mascot";
import { CUSTOM_GOAL, GERMANY_GOALS, type GermanyGoal, type GoalIconKey } from "@/lib/germany-goals";

const ICONS: Record<GoalIconKey, (props: { className?: string }) => React.ReactElement> = {
  graduation: GraduationCapIcon,
  toolbox: ToolboxIcon,
  briefcase: BriefcaseIcon,
  care: CareIcon,
  heart: HeartIcon,
  family: FamilyIcon,
  home: HomeIcon,
  compass: CompassIcon,
  sparkles: SparklesIcon,
};

function GoalCard({
  goal,
  selected,
  onPick,
}: {
  goal: GermanyGoal;
  selected: boolean;
  onPick: () => void;
}) {
  const Icon = ICONS[goal.icon];

  return (
    <motion.button
      type="button"
      onClick={onPick}
      whileTap={{ scale: 0.97 }}
      className={`flex items-start gap-3 rounded-2xl border-2 p-3.5 text-left transition ${
        selected
          ? "border-[var(--accent)] bg-[var(--accent-soft)] shadow-[0_10px_30px_-12px_rgba(255,102,0,0.7)]"
          : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]"
      }`}
    >
      <span
        className={`mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-xl ${
          selected ? "bg-[var(--accent)] text-white" : "bg-[var(--surface-alt)] text-[var(--accent-ink)]"
        }`}
        style={{ boxShadow: selected ? "0 4px 0 #a83f00" : undefined }}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold leading-5 text-[var(--foreground)]">{goal.label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-[var(--muted)]">{goal.blurb}</span>
      </span>
    </motion.button>
  );
}

export default function GoalPicker({
  firstName,
  /** The goal already saved, if this is being used to CHANGE one. */
  current,
  onSaved,
  onDismiss,
  /** "later" is offered on the first ask and not when changing an answer. */
  allowLater = true,
}: {
  firstName: string;
  current?: string | null;
  onSaved: (journey: unknown) => void;
  onDismiss: () => void;
  allowLater?: boolean;
}) {
  const [picked, setPicked] = useState<GermanyGoal | null>(
    current ? [...GERMANY_GOALS, CUSTOM_GOAL].find((goal) => goal.id === current) ?? null : null,
  );
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!picked) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/student/journey/goal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ goalId: picked.id, note: note.trim() || null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "That did not save. Try again.");
        return;
      }
      onSaved(data?.journey ?? null);
    } catch {
      setError("That did not save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[135] flex items-start justify-center overflow-y-auto overscroll-contain bg-slate-950/75 p-3 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Why are you learning German?"
    >
      <motion.div
        initial={{ opacity: 0, y: 26, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 14, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 240, damping: 26 }}
        className="my-auto w-full max-w-2xl overflow-hidden rounded-[30px] bg-[var(--background)] shadow-2xl"
      >
        {/* The header is the flag, because the question is about Germany and
            because the flag is the image this whole feature walks towards. */}
        <div className="relative overflow-hidden bg-gradient-to-br from-[#0D7C7E] via-[#0D7C7E] to-[#FF6600] px-5 pb-5 pt-5 text-white sm:px-7">
          <div className="pointer-events-none absolute -right-6 -top-10 opacity-90">
            <GermanFlag className="h-40 w-auto" pole={false} amplitude={7} />
          </div>

          {allowLater ? (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Close"
              className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-full bg-[var(--surface-alt)] text-white backdrop-blur transition hover:bg-[var(--surface)]/25"
            >
              <CrossIcon className="h-4 w-4" />
            </button>
          ) : null}

          <div className="relative max-w-md">
            <p className="text-[10px] font-bold uppercase tracking-[0.26em] text-white/80">One question</p>
            <h2 className="mt-2 text-2xl font-bold leading-tight sm:text-3xl">
              {firstName}, what is Germany <em className="not-italic underline decoration-white/40 underline-offset-4">for</em>?
            </h2>
            <p className="mt-2 text-sm leading-6 text-white/85">
              Your map ends where you are actually going — a lecture hall, a ward, a front door. Pick the one that is
              yours and the rest of the road redraws itself around it.
            </p>
          </div>
        </div>

        <div className="px-4 py-5 sm:px-6">
          <div className="grid gap-2.5 sm:grid-cols-2">
            {GERMANY_GOALS.map((goal) => (
              <GoalCard
                key={goal.id}
                goal={goal}
                selected={picked?.id === goal.id}
                onPick={() => setPicked(goal)}
              />
            ))}
            <div className="sm:col-span-2">
              <GoalCard
                goal={CUSTOM_GOAL}
                selected={picked?.id === CUSTOM_GOAL.id}
                onPick={() => setPicked(CUSTOM_GOAL)}
              />
            </div>
          </div>

          <AnimatePresence initial={false}>
            {picked?.id === CUSTOM_GOAL.id ? (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <label className="mt-3 block">
                  <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                    In your own words
                  </span>
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value.slice(0, 400))}
                    rows={3}
                    placeholder="What are you going to Germany to do?"
                    className="mt-1.5 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
                  />
                  <span className="mt-1 block text-[11px] text-[var(--muted)]">
                    Your branch reads this. If your reason has steps we have not drawn, they can tell you.
                  </span>
                </label>
              </motion.div>
            ) : null}
          </AnimatePresence>

          {/* What the answer commits them to, before they commit to it. The
              level requirement is stated at the moment of choosing rather than
              discovered later on an invoice — a school that sells levels has to
              be the one that explains why, or it looks like it is selling. */}
          <AnimatePresence initial={false}>
            {picked ? (
              <motion.div
                key={picked.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-4 flex gap-3 rounded-2xl border border-[var(--accent)]/35 bg-[var(--accent-soft)] p-4"
              >
                {/* Quietly approving. The student has just said out loud why they want
                    this, and the reply to that is warmth, not a sales pitch. */}
                <Mascot mood="smiling" className="hidden h-16 w-14 shrink-0 sm:block" />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[var(--foreground)]">
                    &ldquo;{picked.dream}&rdquo;
                  </p>
                  <p className="mt-1.5 text-xs leading-5 text-[var(--foreground-soft)]">
                    <strong className="font-bold text-[var(--accent-ink)]">
                      Usually needs {picked.requiredLevel}.
                    </strong>{" "}
                    {picked.levelReason}
                  </p>
                  <p className="mt-2 text-[11px] leading-4 text-[var(--muted)]">{picked.disclaimer}</p>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          {error ? <p className="mt-3 text-sm font-semibold text-[var(--danger)]">{error}</p> : null}

          <button
            type="button"
            disabled={!picked || saving}
            onClick={save}
            className="mt-4 w-full rounded-full bg-[var(--accent)] px-6 py-3.5 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-45"
          >
            {saving ? "Drawing your road…" : picked ? "Draw my road" : "Pick one to carry on"}
          </button>

          {allowLater ? (
            <button
              type="button"
              onClick={onDismiss}
              className="mt-2.5 w-full text-center text-[12px] font-semibold text-[var(--muted)] underline underline-offset-4"
            >
              I will decide later
            </button>
          ) : null}

          <p className="mt-3 text-center text-[11px] leading-4 text-[var(--muted)]">
            You can change this at any time from your map. People&rsquo;s reasons change.
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
}
