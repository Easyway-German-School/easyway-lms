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
  CrossIcon,
  MapIcon,
  SparklesIcon,
  TrendingUpIcon,
  UsersIcon,
} from "@/components/icons";
import type { JourneyStage } from "@/lib/germany-journey";
import JourneyRoad from "@/components/journey/JourneyRoad";
import JourneyCountdown from "@/components/journey/JourneyCountdown";
import StartClassesPrompt from "@/components/journey/StartClassesPrompt";

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
  awaitingStart: boolean;
  previewOnly: boolean;
  tribe: string | null;
  nextTribe: string | null;
  headline: string;
  subheadline: string;
  startPrompt: import("@/lib/germany-journey").StartPrompt;
  momentDue: boolean;
  tribeStanding: { tribe: string; cohortSize: number; atOrBeyond: number; line: string } | null;
  stamps: Array<{ id: string; label: string; detail: string | null; at: string; source: string }>;
  registeredAt?: string | null;
};

/* -------------------------------------------------------------------------- */
/* The banner at the top of the map                                           */
/* -------------------------------------------------------------------------- */

function ProgressRibbon({ journey }: { journey: Journey }) {
  return (
    <div className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#0D7C7E] via-[#0D7C7E] to-[#FF6600] px-5 py-5 text-white sm:px-7 sm:py-6">
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-3xl" />

      <div className="flex flex-wrap items-center gap-2">
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

      <h2 className="mt-3 text-2xl font-bold leading-tight sm:text-3xl">{journey.headline}</h2>
      <p className="mt-1.5 max-w-xl text-sm leading-6 text-white/85">{journey.subheadline}</p>

      <div className="mt-4">
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
}: {
  journey: Journey;
  busy: boolean;
  reply: string | null;
  onAnswer: (answer: { started: true; startedOn: string } | { started: false; reason: string }) => void;
  onClaim: (stage: JourneyStage, undo: boolean) => void;
  claimingStage: string | null;
}) {
  return (
    <div className="space-y-4">
      <ProgressRibbon journey={journey} />

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

      <JourneyRoad
        stages={journey.stages}
        percentToGermany={journey.percentToGermany}
        onClaim={onClaim}
        claimingStage={claimingStage}
      />

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
  const [moment, setMoment] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [claimingStage, setClaimingStage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/student/journey", { cache: "no-store", credentials: "include" });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data?.journey) return;

        setJourney(data.journey);

        // Opens by itself once a day — but only for somebody who has actually
        // bought a seat. Ambushing a browsing registrant with a full-screen
        // takeover is how a hook becomes an annoyance.
        if (data.journey.momentDue && !data.journey.previewOnly) {
          setMoment(true);
        }
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
    setMoment(false);
    // Stamped server-side so a student who saw it on a laptop at 9am does not
    // meet it again on their phone at noon.
    fetch("/api/student/journey/seen", { method: "POST", credentials: "include" }).catch(() => {});
  }, []);

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
    />
  );

  return (
    <div className={className}>
      {body}

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
