"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import AdminShell from "@/components/AdminShell";
import {
  AlertIcon,
  BellIcon,
  DeviceIcon,
  EyeIcon,
  LockIcon,
  RefreshIcon,
  ShieldIcon,
  UnlockIcon,
} from "@/components/icons";

/**
 * REMOTE VIEW — one student's portal, over their shoulder.
 *
 * WHY THIS SCREEN EXISTS. The office needed to answer "what is she actually
 * seeing?" while on the phone to a student, and the only tool available was
 * resetting that student's password and logging in as them. That locks a
 * paying customer out of their own account mid-conversation, puts a login in
 * the audit trail with the student's name on it, and leaves a member of staff
 * holding a working credential for somebody else's account.
 *
 * SO THIS IS A MIRROR, NOT A DOOR. Nothing here can act. There is no session
 * swap, no cookie, no button that writes. It reads the student's state and
 * draws it. The distinction matters beyond tidiness: the moment staff can act
 * as a student, every record of what "the student" did becomes unreliable
 * evidence, and that is not recoverable after the fact.
 *
 * THREE THINGS IT SHOWS, in the order the phone call needs them:
 *   1. WHAT IS ON THEIR SCREEN — padlock state, which tabs open, what the
 *      bell says. This answers the actual complaint nine times in ten.
 *   2. WHERE THEY HAVE BEEN — the movement trail, grouped into visits, so
 *      "I've been trying all week" can be checked kindly rather than argued.
 *   3. HOW THEY LEARN — the behaviour reading, so the conversation can be
 *      about their habit rather than about their excuse.
 *
 * THE STUDENT IS TOLD, in the sense that matters: every opening of this page
 * writes an audit line naming the admin who opened it. See the route.
 */

type Remote = {
  generatedAt: string;
  identity: {
    id: string;
    studentCode: string | null;
    name: string;
    email: string | null;
    photoUrl: string | null;
    level: string;
    status: string;
    classType: string;
    deliveryMode: string;
    sessionSlot: string;
    branch: string | null;
    tutor: string | null;
  };
  portal: {
    locked: boolean;
    registrationPaid: boolean;
    progressPercent: number;
    outstanding?: number;
    totalPaid?: number;
    tuitionFee?: number;
    tabs: Array<{ path: string; label: string; hidden: boolean; locked: boolean }>;
  };
  screen: {
    nextClass: { at: string | null; topic: string | null; status: string } | null;
    unreadNotifications: number;
    latestNotifications: Array<{ id: string; title: string; body: string; at: string; read: boolean }>;
    openAssignments: number;
    examReadiness: number;
  };
  presence: { onlineNow: boolean; lastSeenAt: string | null; currentArea: string | null };
  behaviour: {
    archetype: string;
    summary: string;
    engagementScore: number;
    riskScore: number;
    predictability: number;
    sessionsPerWeek: number;
    avgSessionMinutes: number;
    daysSinceSeen: number | null;
    peakHourLabel: string | null;
    signals: { hourHistogram: number[]; currentStreak: number; longestStreak: number; totalMinutes: number };
  } | null;
  optedOut: boolean;
  trail: Array<{
    id: string;
    area: string;
    action: string;
    path: string | null;
    detail: string | null;
    deviceKind: string | null;
    sessionKey: string | null;
    seconds: number;
    at: string;
  }>;
};

function naira(value: number) {
  return `₦${Math.round(value / 100).toLocaleString()}`;
}

function clock(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function ago(iso: string | null) {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function duration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.round(seconds / 60)}m`;
}

export default function RemoteViewPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id as string;
  const [data, setData] = useState<Remote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmingAct, setConfirmingAct] = useState(false);
  const [acting, setActing] = useState(false);
  const [actError, setActError] = useState<string | null>(null);
  // Client-side gate only, so the button is not offered to someone the server
  // route will refuse anyway. The route re-checks this itself either way.
  const [canActAs, setCanActAs] = useState(false);

  useEffect(() => {
    fetch("/api/admin/me", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((me) => setCanActAs(me?.adminRole === "super"))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const response = await fetch(`/api/admin/students/${id}/remote`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(response.status === 403 ? "You do not have access to student records" : "Could not open the remote view");
      }
      setData(await response.json());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not open the remote view");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function startActingAs(studentId: string) {
    setActing(true);
    setActError(null);
    try {
      const response = await fetch(`/api/admin/students/${studentId}/impersonate`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not start");
      // Hard navigation: the session cookie just changed under this tab, and
      // the app's own client-side session cache has no way to know that.
      window.location.href = body.redirectTo || "/dashboard";
    } catch (startError) {
      setActError(startError instanceof Error ? startError.message : "Could not start");
      setActing(false);
      setConfirmingAct(false);
    }
  }

  /**
   * Re-read every 30 seconds, and only while the tab is visible. This screen
   * is opened during a phone call and wants to move as the student moves; it
   * is also exactly the kind of page somebody leaves open on a second monitor
   * overnight, and a page that polls unattended until morning is a bill.
   *
   * The audit trail deliberately records EVERY read, so the interval is slow
   * on purpose: a two-second poll would bury the deliberate opening of this
   * file under thousands of automatic ones and make the trail useless.
   */
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = window.setInterval(tick, 30000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [load]);

  /** The trail, cut into visits so a burst of clicks reads as one sitting. */
  const visits = useMemo(() => {
    if (!data) return [];
    const groups: Array<{ key: string; startedAt: string; endedAt: string; rows: Remote["trail"] }> = [];
    for (const row of data.trail) {
      const key = row.sessionKey ?? `solo-${row.id}`;
      const last = groups[groups.length - 1];
      if (last && last.key === key) {
        last.rows.push(row);
        last.startedAt = row.at;
      } else {
        groups.push({ key, startedAt: row.at, endedAt: row.at, rows: [row] });
      }
    }
    return groups;
  }, [data]);

  const clockMax = useMemo(
    () => Math.max(1, ...(data?.behaviour?.signals.hourHistogram ?? [1])),
    [data],
  );

  if (loading && !data) {
    return (
      <AdminShell>
        <p className="text-sm text-[var(--muted)]">Opening the remote view…</p>
      </AdminShell>
    );
  }

  if (error && !data) {
    return (
      <AdminShell>
        <div className="rounded-3xl border border-red-300 bg-red-50 p-6 text-sm text-red-700">
          {error}
          <button type="button" onClick={() => void load()} className="ml-3 font-bold underline">
            Retry
          </button>
        </div>
      </AdminShell>
    );
  }

  if (!data) return null;
  const { identity, portal, screen, presence, behaviour, trail } = data;

  return (
    <AdminShell>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href={`/admin/students/${identity.id}`}
            className="text-sm font-semibold text-[var(--muted)] transition hover:text-[var(--foreground)]"
          >
            ← Back to {identity.name.split(" ")[0]}&apos;s file
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--muted)]">Refreshed {ago(data.generatedAt)}</span>
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold transition hover:bg-[var(--surface-alt)]"
            >
              <RefreshIcon className="h-4 w-4" />
              Refresh
            </button>
            {!canActAs ? null : !confirmingAct ? (
              <button
                type="button"
                onClick={() => setConfirmingAct(true)}
                className="inline-flex items-center gap-2 rounded-full border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-700 transition hover:bg-amber-500/20 dark:text-amber-300"
              >
                <EyeIcon className="h-4 w-4" />
                Act as {identity.name.split(" ")[0]}
              </button>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
                Sign in as {identity.name.split(" ")[0]}?
                <button
                  type="button"
                  disabled={acting}
                  onClick={() => void startActingAs(identity.id)}
                  className="rounded-full bg-amber-600 px-3 py-1 text-xs font-bold text-white transition hover:bg-amber-700 disabled:opacity-60"
                >
                  {acting ? "Starting…" : "Yes"}
                </button>
                <button
                  type="button"
                  disabled={acting}
                  onClick={() => setConfirmingAct(false)}
                  className="rounded-full px-2 py-1 text-xs font-semibold text-amber-700/70 hover:text-amber-700 dark:text-amber-300/70"
                >
                  Cancel
                </button>
              </span>
            )}
          </div>
        </div>

        {actError ? (
          <div className="rounded-2xl border border-red-300 bg-red-50 p-3 text-sm text-red-700">{actError}</div>
        ) : null}

        {/* ---- The standing promise this screen makes ------------------- */}
        <div className="flex flex-wrap items-start gap-3 rounded-3xl border border-sky-400/40 bg-sky-500/10 p-5">
          <span className="mt-0.5 text-sky-600">
            <ShieldIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-sky-900 dark:text-sky-200">
              Everything above this line is looking, not logging in.
            </p>
            <p className="mt-1 text-sm text-sky-900/80 dark:text-sky-200/80">
              Nothing on this page can change {identity.name.split(" ")[0]}&apos;s account or mark anything as read on
              its own. Their password is untouched and their own session is unaffected either way — they are never
              signed out. Opening this page is recorded under your name; so is &quot;Act as&quot;, every time it is
              used, at the highest audit severity, because it is the one control here that genuinely becomes them.
            </p>
          </div>
        </div>

        {/* ---- Who, and are they here right now ------------------------- */}
        <div className="overflow-hidden rounded-3xl border border-[var(--border)] bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 p-6 text-white shadow-lg sm:p-8">
          <div className="flex flex-wrap items-start gap-6">
            <div className="relative">
              {identity.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={identity.photoUrl}
                  alt={identity.name}
                  className="h-24 w-24 rounded-2xl border-2 border-white/20 object-cover"
                />
              ) : (
                <div className="grid h-24 w-24 place-items-center rounded-2xl border-2 border-dashed border-white/20 text-3xl font-black text-white/40">
                  {identity.name.slice(0, 1).toUpperCase()}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 font-mono text-xs tracking-[0.2em] text-white/50">
                <EyeIcon className="h-3.5 w-3.5" />
                REMOTE VIEW · {identity.studentCode ?? "NO CODE"}
              </p>
              <h1 className="mt-1 text-3xl font-black tracking-tight">{identity.name}</h1>
              <p className="mt-1 text-sm text-white/70">
                {identity.level} · {identity.classType === "private" ? "Private" : "Group"} · {identity.deliveryMode}
                {identity.branch ? ` · ${identity.branch}` : ""}
                {identity.tutor ? ` · tutor ${identity.tutor}` : ""}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <span
                  className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${
                    presence.onlineNow ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 text-white/60"
                  }`}
                >
                  <span className="relative flex h-2 w-2">
                    {presence.onlineNow && (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    )}
                    <span
                      className={`relative inline-flex h-2 w-2 rounded-full ${presence.onlineNow ? "bg-emerald-400" : "bg-white/40"}`}
                    />
                  </span>
                  {presence.onlineNow ? `In the portal now · ${presence.currentArea ?? "somewhere"}` : `Last seen ${ago(presence.lastSeenAt)}`}
                </span>
              </div>
            </div>

            <div
              className={`rounded-2xl border px-5 py-4 ${
                portal.locked ? "border-red-400/40 bg-red-500/10" : "border-emerald-400/40 bg-emerald-500/10"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={portal.locked ? "text-red-300" : "text-emerald-300"}>
                  {portal.locked ? <LockIcon /> : <UnlockIcon />}
                </span>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/70">
                  {portal.locked ? "Their portal is locked" : "Their portal is open"}
                </p>
              </div>
              {portal.outstanding !== undefined ? (
                <p className="mt-2 text-sm font-bold">
                  {portal.outstanding > 0 ? `${naira(portal.outstanding)} to unlock` : "Nothing outstanding"}
                </p>
              ) : (
                <p className="mt-2 text-sm font-bold">
                  {portal.registrationPaid ? "Registration paid" : "Nothing paid yet"}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ---- What is on their screen --------------------------------- */}
        <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
          <h2 className="text-lg font-bold">What they see when they open the app</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Resolved by the same rules the student&apos;s own portal uses, so this cannot disagree with what is
            actually on their phone.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            {portal.tabs
              .filter((tab) => !tab.hidden)
              .map((tab) => (
                <span
                  key={tab.path}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                    tab.locked
                      ? "border-red-400/40 bg-red-500/10 text-red-600"
                      : "border-emerald-400/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  }`}
                >
                  {tab.locked ? <LockIcon className="h-3 w-3" /> : <UnlockIcon className="h-3 w-3" />}
                  {tab.label}
                </span>
              ))}
            {portal.tabs
              .filter((tab) => tab.hidden)
              .map((tab) => (
                <span
                  key={tab.path}
                  className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--muted)]"
                  title="Not shown to this student at all — their delivery mode does not include it"
                >
                  {tab.label} · not shown
                </span>
              ))}
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              {
                label: "Unread notifications",
                value: String(screen.unreadNotifications),
                sub: screen.unreadNotifications > 8 ? "A bell this loud gets ignored" : "On their bell right now",
              },
              {
                label: "Next class",
                value: screen.nextClass?.at ? clock(screen.nextClass.at) : screen.nextClass?.topic ?? "None scheduled",
                // Only a real booking has a status worth printing. The
                // fallback is the free-text line off their record, and
                // labelling that "scheduled" reads as a confirmation of
                // something that was never booked.
                sub: screen.nextClass?.at
                  ? screen.nextClass.status
                  : screen.nextClass
                    ? "From their dashboard, not a confirmed booking"
                    : "Nothing on their calendar",
              },
              { label: "Work not handed in", value: String(screen.openAssignments), sub: "Started but never submitted" },
              { label: "Exam readiness", value: `${screen.examReadiness}%`, sub: "As shown on their dashboard" },
            ].map((tile) => (
              <div key={tile.label} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">{tile.label}</p>
                <p className="mt-1.5 truncate text-lg font-black" title={tile.value}>
                  {tile.value}
                </p>
                <p className="mt-0.5 text-xs text-[var(--muted)]">{tile.sub}</p>
              </div>
            ))}
          </div>

          {screen.latestNotifications.length > 0 && (
            <div className="mt-6">
              <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
                <BellIcon className="h-3.5 w-3.5" />
                The last things we sent them
              </p>
              <ul className="mt-3 divide-y divide-[var(--border)]">
                {screen.latestNotifications.map((row) => (
                  <li key={row.id} className="flex items-start gap-3 py-2.5">
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${row.read ? "bg-[var(--border)]" : "bg-[var(--accent)]"}`}
                      title={row.read ? "Read" : "Unread"}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{row.title}</p>
                      <p className="truncate text-xs text-[var(--muted)]">{row.body}</p>
                    </div>
                    <span className="shrink-0 text-xs text-[var(--muted)]">{ago(row.at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* ---- How they learn ------------------------------------------ */}
        {data.optedOut ? (
          <div className="flex items-start gap-3 rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)] p-5 text-sm">
            <span className="mt-0.5 text-[var(--muted)]">
              <AlertIcon className="h-4 w-4" />
            </span>
            <p className="text-[var(--muted)]">
              This student has asked not to be measured, so no behaviour reading is kept for them and none is shown
              here. Their portal state above is unaffected.
            </p>
          </div>
        ) : behaviour ? (
          <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            <h2 className="text-lg font-bold">How they actually study</h2>
            <p className="mt-2 text-sm">{behaviour.summary}</p>

            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: "Engagement", value: `${behaviour.engagementScore}/100`, sub: "Recency, frequency and depth combined" },
                { label: "Drop-out risk", value: `${behaviour.riskScore}/100`, sub: "Silence and decline, not just low usage" },
                {
                  /*
                    A learner with five recorded movements all in one hour
                    scores 100% predictable, which is arithmetically true and a
                    lie in a tile. Until there is a habit to read, this says so.
                  */
                  label: "Best time to reach them",
                  value: behaviour.archetype === "newcomer" ? "Too early to say" : behaviour.peakHourLabel ?? "Unknown",
                  sub:
                    behaviour.archetype === "newcomer"
                      ? "Not enough visits yet to call it a habit"
                      : `${Math.round(behaviour.predictability * 100)}% predictable`,
                },
                {
                  label: "Rhythm",
                  value: `${behaviour.sessionsPerWeek}/week`,
                  sub: `${behaviour.avgSessionMinutes} min a sitting · ${behaviour.signals.currentStreak}-day streak`,
                },
              ].map((tile) => (
                <div key={tile.label} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">{tile.label}</p>
                  <p className="mt-1.5 text-lg font-black">{tile.value}</p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">{tile.sub}</p>
                </div>
              ))}
            </div>

            <p className="mt-6 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
              Their day, on their own clock
            </p>
            <div className="mt-2 flex h-24 items-end gap-1">
              {behaviour.signals.hourHistogram.map((value, hour) => (
                <div key={hour} className="flex flex-1 flex-col items-center justify-end gap-1">
                  <div
                    className="w-full rounded-t bg-[var(--accent)]"
                    style={{ height: `${Math.max(2, (value / clockMax) * 100)}%` }}
                    title={`${hour}:00`}
                  />
                  {hour % 6 === 0 && <span className="text-[9px] text-[var(--muted)]">{hour}</span>}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* ---- Where they have been ------------------------------------ */}
        <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
          <h2 className="text-lg font-bold">Where they have been</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            The last {trail.length} movement{trail.length === 1 ? "" : "s"}, grouped into visits. Pages and buttons
            only — nothing typed is ever recorded, so there is nothing here to read over anybody&apos;s shoulder.
          </p>

          {visits.length === 0 ? (
            <p className="mt-5 text-sm text-[var(--muted)]">
              Nothing recorded. Either they have not opened the portal since tracking began, or they have opted out.
            </p>
          ) : (
            <ol className="mt-5 space-y-5">
              {visits.map((visit) => (
                <li key={visit.key} className="relative border-l-2 border-[var(--border)] pl-5">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <p className="text-sm font-bold">{clock(visit.startedAt)}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {visit.rows.length} step{visit.rows.length === 1 ? "" : "s"}
                      {visit.rows[0]?.deviceKind ? ` · ${visit.rows[0].deviceKind}` : ""}
                    </p>
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {visit.rows.map((row) => (
                      <li key={row.id} className="flex flex-wrap items-center gap-2 text-xs">
                        <span
                          className={`rounded-full px-2 py-0.5 font-bold uppercase tracking-wider ${
                            row.action === "view"
                              ? "bg-[var(--surface-alt)] text-[var(--muted)]"
                              : "bg-[var(--accent)]/15 text-[var(--accent)]"
                          }`}
                        >
                          {row.action}
                        </span>
                        <span className="font-mono">{row.path ?? row.area}</span>
                        {row.detail && <span className="text-[var(--muted)]">· {row.detail}</span>}
                        {row.seconds > 0 && <span className="text-[var(--muted)]">· {duration(row.seconds)}</span>}
                        {row.deviceKind && (
                          <span className="inline-flex items-center gap-1 text-[var(--muted)]">
                            <DeviceIcon className="h-3 w-3" />
                            {row.deviceKind}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </AdminShell>
  );
}
