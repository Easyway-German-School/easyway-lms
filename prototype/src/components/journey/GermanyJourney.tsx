"use client";

/**
 * The road to Germany, on the dashboard.
 *
 * TWO SURFACES, one payload:
 *
 *   THE MOMENT   once a day, full screen, opening on the stage they are
 *                standing on. Modelled on the welcome tour because that
 *                pattern already earned its place here — but unlike the tour
 *                this one returns, so it must be dismissible in one tap and
 *                must never block the dashboard behind it.
 *
 *   THE CARD     lives on the dashboard permanently. A dismissed moment must
 *                not be the only way to reach the map, or the whole thing
 *                becomes a thing students learn to close.
 *
 * WHO SEES WHAT:
 *
 *   paid + started      the live map, the running clock, the road lit as far
 *                       as they have walked.
 *   paid, not started   the whole map, plus the one question that starts the
 *                       clock. The road is drawn in full on purpose — showing
 *                       somebody the entire route to Germany before they have
 *                       attended a single class is the appetite, and it is the
 *                       reason the confirmation button gets pressed at all.
 *   registered only     the map as a preview, honestly labelled. Not a locked
 *                       padlock — the point is to make them want it.
 *
 * The "your level is complete" offer is NOT here and is not derived from any
 * date in this file. It fires off Student.levelCompletedFor, which only a
 * super admin sets. See api/student/advance/route.ts.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  CompassIcon,
  CrossIcon,
  ListIcon,
  MapIcon,
  SparklesIcon,
  TrendingUpIcon,
  UsersIcon,
} from "@/components/icons";
import type { JourneyStage } from "@/lib/germany-journey";
import type { GermanyGoal } from "@/lib/germany-goals";
import JourneyRoad from "@/components/journey/JourneyRoad";
import JourneyWorld from "@/components/journey/JourneyWorld";
import JourneyCountdown from "@/components/journey/JourneyCountdown";
import StartClassesPrompt from "@/components/journey/StartClassesPrompt";
import GoalPicker from "@/components/journey/GoalPicker";
import GermanFlag from "@/components/journey/GermanFlag";
import { useMoment, useMomentQueue } from "@/lib/moment-queue";

/* The payload shape, mirrored from germany-journey-server.ts. */
type Journey = {
  studentName: string;
  firstName: string;
  branchName: string | null;
  currentLevel: string;
  targetLevel: string;
  stages: JourneyStage[];
  currentIndex: number;
  percentToGermany: number;
  countdown: import("@/lib/germany-journey").LevelCountdown | null;
  arrival: import("@/lib/germany-journey").ArrivalEstimate;
  goal: GermanyGoal;
  goalNote: string | null;
  goalUnset: boolean;
  awaitingStart: boolean;
  previewOnly: boolean;
  tribe: string | null;
  nextTribe: string | null;
  headline: string;
  subheadline: string;
  startPrompt: import("@/lib/germany-journey").StartPrompt;
  momentDue: boolean;
  goalAskDue: boolean;
  tribeStanding: { tribe: string; cohortSize: number; atOrBeyond: number; line: string } | null;
  stamps: Array<{ id: string; label: string; detail: string | null; at: string; source: string }>;
  registeredAt?: string | null;
};

/* -------------------------------------------------------------------------- */
/* The banner at the top of the map                                           */
/* -------------------------------------------------------------------------- */

function ProgressRibbon({ journey, onChangeGoal }: { journey: Journey; onChangeGoal: () => void }) {
  return (
    <div className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#0D7C7E] via-[#0D7C7E] to-[#FF6600] px-5 py-5 text-white sm:px-7 sm:py-6">
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-3xl" />
      {/* The real flag, flying, rather than a flag-shaped icon. It is the
          picture at the end of the road and it belongs at the top of the card
          about that road. */}
      <div className="pointer-events-none absolute -right-4 -top-6 hidden opacity-90 sm:block">
        <GermanFlag className="h-32 w-auto" pole={false} amplitude={6} period={5} />
      </div>

      <div className="relative flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] backdrop-blur">
          <MapIcon className="h-3.5 w-3.5" />
          Your road to Germany
        </span>
        {journey.tribe ? (
          <span className="rounded-full bg-white/15 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] backdrop-blur">
            {journey.tribe}
          </span>
        ) : null}
      </div>

      <h2 className="relative mt-3 text-2xl font-bold leading-tight sm:text-3xl">{journey.headline}</h2>
      <p className="relative mt-1.5 max-w-xl text-sm leading-6 text-white/85">{journey.subheadline}</p>

      {/* The reason, and the way to change it. A stated goal that cannot be
          corrected turns into a stale goal, and a map built on a stale goal is
          worse than one built on none. */}
      <button
        type="button"
        onClick={onChangeGoal}
        className="relative mt-3 inline-flex max-w-full items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-left text-[11px] font-bold backdrop-blur transition hover:bg-white/20"
      >
        <CompassIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">
          {journey.goalUnset ? "Tell us why you are learning German" : journey.goal.label}
        </span>
        <span className="shrink-0 text-white/60">{journey.goalUnset ? "" : "· change"}</span>
      </button>

      {journey.goalNote ? (
        <p className="relative mt-2 max-w-xl text-[11px] italic leading-5 text-white/70">
          &ldquo;{journey.goalNote}&rdquo;
        </p>
      ) : null}

      <div className="relative mt-4">
        <div className="h-3 overflow-hidden rounded-full bg-white/20">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${journey.percentToGermany}%` }}
            transition={{ duration: 1.1, ease: "easeOut" }}
            className="h-full rounded-full bg-gradient-to-r from-white to-amber-300"
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold text-white/80">
          <span>{journey.percentToGermany}% of the way</span>
          {journey.nextTribe ? <span>Next: {journey.nextTribe}</span> : null}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The two honest side-panels                                                 */
/* -------------------------------------------------------------------------- */

function ArrivalCard({ journey }: { journey: Journey }) {
  if (!journey.arrival.label) return null;

  return (
    <div className="rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center gap-2 text-[var(--accent-ink)]">
        <TrendingUpIcon className="h-4 w-4" />
        <p className="text-[10px] font-bold uppercase tracking-[0.22em]">If you keep this pace</p>
      </div>
      <p className="mt-2 text-2xl font-bold text-[var(--foreground)]">{journey.arrival.label}</p>
      <p className="mt-1 text-sm text-[var(--muted)]">
        {journey.arrival.levelsRemaining} {journey.arrival.levelsRemaining === 1 ? "level" : "levels"} to{" "}
        {journey.targetLevel} · about {journey.arrival.monthsOfTeaching} months of teaching left.
      </p>
      {/* The caveat travels with the number rather than being a prop the UI can
          forget. A projected date is the most motivating thing on this screen
          and the easiest to turn into a lie. */}
      <p className="mt-3 border-t border-[var(--border)] pt-3 text-[11px] leading-5 text-[var(--muted)]">
        {journey.arrival.caveat}
      </p>
    </div>
  );
}

function TribeCard({ journey }: { journey: Journey }) {
  if (!journey.tribeStanding) return null;
  return (
    <div className="rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex items-center gap-2 text-[var(--accent-ink)]">
        <UsersIcon className="h-4 w-4" />
        <p className="text-[10px] font-bold uppercase tracking-[0.22em]">{journey.tribeStanding.tribe}</p>
      </div>
      {/* Every number in this sentence is a count of rows. An invented "only 3%
          get this far" would work exactly once, on a screen that also carries
          the fee table. */}
      <p className="mt-2 text-sm leading-6 text-[var(--foreground-soft)]">{journey.tribeStanding.line}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The whole map, used by both surfaces                                       */
/* -------------------------------------------------------------------------- */

function JourneyBody({
  journey,
  busy,
  reply,
  onAnswer,
  onClaim,
  claimingStage,
  onChangeGoal,
}: {
  journey: Journey;
  busy: boolean;
  reply: string | null;
  onAnswer: (answer: { started: true; startedOn: string } | { started: false; reason: string }) => void;
  onClaim: (stage: JourneyStage, undo: boolean) => void;
  claimingStage: string | null;
  onChangeGoal: () => void;
}) {
  /**
   * The map, or the list.
   *
   * The world is the default because it is the thing people come back to look
   * at. The list is not a fallback or an accessibility afterthought — it is the
   * dense read: every stage's full copy, the echo lines, the stamps, all
   * visible at once without tapping anything. Some students want the picture
   * and some want the ledger, and the two are one toggle apart.
   */
  const [view, setView] = useState<"world" | "list">("world");

  return (
    <div className="space-y-4">
      <ProgressRibbon journey={journey} onChangeGoal={onChangeGoal} />

      {journey.previewOnly ? (
        <div className="rounded-[28px] border border-[var(--accent)]/40 bg-[var(--accent-soft)] p-5">
          <p className="text-sm font-bold text-[var(--accent-ink)]">This road is yours the moment your seat is paid.</p>
          <p className="mt-1 text-sm leading-6 text-[var(--foreground-soft)]">
            Everything below is what your two months actually look like — the levels, the exam, the visa, the landing.
            You are looking at the real thing, not a sample.
          </p>
          <Link
            href="/programs"
            className="mt-4 inline-flex rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-bold text-white transition hover:brightness-110"
          >
            Secure my seat
          </Link>
        </div>
      ) : null}

      {journey.startPrompt.due ? (
        <StartClassesPrompt
          prompt={journey.startPrompt}
          level={journey.currentLevel}
          branchName={journey.branchName}
          registeredAt={journey.registeredAt ?? null}
          busy={busy}
          reply={reply}
          onAnswer={onAnswer}
        />
      ) : null}

      {journey.countdown ? <JourneyCountdown countdown={journey.countdown} /> : null}

      <div className="flex items-center justify-end gap-1 rounded-full bg-[var(--surface-alt)] p-1 text-[11px] font-bold sm:w-fit sm:self-end">
        {(
          [
            { id: "world" as const, label: "Map", icon: <MapIcon className="h-3.5 w-3.5" /> },
            { id: "list" as const, label: "List", icon: <ListIcon className="h-3.5 w-3.5" /> },
          ]
        ).map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setView(option.id)}
            aria-pressed={view === option.id}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-2 transition sm:flex-none ${
              view === option.id
                ? "bg-[var(--surface)] text-[var(--accent-ink)] shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            {option.icon}
            {option.label}
          </button>
        ))}
      </div>

      {view === "world" ? (
        <JourneyWorld
          stages={journey.stages}
          percentToGermany={journey.percentToGermany}
          goal={journey.goal}
          firstName={journey.firstName}
          onClaim={onClaim}
          claimingStage={claimingStage}
        />
      ) : (
        <JourneyRoad
          stages={journey.stages}
          percentToGermany={journey.percentToGermany}
          onClaim={onClaim}
          claimingStage={claimingStage}
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <ArrivalCard journey={journey} />
        <TribeCard journey={journey} />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The component                                                              */
/* -------------------------------------------------------------------------- */

export default function GermanyJourney({ className = "" }: { className?: string }) {
  const [journey, setJourney] = useState<Journey | null>(null);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [claimingStage, setClaimingStage] = useState<string | null>(null);
  /** Opened from the ribbon rather than by the queue. Always allowed. */
  const [changingGoal, setChangingGoal] = useState(false);

  const queue = useMomentQueue();

  /**
   * Two turns in the queue, at two different priorities.
   *
   * The GOAL question outranks the daily map because it is asked once and it
   * changes what the map is; the map is shown every day and can always wait.
   * Neither of them races the welcome tour any more — the queue holds them
   * both behind it, which is what the hand-rolled `easyway:tour-finished`
   * event used to do for exactly one of the two.
   *
   * The map's own turn is withheld from somebody who has not paid: a browsing
   * registrant meeting a full-screen takeover is how a hook becomes an
   * annoyance. They still get the map on the dashboard, permanently, which is
   * the version of it that is trying to sell them something.
   */
  const { open: goalOpen, close: releaseGoal } = useMoment("goal", Boolean(journey?.goalAskDue));
  const { open: moment, close: releaseMoment } = useMoment(
    "journey",
    Boolean(journey?.momentDue) && !journey?.previewOnly,
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/student/journey", { cache: "no-store", credentials: "include" });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data?.journey) return;
        setJourney(data.journey);
      } catch {
        // The dashboard must render without this. It is the best thing on the
        // page, not a load-bearing part of it.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const closeMoment = useCallback(() => {
    // Stamped server-side so a student who saw it on a laptop at 9am does not
    // meet it again on their phone at noon.
    setJourney((current) => (current ? { ...current, momentDue: false } : current));
    releaseMoment();
    fetch("/api/student/journey/seen", { method: "POST", credentials: "include" }).catch(() => {});
  }, [releaseMoment]);

  /**
   * The answer, and the handover.
   *
   * Saving a goal leads STRAIGHT into the map rather than closing and leaving
   * them on the dashboard. Somebody who has just declared what Germany is for
   * is the single most receptive audience this map will ever have, and making
   * them find it themselves thirty seconds later throws that away. The queue
   * is told to summon the map so this stays one continuous moment rather than
   * two interruptions in a row.
   */
  const onGoalSaved = useCallback(
    (updated: unknown) => {
      if (updated && typeof updated === "object") setJourney(updated as Journey);
      setChangingGoal(false);
      releaseGoal();
      if (!(updated as Journey | null)?.previewOnly) queue?.summon("journey");
    },
    [releaseGoal, queue],
  );

  const answer = useCallback(
    async (payload: { started: true; startedOn: string } | { started: false; reason: string }) => {
      setBusy(true);
      setReply(null);
      try {
        const res = await fetch("/api/student/journey/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (data?.journey) setJourney(data.journey);
        if (data?.message) setReply(data.message);
      } catch {
        setReply("That did not save. Check your connection and try again.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const claim = useCallback(async (stage: JourneyStage, undo: boolean) => {
    setClaimingStage(stage.id);
    try {
      const res = await fetch("/api/student/journey/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ stage: stage.id, undo }),
      });
      const data = await res.json();
      if (data?.journey) setJourney(data.journey);
    } catch {
      // Leaving the stage unclaimed is recoverable; a wrong stamp is not.
    } finally {
      setClaimingStage(null);
    }
  }, []);

  if (!journey) return null;

  const body = (
    <JourneyBody
      journey={journey}
      busy={busy}
      reply={reply}
      onAnswer={answer}
      onClaim={claim}
      claimingStage={claimingStage}
      onChangeGoal={() => setChangingGoal(true)}
    />
  );

  return (
    <div className={className}>
      {/* ONE MAP AT A TIME. The same `body` used to render inline AND inside
          the moment, which React mounts as two independent component trees —
          two full worlds, each a couple of thousand pixels of SVG with its own
          clouds, flag and walking guide, animating simultaneously behind a
          backdrop blur. Harmless when the map was a list of cards; not harmless
          now, and worst on exactly the mid-range phones most of this school's
          students use. The inline copy comes back when the moment closes. */}
      {moment ? null : body}

      <AnimatePresence>
        {goalOpen || changingGoal ? (
          <GoalPicker
            key="goal-picker"
            firstName={journey.firstName}
            current={journey.goalUnset ? null : journey.goal.id}
            onSaved={onGoalSaved}
            onDismiss={() => {
              setChangingGoal(false);
              releaseGoal();
            }}
            // Changing an answer you already gave has a close button, not an
            // "I will decide later" — there is nothing left to decide later.
            allowLater={!changingGoal}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {moment ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            // `items-start` and a scrollable overlay: the map is taller than any
            // viewport, and centring a flex child taller than its scroll
            // container pushes its top out of reach — the same trap the
            // level-advance modal already fell into once.
            className="fixed inset-0 z-[130] flex items-start justify-center overflow-y-auto overscroll-contain bg-slate-950/75 p-3 backdrop-blur-sm sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-label="Your road to Germany"
          >
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 240, damping: 26 }}
              className="my-auto w-full max-w-3xl rounded-[32px] bg-[var(--background)] p-3 shadow-2xl sm:p-5"
            >
              <div className="mb-3 flex items-center justify-between gap-3 px-2">
                <div className="flex items-center gap-2 text-[var(--accent-ink)]">
                  <SparklesIcon className="h-4 w-4" />
                  <p className="text-[11px] font-bold uppercase tracking-[0.24em]">Today on your road</p>
                </div>
                <button
                  type="button"
                  onClick={closeMoment}
                  aria-label="Close"
                  className="grid h-9 w-9 place-items-center rounded-full border border-[var(--border)] text-[var(--muted)] transition hover:bg-[var(--surface-alt)]"
                >
                  <CrossIcon className="h-4 w-4" />
                </button>
              </div>

              {body}

              <button
                type="button"
                onClick={closeMoment}
                className="mt-4 w-full rounded-full bg-[var(--accent)] px-6 py-3.5 text-sm font-bold text-white transition hover:brightness-110"
              >
                Back to my dashboard
              </button>
              <p className="mt-2 pb-1 text-center text-[11px] text-[var(--muted)]">
                Your map stays on your dashboard — closing this does not lose your place.
              </p>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
