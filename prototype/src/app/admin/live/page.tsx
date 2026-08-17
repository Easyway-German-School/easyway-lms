"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import BrandLoader from "@/components/BrandLoader";
import { PulseIcon, VideoIcon, ChevronRightIcon } from "@/components/icons";

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
  if (state === "none") return <span className="text-[var(--muted)]">—</span>;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        state === "on" ? "bg-emerald-500/15 text-emerald-600" : "bg-rose-500/15 text-rose-600"
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
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [participantsError, setParticipantsError] = useState("");
  const [participantsBusy, setParticipantsBusy] = useState(false);

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

  if (loading) {
    return (
      <AdminShell>
        <BrandLoader fill size="lg" title="Einen Moment…" message="Checking which classes are live." />
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <div className="h-screen overflow-y-auto">
        <div className="border-b border-[var(--border)] bg-gradient-to-r from-[var(--accent)]/20 to-transparent p-6">
          <div className="mx-auto max-w-5xl">
            <h1 className="flex items-center gap-3 text-3xl font-bold text-[var(--foreground)]">
              <PulseIcon className="h-7 w-7 text-[var(--accent)]" />
              Live classes
            </h1>
            <p className="mt-2 text-[var(--muted)]">
              Every class in session right now, across every branch — who's teaching it, how long it's been running,
              and who's actually connected.
            </p>
          </div>
        </div>

        <div className="mx-auto max-w-5xl space-y-4 p-6">
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
          ) : null}

          {sessions.length === 0 ? (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center">
              <VideoIcon className="mx-auto h-8 w-8 text-[var(--muted)]" />
              <p className="mt-3 font-semibold text-[var(--foreground)]">No classes live right now</p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                This page updates itself every ten seconds — nothing to refresh.
              </p>
            </div>
          ) : (
            sessions.map((session) => (
              <div key={session.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
                <button
                  onClick={() => toggle(session.roomName)}
                  className="flex w-full items-center gap-4 p-5 text-left"
                >
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-[var(--foreground)]">{session.title}</p>
                      <span className="rounded-full bg-[var(--surface-alt)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted)]">
                        {[session.branchName, session.level, session.sessionSlot].filter(Boolean).join(" · ") || session.kind}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {session.lecturerName ?? "No tutor on record"} · live {elapsed(session.startedAt)}
                      {session.kind === "cohort" ? ` · ${session.joined}/${session.invited} joined` : ""}
                      {session.declined > 0 ? ` · ${session.declined} declined` : ""}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--accent)]">
                      {session.participantCount === null
                        ? "Unknown"
                        : `${session.participantCount} connected`}
                    </span>
                    <ChevronRightIcon
                      className={`h-4 w-4 text-[var(--muted)] transition-transform ${expanded === session.roomName ? "rotate-90" : ""}`}
                    />
                  </div>
                </button>

                {expanded === session.roomName ? (
                  <div className="border-t border-[var(--border)] p-5">
                    {participantsBusy ? (
                      <p className="text-sm text-[var(--muted)]">Asking LiveKit who's actually in the room…</p>
                    ) : participantsError ? (
                      <p className="text-sm text-rose-600">{participantsError}</p>
                    ) : participants.length === 0 ? (
                      <p className="text-sm text-[var(--muted)]">Nobody is connected to this room right now.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
                              <th className="pb-2 pr-4">Name</th>
                              <th className="pb-2 pr-4">Role</th>
                              <th className="pb-2 pr-4">In room</th>
                              <th className="pb-2 pr-4">Camera</th>
                              <th className="pb-2">Mic</th>
                            </tr>
                          </thead>
                          <tbody>
                            {participants.map((participant) => (
                              <tr key={participant.identity} className="border-t border-[var(--border)]">
                                <td className="py-2 pr-4 font-medium text-[var(--foreground)]">{participant.name}</td>
                                <td className="py-2 pr-4 capitalize text-[var(--muted)]">{participant.role}</td>
                                <td className="py-2 pr-4 text-[var(--muted)]">{elapsed(participant.joinedAt)}</td>
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
      </div>
    </AdminShell>
  );
}
