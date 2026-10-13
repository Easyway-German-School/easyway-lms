"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import BrandLoader from "@/components/BrandLoader";
import AdminObserver from "@/components/live/AdminObserver";
import { CINEMA } from "@/components/live/LiveKitClassroom";
import ClassNotesHealth from "@/components/admin/ClassNotesHealth";
import LiveClassHistory from "@/components/admin/LiveClassHistory";
import { PulseIcon, VideoIcon, ChevronRightIcon, EyeIcon, ClockIcon, BellIcon } from "@/components/icons";

/**
 * WHO IS LIVE RIGHT NOW — the school's own version of the dashboard LiveKit
 * Cloud gives an operator, built from the same two layers the API route
 * documents: a cheap read of LiveClassSession for "which rooms, since when,
 * taught by whom, who was invited" and, per room, a fresh call to LiveKit's
 * own server API for who is actually connected. See
 * src/app/api/admin/live/route.ts for why connection QUALITY specifically is
 * not part of this — LiveKit does not expose it outside the room itself.
 *
 * Ten-second poll on the summary, matching TutorLivePanel's own cadence —
 * this is the same "somebody is watching names arrive in real time" job, on
 * the other side of the desk.
 */

type SessionSummary = {
  id: string;
  roomName: string;
  title: string;
  kind: string;
  branchId: string | null;
  branchName: string | null;
  level: string | null;
  sessionSlot: string | null;
  lecturerName: string | null;
  startedAt: string;
  joinCode: string;
  invited: number;
  joined: number;
  declined: number;
  participantCount: number | null;
  observers: number;
};

type Participant = {
  identity: string;
  name: string;
  role: string;
  joinedAt: string;
  camera: "on" | "off" | "none";
  mic: "on" | "off" | "none";
};

function elapsed(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function StatePill({ state }: { state: "on" | "off" | "none" }) {
  if (state === "none") return <span className="text-[#9A9690]">—</span>;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        // Camera/mic "off" is a normal state, not a problem — red is reserved
        // for an actual failed/terminal state elsewhere on this page.
        state === "on" ? "bg-[#3FC3C6]/15 text-[#3FC3C6]" : "bg-white/10 text-[#9A9690]"
      }`}
    >
      {state === "on" ? "On" : "Off"}
    </span>
  );
}

export default function AdminLivePage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [observing, setObserving] = useState<{ roomName: string; title: string } | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [participantsError, setParticipantsError] = useState("");
  const [participantsBusy, setParticipantsBusy] = useState(false);
  const [tab, setTab] = useState<"live" | "history">("live");
  const [renotifying, setRenotifying] = useState<string | null>(null);
  const [renotifyResult, setRenotifyResult] = useState<{ sessionId: string; message: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/live", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not load live classes");
        return;
      }
      setSessions(data.sessions ?? []);
      setError("");
    } catch {
      setError("Could not load live classes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 10_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function toggle(roomName: string) {
    if (expanded === roomName) {
      setExpanded(null);
      return;
    }
    setExpanded(roomName);
    setParticipants([]);
    setParticipantsError("");
    setParticipantsBusy(true);
    try {
      const res = await fetch(`/api/admin/live?room=${encodeURIComponent(roomName)}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setParticipantsError(data.error || "Could not load who's in this room");
        return;
      }
      setParticipants(data.participants ?? []);
    } catch {
      setParticipantsError("Could not load who's in this room");
    } finally {
      setParticipantsBusy(false);
    }
  }

  async function resendNotifications(sessionId: string) {
    setRenotifying(sessionId);
    setRenotifyResult(null);
    try {
      const res = await fetch("/api/admin/live/renotify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRenotifyResult({ sessionId, message: data.error || "Could not resend notifications." });
        return;
      }
      setRenotifyResult({
        sessionId,
        message:
          typeof data.namedStudentsConsidered === "number"
            ? `Resent. Anyone already notified was skipped — ${data.namedStudentsConsidered} named/hybrid/online student${data.namedStudentsConsidered === 1 ? "" : "s"} were checked.`
            : "Resent to this class's roster.",
      });
    } catch {
      setRenotifyResult({ sessionId, message: "Could not resend notifications." });
    } finally {
      setRenotifying(null);
    }
  }

  if (loading) {
    return (
      <AdminShell>
        <BrandLoader fill size="lg" title="Einen Moment…" message="Checking which classes are live." />
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <div
        className="h-screen overflow-y-auto text-white"
        // Same dark cinema ground as the classroom's own immersive mode (see
        // CINEMA in LiveKitClassroom.tsx) — this page is where staff watch a
        // live class, so it reads as "this app, at night" rather than a
        // regular light admin screen with a video feature bolted on.
        style={{
          background:
            "radial-gradient(1100px 620px at 6% -10%, rgba(63,195,198,0.16), transparent 55%), radial-gradient(900px 560px at 98% -4%, rgba(255,122,26,0.12), transparent 55%), linear-gradient(180deg, #030607 0%, #050b0c 45%, #04090a 100%)",
        }}
      >
        <div className="border-b border-white/[0.08] bg-[linear-gradient(135deg,_rgba(255,122,26,0.14)_0%,_transparent_60%)] p-6">
          <div className="mx-auto max-w-5xl">
            <h1 className="flex items-center gap-3 text-3xl font-bold text-white">
              <PulseIcon className="h-7 w-7 text-[#FF7A1A]" />
              Live classes
            </h1>
            <p className="mt-2 text-[#9A9690]">
              Every class in session right now, across every branch — who's teaching it, how long it's been running,
              and who's actually connected. Open one to watch it silently: the tutor and students are not told, and
              you are not in their participant list.
            </p>

            <div className={`mt-4 inline-flex rounded-full border border-white/[0.08] ${CINEMA.tileBg} p-1`}>
              <button
                onClick={() => setTab("live")}
                className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                  tab === "live" ? `${CINEMA.ctaBg} text-white` : "text-[#9A9690] hover:text-white"
                }`}
              >
                <PulseIcon className="h-4 w-4" /> Live now
              </button>
              <button
                onClick={() => setTab("history")}
                className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                  tab === "history" ? `${CINEMA.ctaBg} text-white` : "text-[#9A9690] hover:text-white"
                }`}
              >
                <ClockIcon className="h-4 w-4" /> History
              </button>
            </div>
          </div>
        </div>

        {tab === "history" ? (
          <div className="mx-auto max-w-5xl p-6">
            <p className="mb-4 text-sm text-[#9A9690]">
              Every past live class — when it actually started against when its session was due, and when it ended.
              Use this to check whether a tutor is consistently late, not just whether one is live now.
            </p>
            <LiveClassHistory />
          </div>
        ) : (
        <div className="mx-auto max-w-5xl space-y-4 p-6">
          {error ? (
            <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>
          ) : null}

          <ClassNotesHealth />

          {sessions.length === 0 ? (
            <div className={`rounded-2xl border border-white/[0.08] ${CINEMA.tileBg} p-10 text-center`}>
              <VideoIcon className="mx-auto h-8 w-8 text-[#9A9690]" />
              <p className="mt-3 font-semibold text-white">No classes live right now</p>
              <p className="mt-1 text-sm text-[#9A9690]">
                This page updates itself every ten seconds — nothing to refresh.
              </p>
            </div>
          ) : (
            sessions.map((session) => (
              <div key={session.id} className={`rounded-2xl border border-white/[0.08] ${CINEMA.tileBg}`}>
                <button
                  onClick={() => toggle(session.roomName)}
                  className="flex w-full items-center gap-4 p-5 text-left"
                >
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#3FC3C6] opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#3FC3C6]" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-white">{session.title}</p>
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-[#9A9690]">
                        {[session.branchName, session.level, session.sessionSlot].filter(Boolean).join(" · ") || session.kind}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-[#9A9690]">
                      {session.lecturerName ?? "No tutor on record"} · live {elapsed(session.startedAt)}
                      {session.declined > 0 ? ` · ${session.declined} declined` : ""}
                      {session.observers > 0
                        ? ` · ${session.observers} watching silently`
                        : ""}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      role="button"
                      tabIndex={0}
                      title="Re-send the 'your class is live' ping to this tutor's roster — use this when some students report they never got the notification or a join code."
                      onClick={(event) => {
                        event.stopPropagation();
                        void resendNotifications(session.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.stopPropagation();
                          event.preventDefault();
                          void resendNotifications(session.id);
                        }
                      }}
                      className={`inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] px-3 py-1 text-xs font-semibold text-white transition hover:border-[#FF7A1A] hover:text-[#FFB273] ${
                        renotifying === session.id ? "opacity-60" : ""
                      }`}
                    >
                      <BellIcon className="h-3.5 w-3.5" />
                      {renotifying === session.id ? "Resending…" : "Resend notifications"}
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.stopPropagation();
                        setObserving({ roomName: session.roomName, title: session.title });
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.stopPropagation();
                          event.preventDefault();
                          setObserving({ roomName: session.roomName, title: session.title });
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] px-3 py-1 text-xs font-semibold text-white transition hover:border-[#FF7A1A] hover:text-[#FFB273]"
                    >
                      <EyeIcon className="h-3.5 w-3.5" />
                      Watch silently
                    </span>
                    <span className="rounded-full bg-[#FF7A1A]/15 px-3 py-1 text-xs font-semibold text-[#FFB273]">
                      {session.participantCount === null
                        ? "Unknown"
                        : `${session.participantCount} connected`}
                    </span>
                    <ChevronRightIcon
                      className={`h-4 w-4 text-[#9A9690] transition-transform ${expanded === session.roomName ? "rotate-90" : ""}`}
                    />
                  </div>
                </button>

                {renotifyResult && renotifyResult.sessionId === session.id ? (
                  <p className="border-t border-white/[0.08] px-5 py-2.5 text-xs text-[#9A9690]">
                    {renotifyResult.message}
                  </p>
                ) : null}

                {expanded === session.roomName ? (
                  <div className="border-t border-white/[0.08] p-5">
                    {participantsBusy ? (
                      <p className="text-sm text-[#9A9690]">Asking LiveKit who's actually in the room…</p>
                    ) : participantsError ? (
                      <p className="text-sm text-rose-300">{participantsError}</p>
                    ) : participants.length === 0 ? (
                      <p className="text-sm text-[#9A9690]">Nobody is connected to this room right now.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-[#9A9690]">
                              <th className="pb-2 pr-4">Name</th>
                              <th className="pb-2 pr-4">Role</th>
                              <th className="pb-2 pr-4">In room</th>
                              <th className="pb-2 pr-4">Camera</th>
                              <th className="pb-2">Mic</th>
                            </tr>
                          </thead>
                          <tbody>
                            {participants.map((participant) => (
                              <tr key={participant.identity} className="border-t border-white/[0.08]">
                                <td className="py-2 pr-4 font-medium text-white">{participant.name}</td>
                                <td className="py-2 pr-4 capitalize text-[#9A9690]">{participant.role}</td>
                                <td className="py-2 pr-4 text-[#9A9690]">{elapsed(participant.joinedAt)}</td>
                                <td className="py-2 pr-4">
                                  <StatePill state={participant.camera} />
                                </td>
                                <td className="py-2">
                                  <StatePill state={participant.mic} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
        )}
      </div>

      {observing ? (
        <AdminObserver
          roomName={observing.roomName}
          title={observing.title}
          onClose={() => setObserving(null)}
        />
      ) : null}
    </AdminShell>
  );
}
