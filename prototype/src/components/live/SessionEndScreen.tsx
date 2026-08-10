"use client";

/**
 * THE SCREEN AFTER THE LESSON.
 *
 * What used to happen when a class ended was nothing. The tutor pressed Leave
 * and the page fell back to the lobby, which then said "no class in session" —
 * so the last thing a student saw after an hour of teaching was a screen that
 * reads, in the only way a student can parse it, as an error. There was no
 * acknowledgement that anything had finished, no idea whether the recording
 * existed, and no route anywhere except the browser's back button.
 *
 * The three jobs, in the order they matter:
 *
 *   1. SAY WHAT HAPPENED, and be precise about which of the three things it
 *      was. "The class ended" and "you left" and "your connection dropped" are
 *      completely different facts, and telling somebody the class is over when
 *      their WiFi died is how a student stops believing the portal.
 *   2. GIVE THE HOUR A SHAPE. How long it ran, who was in it. A tutor finishing
 *      a lesson wants to know twelve of their fourteen came; a student wants to
 *      know the thing they just sat through was an hour of their course.
 *   3. OFFER SOMEWHERE TO GO. A dead end is the actual failure of the old
 *      behaviour — the recording, the timetable, the dashboard, and a way back
 *      in if the class is somehow still running.
 *
 * The recording line is the one that has to be honest rather than encouraging.
 * The tape arrives minutes after the class through a webhook, so at the moment
 * this screen renders it is usually still encoding — and a button promising a
 * video that is not there yet is worse than no button.
 */

import Link from "next/link";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import {
  BroadcastIcon,
  CalendarIcon,
  CheckCircleIcon,
  ClockIcon,
  DashboardIcon,
  FilmIcon,
  PendingIcon,
  SignalIcon,
  UsersIcon,
} from "@/components/icons";
import type { RoomRole } from "@/lib/live-classroom";
import type { LeaveOutcome } from "./LiveKitClassroom";

type Recap = {
  title: string;
  kind: string;
  tutorName: string | null;
  startedAt: string;
  endedAt: string | null;
  stillLive: boolean;
  durationMinutes: number;
  attended: number;
  onTheList: number;
  recording: {
    status: string;
    ready: boolean;
    materialId: string | null;
    variant: string;
    durationSeconds: number | null;
  } | null;
};

function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

export default function SessionEndScreen({
  role,
  title,
  liveSessionId,
  outcome,
  onRejoin,
}: {
  role: RoomRole;
  title: string;
  liveSessionId: string | null;
  outcome: LeaveOutcome;
  onRejoin: () => void;
}) {
  const [recap, setRecap] = useState<Recap | null>(null);
  const [loading, setLoading] = useState(Boolean(liveSessionId));

  useEffect(() => {
    if (!liveSessionId) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/live/recap?sessionId=${encodeURIComponent(liveSessionId)}`, {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        setRecap((await res.json()) as Recap);
      } catch {
        // The screen works without it: the headline and the ways out do not
        // depend on the counts, and a failed summary must not become an error
        // page at the end of somebody's lesson.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [liveSessionId]);

  const isTutor = role === "tutor";
  /**
   * A student who leaves a class that is still running gets a different screen
   * from one whose tutor has finished — the first is reversible and the second
   * is not, and only the server knows which happened. `stillLive` is therefore
   * preferred over the client's own reason wherever the two could disagree.
   */
  const classOver = outcome.reason === "ended" || recap?.stillLive === false;
  const dropped = outcome.reason === "dropped" && !classOver;

  const headline = dropped
    ? "You lost connection to the class"
    : isTutor
      ? "Your live class just ended"
      : classOver
        ? "Your class has ended"
        : "You have left the class";

  const subline = dropped
    ? "Your internet dropped out rather than the lesson finishing. If the class is still running you can go straight back in."
    : isTutor
      ? "Everyone has been returned to their dashboard. The recording is being filed into the video library now."
      : classOver
        ? "Thanks for coming. The recording lands in your video library shortly, so anything you missed is not lost."
        : "The class is carrying on without you — you can rejoin any time while it is still running.";

  const recording = recap?.recording ?? null;
  const canRejoin = dropped || (!classOver && recap?.stillLive !== false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="space-y-5"
    >
      <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-[#0D7C7E] via-[#0D7C7E] to-[#FF6600] p-6 text-white shadow-xl sm:p-10">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/15">
          {dropped ? <SignalIcon className="h-7 w-7" /> : <CheckCircleIcon className="h-7 w-7" />}
        </span>
        <h1 className="mt-5 text-2xl font-semibold sm:text-3xl">{headline}</h1>
        <p className="mt-2 text-sm font-medium uppercase tracking-[0.2em] text-white/70">
          {recap?.title ?? title}
        </p>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-white/85">{subline}</p>
      </div>

      {/*
        Numbers, and only the ones each person can act on. A student is not
        shown the attendance count — it is their tutor's business, and a class
        of three would read to a student as a class nobody bothered to attend.
      */}
      <div className={`grid gap-4 ${isTutor ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        <Stat
          icon={<ClockIcon className="h-5 w-5" />}
          label={isTutor ? "Class ran for" : "You were in class"}
          value={
            loading
              ? "…"
              : isTutor && recap
                ? minutesLabel(recap.durationMinutes)
                : minutesLabel(Math.max(1, Math.round(outcome.durationMs / 60_000)))
          }
        />
        {isTutor ? (
          <Stat
            icon={<UsersIcon className="h-5 w-5" />}
            label="Students who joined"
            value={loading ? "…" : recap ? String(recap.attended) : "—"}
            hint={recap && recap.onTheList > recap.attended ? `of ${recap.onTheList} rung` : undefined}
          />
        ) : null}
        <Stat
          icon={recording?.ready ? <FilmIcon className="h-5 w-5" /> : <PendingIcon className="h-5 w-5" />}
          label="Recording"
          value={
            loading
              ? "…"
              : recording?.ready
                ? "Ready to watch"
                : recording?.status === "failed"
                  ? "Not captured"
                  : recording
                    ? "Processing"
                    : "Not recorded"
          }
          hint={
            recording && !recording.ready && recording.status !== "failed"
              ? "It appears in the library on its own"
              : undefined
          }
        />
      </div>

      <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">What next</h2>
        <div className="mt-4 flex flex-wrap gap-2.5">
          {/*
            The recording gets the primary button only when there IS one. While
            it encodes, the link still goes to the library — the tape shows up
            there by itself — but it is worded as a place to look rather than a
            promise that it has arrived.
          */}
          {recording?.ready && recording.materialId ? (
            <Link
              href={`/materials/watch/${recording.materialId}`}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:brightness-110"
            >
              <FilmIcon className="h-4 w-4" />
              Watch the recording
            </Link>
          ) : (
            <Link
              href="/materials?tab=watch"
              className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-6 py-3 text-sm font-semibold text-[var(--foreground)] transition hover:bg-[var(--surface-alt)]"
            >
              <FilmIcon className="h-4 w-4" />
              Open the video library
            </Link>
          )}

          {canRejoin ? (
            <button
              onClick={onRejoin}
              className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:brightness-110"
            >
              <BroadcastIcon className="h-4 w-4" />
              {dropped ? "Try to rejoin" : "Rejoin the class"}
            </button>
          ) : null}

          <Link
            href={isTutor ? "/lecturer/dashboard" : "/dashboard"}
            className={`inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition ${
              recording?.ready || canRejoin
                ? "border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--surface-alt)]"
                : "bg-[var(--accent)] text-white shadow-lg hover:brightness-110"
            }`}
          >
            <DashboardIcon className="h-4 w-4" />
            Back to my dashboard
          </Link>

          {!isTutor ? (
            <Link
              href="/calendar"
              className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-6 py-3 text-sm font-semibold text-[var(--foreground)] transition hover:bg-[var(--surface-alt)]"
            >
              <CalendarIcon className="h-4 w-4" />
              When is my next class?
            </Link>
          ) : null}
        </div>

        <p className="mt-5 text-xs leading-5 text-[var(--muted)]">
          {isTutor
            ? "Attendance from this class is already on the register, and the tape is filed under the level it was taught at. Nothing else is needed from you."
            : "Your attendance was recorded when you joined. If you had to leave early, the recording covers the rest."}
        </p>
      </div>
    </motion.div>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
        {icon}
      </span>
      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-xl font-semibold text-[var(--foreground)]">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-[var(--muted)]">{hint}</p> : null}
    </div>
  );
}
