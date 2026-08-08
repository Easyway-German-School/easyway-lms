"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import BrandLoader from "@/components/BrandLoader";
import StudentShell from "@/components/StudentShell";
import LecturerShell from "@/components/LecturerShell";
import JitsiClassroom from "@/components/live/JitsiClassroom";
import LiveKitClassroom from "@/components/live/LiveKitClassroom";
import PreflightCheck from "@/components/live/PreflightCheck";
import { qualityModesFor, qualitySpec, type QualityMode, type RoomRole } from "@/lib/live-classroom";

type LiveSession = {
  provider: "livekit" | "jitsi";
  token: string | null;
  url: string | null;
  roomName: string;
  displayName: string;
  role: RoomRole;
  level: string;
  sessionSlot: string;
  branchName: string | null;
  isOnlineBranch: boolean;
  initialQuality: QualityMode;
  participantName: string;
};

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

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-gradient-to-br from-[#0D7C7E] via-[#0D7C7E] to-[#FF6600] p-8 text-white shadow-xl">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/70">
          {session.isOnlineBranch ? "EasyWay Online" : "Live classroom"}
        </p>
        <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">{session.displayName}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/85">
          {session.role === "tutor"
            ? "Your cohort joins this same room. Start whenever you are ready — students who arrive early will be waiting inside."
            : "Your tutor and classmates are in this room. Pick the quality that matches your connection, then join."}
        </p>
      </div>

      <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6">
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
            Join the class
          </button>
          <span className="text-xs text-[var(--muted)]">You can change any of this during the lesson.</span>
          <Link
            href={session.role === "tutor" ? "/lecturer/dashboard" : "/dashboard"}
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

export default function LiveClassroomPage() {
  const [session, setSession] = useState<LiveSession | null>(null);
  const [lockedMessage, setLockedMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [joined, setJoined] = useState(false);
  const [mode, setMode] = useState<QualityMode>("medium");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/live/session", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));

        if (res.status === 401) {
          setError("Please sign in to join your class.");
          return;
        }
        if (res.status === 403) {
          setLockedMessage(data.message || "Pay your deposit to join live classes.");
          return;
        }
        if (!res.ok) {
          setError(data.error || "Could not set up the classroom.");
          return;
        }

        setSession(data as LiveSession);
        setMode((data as LiveSession).initialQuality);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Could not reach the classroom service.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const handleLeave = useCallback(() => setJoined(false), []);

  const body = (() => {
    if (loading) {
      return <BrandLoader size="lg" title="Klassenzimmer wird geöffnet…" message="Setting up your classroom." />;
    }

    if (error) {
      return (
        <div className="rounded-3xl border border-rose-200 bg-rose-50 p-8 text-sm text-rose-800">
          <p className="text-base font-semibold">We could not open your classroom</p>
          <p className="mt-2">{error}</p>
          <Link href="/dashboard" className="mt-5 inline-flex rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white">
            Back to dashboard
          </Link>
        </div>
      );
    }

    if (lockedMessage) {
      return (
        <div className="rounded-3xl border border-amber-300 bg-amber-50 p-8 text-sm text-amber-900">
          <p className="text-base font-semibold">Live classes are locked</p>
          <p className="mt-2">{lockedMessage}</p>
          <Link href="/programs" className="mt-5 inline-flex rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white">
            Pay tuition now
          </Link>
        </div>
      );
    }

    if (!session) return null;

    if (!joined) {
      return <Lobby session={session} mode={mode} onModeChange={setMode} onJoin={() => setJoined(true)} />;
    }

    if (session.provider === "livekit" && session.token && session.url) {
      return (
        <LiveKitClassroom
          url={session.url}
          token={session.token}
          roomName={session.roomName}
          displayName={session.displayName}
          role={session.role}
          initialQuality={mode}
          onLeave={handleLeave}
        />
      );
    }

    return (
      <JitsiClassroom
        roomName={session.roomName}
        displayName={session.displayName}
        participantName={session.participantName}
        audioFirst={mode === "audio"}
        onLeave={handleLeave}
      />
    );
  })();

  const content = (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: "easeOut" }}
      className="min-h-screen px-6 py-10"
    >
      <div className="mx-auto max-w-5xl">{body}</div>
    </motion.div>
  );

  // Tutors and students both live here, so the page picks the chrome that
  // matches whoever is signed in rather than hard-coding the student portal.
  if (session?.role === "tutor") return <LecturerShell>{content}</LecturerShell>;
  if (session) return <StudentShell>{content}</StudentShell>;
  return <div className="min-h-screen bg-[var(--background)]">{content}</div>;
}
