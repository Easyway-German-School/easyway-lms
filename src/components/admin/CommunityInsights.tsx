"use client";

import { useEffect, useState } from "react";

type Bucket = {
  activeStudents: number;
  visits: number;
  minutes: number;
  communityStudents: number;
  communityMinutes: number;
  mobileShare: number | null;
  messages: number;
  posters: number;
};

type Payload = {
  windowDays: number;
  roster: { youth: number; classic: number };
  looks: { youth: Bucket; classic: Bucket; untagged: Bucket };
  actions: Record<string, { youth: number; classic: number }>;
  invitation: {
    shown: number;
    tookIt: number;
    declined: number;
    announcedShown: number;
    wentBack: number;
    switchedToNew: number;
  };
  daily: Array<{ day: string; look: "youth" | "classic" | "untagged"; students: number }>;
};

const ACTION_LABELS: Record<string, string> = {
  "community.send": "Sent a message",
  "community.voice": "Voice note",
  "community.sticker": "Sticker",
  "community.attach": "Photo",
  "community.games": "Opened games",
  "community.react": "Reaction picker",
  "community.like": "Like (classic only)",
  "community.reply": "Reply",
  "community.room-open": "Opened a room",
  "community.theme": "Changed chat theme",
};

const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);
const per = (total: number, people: number) => (people ? (total / people).toFixed(1) : "—");

function Row({ label, a, b, hint }: { label: string; a: string | number; b: string | number; hint?: string }) {
  return (
    <tr className="border-t border-[var(--border)]">
      <td className="py-2 pr-3 text-sm text-[var(--foreground-soft)]">
        {label}
        {hint ? <span className="block text-[11px] text-[var(--muted)]">{hint}</span> : null}
      </td>
      <td className="px-3 py-2 text-right text-sm font-bold tabular-nums text-[var(--foreground)]">{a}</td>
      <td className="pl-3 py-2 text-right text-sm font-bold tabular-nums text-[var(--foreground)]">{b}</td>
    </tr>
  );
}

/**
 * THE TWO LOOKS, SIDE BY SIDE — the office's view of whether the new look is
 * landing and how each community is being used. Counts only; see
 * /api/admin/community/insights for what is and is not recorded.
 */
export default function CommunityInsights() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setData(null);
    fetch(`/api/admin/community/insights?days=${days}`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || "Could not load the insights.");
        return body as Payload;
      })
      .then((body) => active && (setData(body), setError("")))
      .catch((e) => active && setError(e instanceof Error ? e.message : "Could not load the insights."));
    return () => {
      active = false;
    };
  }, [days]);

  if (error) return <p className="text-sm font-semibold text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-[var(--muted)]">Loading…</p>;

  const y = data.looks.youth;
  const c = data.looks.classic;
  const inv = data.invitation;
  const actionRows = Object.entries(data.actions).sort((l, r) => r[1].youth + r[1].classic - (l[1].youth + l[1].classic));

  // Last 14 days as a tiny two-line table, newest last.
  const dayList = Array.from(new Set(data.daily.map((d) => d.day))).sort();
  const at = (day: string, look: "youth" | "classic") =>
    data.daily.find((d) => d.day === day && d.look === look)?.students ?? 0;
  const peak = Math.max(1, ...data.daily.filter((d) => d.look !== "untagged").map((d) => d.students));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {[7, 30, 90].map((n) => (
          <button
            key={n}
            onClick={() => setDays(n)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-bold ${
              days === n ? "bg-[var(--accent)] text-white" : "border border-[var(--border)] text-[var(--muted)]"
            }`}
          >
            Last {n} days
          </button>
        ))}
        <span className="text-xs text-[var(--muted)]">
          On the new look now: {data.roster.youth} · On the classic look now: {data.roster.classic}
        </span>
      </div>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h3 className="text-sm font-bold text-[var(--foreground)]">New look vs classic look</h3>
        <table className="mt-2 w-full">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
              <th className="text-left font-semibold" />
              <th className="px-3 text-right font-semibold">New look</th>
              <th className="pl-3 text-right font-semibold">Classic</th>
            </tr>
          </thead>
          <tbody>
            <Row label="Students active" a={y.activeStudents} b={c.activeStudents} />
            <Row label="Visits" a={y.visits} b={c.visits} hint="separate sittings in the portal" />
            <Row label="Minutes in the portal" a={y.minutes} b={c.minutes} />
            <Row label="Minutes per active student" a={per(y.minutes, y.activeStudents)} b={per(c.minutes, c.activeStudents)} />
            <Row label="On a phone" a={pct(y.mobileShare)} b={pct(c.mobileShare)} hint="share of their activity" />
            <Row label="Students who used the community" a={y.communityStudents} b={c.communityStudents} />
            <Row label="Minutes in the community" a={y.communityMinutes} b={c.communityMinutes} />
            <Row label="Messages written" a={y.messages} b={c.messages} hint="by students on that look today" />
            <Row label="Students who posted" a={y.posters} b={c.posters} />
            <Row label="Messages per poster" a={per(y.messages, y.posters)} b={per(c.messages, c.posters)} />
          </tbody>
        </table>
        {data.looks.untagged.activeStudents > 0 ? (
          <p className="mt-2 text-[11px] text-[var(--muted)]">
            Not counted above: {data.looks.untagged.activeStudents} students whose activity was recorded before looks were
            tagged, or before their browser had learned its look.
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h3 className="text-sm font-bold text-[var(--foreground)]">How the invitation is landing</h3>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[
            ["Offer shown", inv.shown],
            ["Tried the new look", inv.tookIt],
            ["Kept their own", inv.declined],
            ["Fresh-look note shown", inv.announcedShown],
            ["Switched to new look (any way)", inv.switchedToNew],
            ["Went back to classic", inv.wentBack],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-xl bg-[var(--surface-alt)] p-3">
              <p className="text-xl font-black tabular-nums text-[var(--foreground)]">{value}</p>
              <p className="text-xs font-semibold text-[var(--foreground-soft)]">{label}</p>
            </div>
          ))}
        </div>
        {inv.shown > 0 ? (
          <p className="mt-2 text-xs text-[var(--muted)]">
            {Math.round((inv.tookIt / inv.shown) * 100)}% of those offered the new look said yes.
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h3 className="text-sm font-bold text-[var(--foreground)]">What people press in the community</h3>
        {actionRows.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">Nothing recorded yet — this fills in as students use the rooms.</p>
        ) : (
          <table className="mt-2 w-full">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
                <th className="text-left font-semibold" />
                <th className="px-3 text-right font-semibold">New look</th>
                <th className="pl-3 text-right font-semibold">Classic</th>
              </tr>
            </thead>
            <tbody>
              {actionRows.map(([key, v]) => (
                <Row key={key} label={ACTION_LABELS[key] ?? key} a={v.youth} b={v.classic} />
              ))}
            </tbody>
          </table>
        )}
      </section>

      {dayList.length > 0 ? (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="text-sm font-bold text-[var(--foreground)]">Students active each day</h3>
          <div className="mt-3 flex items-end gap-1.5" aria-label="Daily active students by look">
            {dayList.map((day) => (
              <div key={day} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <div className="flex h-24 w-full items-end gap-0.5">
                  <div
                    className="w-1/2 rounded-t bg-[var(--accent)]"
                    style={{ height: `${(at(day, "youth") / peak) * 100}%` }}
                    title={`New look: ${at(day, "youth")}`}
                  />
                  <div
                    className="w-1/2 rounded-t bg-[var(--muted)]/60"
                    style={{ height: `${(at(day, "classic") / peak) * 100}%` }}
                    title={`Classic: ${at(day, "classic")}`}
                  />
                </div>
                <span className="text-[9px] text-[var(--muted)]">{day.slice(8)}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-[var(--muted)]">
            <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-[var(--accent)]" />
            New look
            <span className="ml-3 mr-1 inline-block h-2 w-2 rounded-sm bg-[var(--muted)]/60" />
            Classic
          </p>
        </section>
      ) : null}
    </div>
  );
}
