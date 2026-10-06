"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Pattern = {
  key: string;
  label: string;
  tone: string;
  engagement: number;
  risk: number;
  peakHour: number | null;
  daysSinceSeen: number | null;
  sessionsPerWeek: number;
  avgSessionMinutes: number;
};

type Person = {
  studentId: string;
  name: string;
  email: string | null;
  age: number | null;
  level: string;
  branch: string | null;
  sitting: string | null;
  look: "youth" | "classic";
  reason: "chosen" | "wave" | "default";
  cohort: "wave" | "invited";
  prompted: boolean;
  lastSeenAt: string | null;
  minutes: number;
  communityMinutes: number;
  messages: number;
  lastPostedAt: string | null;
  device: "mobile" | "desktop" | "mixed" | "unknown";
  optedOut: boolean;
  pattern: Pattern | null;
};

type Payload = {
  windowDays: number;
  counts: { total: number; youth: number; classic: number; active: number; posters: number };
  people: Person[];
};

const REASON: Record<Person["reason"], string> = {
  wave: "Under 25 — new look by default",
  chosen: "They picked this",
  default: "Classic unless they switch",
};

const DEVICE: Record<Person["device"], string> = {
  mobile: "Phone",
  desktop: "Laptop",
  mixed: "Phone + laptop",
  unknown: "—",
};

function ago(iso: string | null) {
  if (!iso) return "Never";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 2) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Yesterday" : `${days}d ago`;
}

function hourLabel(hour: number | null) {
  if (hour === null) return "—";
  if (hour === 0) return "12am";
  if (hour === 12) return "12pm";
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

/**
 * WHO IS IN EACH LOOK, AND WHAT THEY DO — the named half of Community Insights.
 *
 * Totals live on the Insights tab. This is the roster the office actually
 * works from: filter by look, search a name, open their remote file.
 */
export default function CommunityPeople() {
  const [days, setDays] = useState(30);
  const [look, setLook] = useState<"all" | "youth" | "classic">("all");
  const [q, setQ] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setData(null);
    fetch(`/api/admin/community/people?days=${days}`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || "Could not load the people.");
        return body as Payload;
      })
      .then((body) => active && (setData(body), setError("")))
      .catch((e) => active && setError(e instanceof Error ? e.message : "Could not load the people."));
    return () => {
      active = false;
    };
  }, [days]);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.people.filter((p) => {
      if (look !== "all" && p.look !== look) return false;
      if (!needle) return true;
      return [p.name, p.email, p.level, p.branch, p.sitting, p.pattern?.label]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });
  }, [data, look, q]);

  if (error) return <p className="text-sm font-semibold text-red-600">{error}</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--muted)]">
        Every active student, which look they are on, and how they have used the portal and the community in the last{" "}
        {data?.windowDays ?? days} days. Open a name to see their live trail. Totals and trends are on the Insights tab.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {(["all", "youth", "classic"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setLook(value)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-bold ${
              look === value ? "bg-[var(--accent)] text-white" : "border border-[var(--border)] text-[var(--muted)]"
            }`}
          >
            {value === "all"
              ? `All${data ? ` (${data.counts.total})` : ""}`
              : value === "youth"
                ? `New look${data ? ` (${data.counts.youth})` : ""}`
                : `Classic${data ? ` (${data.counts.classic})` : ""}`}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-[var(--border)]" />
        {[7, 30, 90].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setDays(n)}
            className={`rounded-full px-3 py-1.5 text-xs font-bold ${
              days === n ? "bg-[var(--foreground)] text-[var(--surface)]" : "border border-[var(--border)] text-[var(--muted)]"
            }`}
          >
            {n}d
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a name, level, branch…"
          className="ml-auto min-w-[12rem] flex-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3.5 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
        />
      </div>

      {data ? (
        <p className="text-xs text-[var(--muted)]">
          {data.counts.active} active in this window · {data.counts.posters} posted in community · showing {rows.length}
        </p>
      ) : (
        <p className="text-sm text-[var(--muted)]">Loading the roster…</p>
      )}

      {data && rows.length === 0 ? (
        <p className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">
          Nobody matches that. Try the other look, or clear the search.
        </p>
      ) : null}

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[11px] uppercase tracking-wider text-[var(--muted)]">
                <th className="px-3 py-2.5 font-semibold">Student</th>
                <th className="px-3 py-2.5 font-semibold">Look</th>
                <th className="px-3 py-2.5 font-semibold">Last seen</th>
                <th className="px-3 py-2.5 font-semibold">Pattern</th>
                <th className="px-3 py-2.5 text-right font-semibold">Community</th>
                <th className="px-3 py-2.5 text-right font-semibold">Portal min</th>
                <th className="px-3 py-2.5 font-semibold">Device</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.studentId} className="border-t border-[var(--border)]/70 align-top">
                  <td className="px-3 py-2.5">
                    <Link
                      href={`/admin/students/${p.studentId}/remote`}
                      className="font-semibold text-[var(--foreground)] underline-offset-2 hover:underline"
                    >
                      {p.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">
                      {[p.age !== null ? `${p.age}` : null, p.level, p.branch, p.sitting].filter(Boolean).join(" · ")}
                    </p>
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        p.look === "youth"
                          ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                          : "bg-[var(--surface-alt)] text-[var(--foreground-soft)]"
                      }`}
                    >
                      {p.look === "youth" ? "New look" : "Classic"}
                    </span>
                    <p className="mt-0.5 text-[11px] text-[var(--muted)]">{REASON[p.reason]}</p>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-[var(--foreground-soft)]">{ago(p.lastSeenAt)}</td>
                  <td className="px-3 py-2.5">
                    {p.optedOut ? (
                      <span className="text-xs text-[var(--muted)]">Asked not to be tracked</span>
                    ) : p.pattern ? (
                      <>
                        <p className="font-semibold text-[var(--foreground)]">{p.pattern.label}</p>
                        <p className="text-[11px] text-[var(--muted)]">
                          Usually {hourLabel(p.pattern.peakHour)}
                          {p.pattern.daysSinceSeen !== null ? ` · quiet ${p.pattern.daysSinceSeen}d` : ""}
                        </p>
                      </>
                    ) : (
                      <span className="text-xs text-[var(--muted)]">No pattern yet</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    <p className="font-bold">{p.messages}</p>
                    <p className="text-[11px] text-[var(--muted)]">
                      {p.communityMinutes ? `${p.communityMinutes} min` : ago(p.lastPostedAt)}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 text-right font-bold tabular-nums">{p.minutes || "—"}</td>
                  <td className="px-3 py-2.5 text-[var(--foreground-soft)]">{DEVICE[p.device]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
