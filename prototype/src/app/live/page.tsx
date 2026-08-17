"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Suspense, useCallback, useEffect, useState } from "react";
import BrandLoader from "@/components/BrandLoader";
import StudentShell from "@/components/StudentShell";
import LecturerShell from "@/components/LecturerShell";
import type { LeaveOutcome } from "@/components/live/LiveKitClassroom";
import { useLiveCall } from "@/components/live/LiveCallContext";
import SessionEndScreen from "@/components/live/SessionEndScreen";
import PreflightCheck from "@/components/live/PreflightCheck";
import JoinByCode from "@/components/live/JoinByCode";
import LiveClassCode from "@/components/live/LiveClassCode";
import { BroadcastIcon, CalendarIcon, FilmIcon } from "@/components/icons";
import { qualityModesFor, qualitySpec, type QualityMode, type RoomRole } from "@/lib/live-classroom";
import type { LiveSession } from "@/lib/live-call-session";

/**
 * The pre-join screen.
 *
 * Deliberately not skipped. A student on mobile data who lands straight in a
 * 720p room has already lost the first minute of the lesson to a frozen
 * picture. Thirty seconds spent choosing a quality up front is the cheapest
 * fix available, and it is the one thing the student actually controls.
 */
function Lobby({
  session,
  mode,
  onModeChange,
  onJoin,
}: {
  session: LiveSession;
  mode: QualityMode;
  onModeChange: (mode: QualityMode) => void;
  onJoin: () => void;
}) {
  // A tutor is offered Sharp and nothing else — see `qualityModesFor()`.
  const choices = qualityModesFor(session.role);
  const isTutor = session.role === "tutor";

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-gradient-to-br from-[#0D7C7E] via-[#0D7C7E] to-[#FF6600] p-6 text-white shadow-xl sm:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/70">
            {session.isPrivate ? "One-to-one class" : session.isOnlineBranch ? "EasyWay Online" : "Live classroom"}
          </p>
          {/* Only shown to a student, and only because it is true: the tutor is
              already in the room by the time a student can be here at all. */}
          {!isTutor && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
              </span>
              Live
            </span>
          )}
        </div>

        <h1 className="mt-3 text-2xl font-semibold sm:text-4xl">{session.displayName}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/85">
          {isTutor
            ? "Your cohort joins this same room. Starting the class rings every student on your roster — students who arrive early will be waiting inside."
            : session.tutorName
              ? `${session.tutorName} is already in the room. Pick the quality that matches your connection, then join.`
              : "Your tutor and classmates are in this room. Pick the quality that matches your connection, then join."}
        </p>
      </div>

      {/* The code is the tutor's to read out, so it sits above the fold for
          them and is not shown to a student at all — they already got in. */}
      {isTutor && session.joinCode ? <LiveClassCode code={session.joinCode} /> : null}

      <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
        <h2 className="text-lg font-semibold">{choices.length > 1 ? "Choose your video quality" : "You teach in Sharp"}</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {choices.length > 1 ? (
            <>
              We have pre-selected <span className="font-semibold text-[var(--foreground)]">{qualitySpec(mode).label}</span>
              {session.isOnlineBranch
                ? " based on the connection you told us about at signup."
                : " as a safe starting point."}{" "}
              You can change it at any point during class.
            </>
          ) : (
            <>
              Your class is subscribed to you, so the server sends each student the best layer their own line can carry. Turning your
              own quality down would turn it down for everybody — so there is nothing to choose here. Each student picks their own.
            </>
          )}
        </p>

        <div className={`mt-5 grid gap-3 ${choices.length > 1 ? "sm:grid-cols-2" : ""}`}>
          {choices.map((spec) => {
            const active = spec.value === mode;
            const single = choices.length === 1;
            return (
              <button
                key={spec.value}
                type="button"
                disabled={single}
                onClick={() => onModeChange(spec.value)}
                className={`rounded-2xl border p-4 text-left transition ${
                  active
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] shadow-[0_8px_24px_rgba(10,124,255,0.12)]"
                    : "border-[var(--border)] bg-[var(--surface-alt)] hover:border-slate-300"
                } ${single ? "cursor-default" : ""}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-[var(--foreground)]">{spec.label}</span>
                  <span className="text-xs font-medium text-[var(--muted)]">{spec.dataHint}</span>
                </div>
                <p className="mt-1.5 text-sm text-[var(--muted)]">{spec.description}</p>
              </button>
            );
          })}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            onClick={onJoin}
            className="rounded-full bg-[var(--accent)] px-8 py-3 text-sm font-semibold text-white shadow-lg transition hover:brightness-110"
          >
            {isTutor ? "Start the class" : "Join the class"}
          </button>
          <span className="text-xs text-[var(--muted)]">You can change any of this during the lesson.</span>
          <Link
            href={isTutor ? "/lecturer/dashboard" : "/dashboard"}
            className="rounded-full border border-[var(--border)] px-6 py-3 text-sm font-semibold text-[var(--foreground)] transition hover:bg-[var(--surface-alt)]"
          >
            Back to dashboard
          </Link>
        </div>
      </div>

      {/*
        The pre-flight sits BELOW the quality choice and ABOVE the reassurance
        cards, because it depends on the quality: an audio-only student is never
        asked for a camera, so they are never shown one failing.
      */}
      <PreflightCheck wantsVideo={qualitySpec(mode).publishesVideo} />

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          {
            title: "Audio survives a bad line",
            body: "Speech is sent with redundancy, so it holds together through heavy packet loss — even when video cannot.",
          },
          {
            title: "Your link, your quality",
            body: "Everyone receives the quality their own connection can carry. One weak connection no longer slows the whole class.",
          },
          {
            title: "Nothing is lost",
            body: "Every class is recorded into your video library, so a drop-out costs you minutes rather than the lesson.",
          },
        ].map((card) => (
          <div key={card.title} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <p className="text-sm font-semibold text-[var(--foreground)]">{card.title}</p>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{card.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * NOBODY IS TEACHING RIGHT NOW.
 *
 * This screen replaced the worst moment in the old classroom: a student who
 * arrived early, or a day late, or simply curious, met an empty grey video grid
 * that is indistinguishable from a class where everybody has their camera off.
 * They concluded the portal was broken, and there was nothing to disagree with
 * them.
 *
 * So the empty room is never shown. What the student gets instead is the truth
 * plus three ways forward, because a dead end is the thing that actually loses
 * people: a promise to buzz them, the timetable that says when, the recordings
 * of the last one, and a box for a code if their tutor is running a session
 * their timetable does not know about.
 */
function NotLiveScreen({ message, title }: { message: string; title: string | null }) {
  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center sm:p-10">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-[var(--surface-alt)] text-[var(--muted)]">
          <BroadcastIcon className="h-8 w-8" />
        </span>
        <h1 className="mt-5 text-2xl font-semibold text-[var(--foreground)]">No class in session</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[var(--muted)]">{message}</p>
        {title ? (
          <p className="mt-2 text-xs font-medium uppercase tracking-[0.2em] text-[var(--muted)]">{title}</p>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-center gap-2.5">
          <Link
            href="/calendar"
            className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:brightness-110"
          >
            <CalendarIcon className="h-4 w-4" />
            When is my next class?
          </Link>
          <Link
            href="/materials?tab=watch"
            className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-5 py-2.5 text-sm font-semibold text-[var(--foreground)] transition hover:bg-[var(--surface-alt)]"
          >
            <FilmIcon className="h-4 w-4" />
            Watch the last class
          </Link>
        </div>

        {/* Said plainly, because the alternative is a student who refreshes this
            page every four minutes for an hour. */}
        <p className="mt-6 text-xs text-[var(--muted)]">
          You do not need to keep checking. Your phone and the bell will both go off the moment your tutor starts.
        </p>
      </div>

      <JoinByCode />
    </div>
  );
}

function LiveClassroomPageInner() {
  const searchParams = useSearchParams();
  const code = searchParams.get("code");

  const [session, setSession] = useState<LiveSession | null>(null);
  const [lockedMessage, setLockedMessage] = useState<string | null>(null);
  const [notLive, setNotLive] = useState<{ message: string; title: string | null } | null>(null);
  const [misconfigured, setMisconfigured] = useState<{
    message: string;
    missing: string[] | null;
    /** Kept so a tutor meeting this screen still gets the tutor portal around it. */
    role: RoomRole;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<QualityMode>("medium");
  const liveCall = useLiveCall();
  /**
   * Set the moment somebody leaves, and the reason they left with it.
   *
   * This is what stopped the old behaviour: leaving simply flipped `joined`
   * back to false, which re-rendered the lobby — and for a student whose class
   * had just ended, the lobby's own "nothing is live" branch then told them
   * there was no class, which is a lousy way to be thanked for attending one.
   */
  const [ended, setEnded] = useState<LeaveOutcome | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      /**
       * EVERY SCREEN THIS PAGE CAN SHOW IS RESET FIRST, AND THAT IS THE WHOLE
       * REASON JOIN CODES NEVER WORKED.
       *
       * `JoinByCode` is rendered in exactly one place: inside `NotLiveScreen`.
       * So by construction, a student typing a code always has `notLive` set
       * already. The box pushed `/live?code=…`, this effect re-ran and happily
       * fetched a perfectly good session — and then the render below hit
       * `if (notLive) return <NotLiveScreen/>` BEFORE it ever looked at
       * `session`, because nothing had cleared the stale screen. The student
       * got "No class in session" over and over while the button sat on
       * "Opening…", and the code they had been given looked broken.
       *
       * A fetch that is about to replace the answer must first throw away the
       * previous one. Every branch below sets exactly one of these, so leaving
       * any of them standing means the page renders a stale verdict about a
       * request that has already been superseded.
       */
      setNotLive(null);
      setError(null);
      setLockedMessage(null);
      setMisconfigured(null);
      setEnded(null);
      setLoading(true);

      try {
        const query = code ? `?code=${encodeURIComponent(code)}` : "";
        const res = await fetch(`/api/live/session${query}`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;

        if (res.status === 401) {
          setError("Please sign in to join your class.");
          return;
        }
        if (res.status === 409 && data.notLive) {
          setNotLive({ message: data.message, title: data.displayName ?? null });
          return;
        }
        if (res.status === 404 && code) {
          setNotLive({
            message: "That code does not match a class that is live right now. Check it with your tutor — codes change every class.",
            title: null,
          });
          return;
        }
        if (res.status === 403) {
          setLockedMessage(data.message || "Pay your deposit to join live classes.");
          return;
        }
        /**
         * The deployment is missing its classroom credentials.
         *
         * Given its own screen rather than folded into the generic error,
         * because it is the one failure on this page that is not the student's
         * problem, not the network's, and not fixable by trying again — and
         * because the staff version of it names the exact variable to set.
         */
        if (res.status === 503 && data.misconfigured) {
          setMisconfigured({
            message: data.message,
            missing: data.missing ?? null,
            role: data.role === "tutor" ? "tutor" : "student",
          });
          return;
        }
        if (!res.ok) {
          setError(data.error || "Could not set up the classroom.");
          return;
        }

        setSession(data as LiveSession);
        setMode((data as LiveSession).initialQuality);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not reach the classroom service.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [code]);

  /**
   * The tutor's heartbeat and the explicit, idempotent "end class" call both
   * moved into `LiveCallContext` — they have to keep running while the call
   * is minimized or the tutor is looking at a completely different page,
   * which this component is no longer guaranteed to be mounted for.
   */
  const isTutor = session?.role === "tutor";

  /**
   * A call this page started can end while the tutor/student is elsewhere —
   * the dock clears `activeCall` and parks the outcome for whoever asks. This
   * claims it the moment it appears, which is what stopped the old behaviour:
   * leaving used to just flip a local `joined` flag, and for a student whose
   * class had just ended, the lobby's own "nothing is live" branch would then
   * say so — a lousy way to be thanked for attending a lesson.
   */
  useEffect(() => {
    if (!session) return;
    const outcome = liveCall.takeOutcomeFor(session.roomName);
    if (outcome) setEnded(outcome);
  }, [session, liveCall.activeCall, liveCall.takeOutcomeFor]);

  const joinedActive = Boolean(
    session && liveCall.activeCall && liveCall.activeCall.session.roomName === session.roomName,
  );

  const handleJoin = useCallback(() => {
    if (!session || !session.token || !session.url) return;
    liveCall.startCall(session, mode);
  }, [session, mode, liveCall]);

  /** Going back in is a fresh join, so the end screen has to get out of the way. */
  const handleRejoin = useCallback(() => {
    if (!session || !session.token || !session.url) return;
    setEnded(null);
    liveCall.startCall(session, mode);
  }, [session, mode, liveCall]);

  const body = (() => {
    if (loading) {
      return <BrandLoader size="lg" title="Klassenzimmer wird geöffnet…" message="Setting up your classroom." />;
    }

    if (error) {
      return (
        <div className="rounded-3xl border border-rose-500/30 bg-rose-500/10 p-8 text-sm text-rose-600">
          <p className="text-base font-semibold">We could not open your classroom</p>
          <p className="mt-2">{error}</p>
          <Link href="/dashboard" className="mt-5 inline-flex rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white">
            Back to dashboard
          </Link>
        </div>
      );
    }

    if (misconfigured) {
      return (
        <div className="rounded-3xl border border-rose-500/30 bg-rose-500/10 p-8 text-sm text-rose-600">
          <p className="text-base font-semibold">The live classroom is not configured</p>
          <p className="mt-2 leading-6">{misconfigured.message}</p>
          {misconfigured.missing ? (
            <ul className="mt-4 space-y-1.5">
              {misconfigured.missing.map((name) => (
                <li key={name} className="font-mono text-xs font-semibold">
                  {name} <span className="font-sans font-normal opacity-70">— not set</span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-2.5">
            <Link
              href="/materials?tab=watch"
              className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white"
            >
              <FilmIcon className="h-4 w-4" />
              Watch the last class
            </Link>
            <Link
              href="/dashboard"
              className="rounded-full border border-current/30 px-6 py-2.5 text-sm font-semibold"
            >
              Back to dashboard
            </Link>
          </div>
        </div>
      );
    }

    if (lockedMessage) {
      return (
        <div className="rounded-3xl border border-amber-500/40 bg-amber-500/10 p-8 text-sm text-amber-700">
          <p className="text-base font-semibold">Live classes are locked</p>
          <p className="mt-2">{lockedMessage}</p>
          <Link href="/programs" className="mt-5 inline-flex rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white">
            Pay tuition now
          </Link>
        </div>
      );
    }

    /**
     * ORDERED ABOVE `notLive` ON PURPOSE.
     *
     * By the time a class has ended, the session poll would happily start
     * reporting "no class in session" — so if the not-live screen came first,
     * the thank-you would be replaced by a notice that nothing is happening,
     * which is the exact bug this screen exists to fix. Having just been in the
     * room outranks the room now being empty.
     */
    if (ended && session) {
      return (
        <SessionEndScreen
          role={session.role}
          title={session.displayName}
          liveSessionId={session.liveSessionId}
          outcome={ended}
          onRejoin={handleRejoin}
        />
      );
    }

    if (notLive) return <NotLiveScreen message={notLive.message} title={notLive.title} />;

    if (!session) return null;

    if (!joinedActive) {
      return <Lobby session={session} mode={mode} onModeChange={setMode} onJoin={handleJoin} />;
    }

    /**
     * There is one classroom, and no second-best one behind it.
     *
     * The route refuses the request outright when LiveKit is not configured, so
     * reaching this point without a token means something raced — a token that
     * expired between the lobby and the Join button, most likely. Saying so and
     * offering a reload beats rendering an empty shell.
     */
    if (!session.token || !session.url) {
      return (
        <div className="rounded-3xl border border-amber-500/40 bg-amber-500/10 p-8 text-sm text-amber-700">
          <p className="text-base font-semibold">Your place in the room expired</p>
          <p className="mt-2 leading-6">
            The key to this classroom is short-lived, and this one has run out. Reload the page and you will go straight in.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-5 rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white"
          >
            Reload and join
          </button>
        </div>
      );
    }

    /**
     * The actual video is not rendered here — `LiveCallDock` (mounted once,
     * in the root layout) owns the one `LiveKitClassroom` instance so it can
     * survive navigating away from this page. In full mode the dock is a
     * fixed full-screen overlay above everything, so there is nothing left
     * for this page to show. If the student has minimized WHILE looking at
     * this exact page, though, the overlay steps aside and this page needs
     * to offer a way back in.
     */
    if (liveCall.dockState === "minimized") {
      return (
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
          <p className="text-base font-semibold text-[var(--foreground)]">Your class is minimized</p>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted)]">
            It is still running in the small window on your screen — nobody has been dropped.
          </p>
          <button
            onClick={() => liveCall.setDockState("full")}
            className="mt-5 rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white"
          >
            Expand
          </button>
        </div>
      );
    }

    return null;
  })();

  const content = (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: "easeOut" }}
      className="min-h-screen px-4 py-6 sm:px-6 sm:py-10"
    >
      <div className="mx-auto max-w-5xl">{body}</div>
    </motion.div>
  );

  // Tutors and students both live here, so the page picks the chrome that
  // matches whoever is signed in rather than hard-coding the student portal.
  if (session?.role === "tutor" || misconfigured?.role === "tutor") return <LecturerShell>{content}</LecturerShell>;
  // The not-live screen is a student's screen: it belongs inside their portal,
  // with the sidebar and the bell, not on a bare page that looks like an error.
  if (session || notLive || lockedMessage || misconfigured) return <StudentShell>{content}</StudentShell>;
  return <div className="min-h-screen bg-[var(--background)]">{content}</div>;
}

export default function LiveClassroomPage() {
  // `useSearchParams` opts the tree into client-side rendering, and Next
  // requires the boundary to be explicit rather than inferred.
  return (
    <Suspense fallback={<BrandLoader size="lg" title="Klassenzimmer wird geöffnet…" message="Setting up your classroom." />}>
      <LiveClassroomPageInner />
    </Suspense>
  );
}
