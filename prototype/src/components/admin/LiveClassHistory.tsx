"use client";

import { useCallback, useEffect, useState } from "react";
import { LEVELS, SESSION_SLOTS, slotTitle } from "@/lib/school-settings";
import { ClockIcon } from "@/components/icons";

/**
 * "Did this tutor start on time?" — the history half of /admin/live. The
 * "right now" tab only ever shows what's live this second; a session that
 * ended is invisible the moment it ends unless it lands here. Every row reads
 * straight off `LiveClassSession.startedAt`/`endedAt`, which has been
 * recorded since the live-presence feature shipped — this is the first UI
 * that surfaces it. See lib/live-history.ts for how "scheduled" and "late"
 * are derived.
 */

type HistoryRow = {
  id: string;
  roomName: string;
  title: string;
  kind: string;
  branchName: string | null;
  level: string | null;
  sessionSlot: string | null;
  lecturerName: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number | null;
  scheduledAt: string | null;
  lateMinutes: number | null;
};

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function clockOnly(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function LatePill({ minutes }: { minutes: number | null }) {
  if (minutes === null) return <span className="text-[var(--muted)]">—</span>;
  if (minutes <= 0) {
    return (
      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-600">
        {minutes === 0 ? "On time" : `${Math.abs(minutes)}m early`}
      </span>
    );
  }
  const severe = minutes >= 15;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        severe ? "bg-rose-500/15 text-rose-600" : "bg-amber-500/15 text-amber-700"
      }`}
    >
      {minutes}m late
    </span>
  );
}

export default function LiveClassHistory() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [level, setLevel] = useState("");
  const [sessionSlot, setSessionSlot] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (level) params.set("level", level);
      if (sessionSlot) params.set("sessionSlot", sessionSlot);
      const res = await fetch(`/api/admin/live/history?${params.toString()}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not load live class history");
        return;
      }
      setRows(data.rows ?? []);
      setTotal(data.total ?? 0);
      setError("");
    } catch {
      setError("Could not load live class history");
    } finally {
      setLoading(false);
    }
  }, [page, level, sessionSlot]);

  useEffect(() => {
    void load();
  }, [load]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={level}
          onChange={(e) => {
            setPage(1);
            setLevel(e.target.value);
          }}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)]"
        >
          <option value="">All levels</option>
          {LEVELS.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <select
          value={sessionSlot}
          onChange={(e) => {
            setPage(1);
            setSessionSlot(e.target.value);
          }}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)]"
        >
          <option value="">All sessions</option>
          {SESSION_SLOTS.map((s) => (
            <option key={s} value={s}>{slotTitle(s)}</option>
          ))}
        </select>
        <span className="text-xs text-[var(--muted)]">{total} class{total === 1 ? "" : "es"}</span>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
              <th className="px-4 py-3">Class</th>
              <th className="px-4 py-3">Tutor</th>
              <th className="px-4 py-3">Scheduled</th>
              <th className="px-4 py-3">Started</th>
              <th className="px-4 py-3">Ended</th>
              <th className="px-4 py-3">Duration</th>
              <th className="px-4 py-3">Punctuality</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[var(--muted)]">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[var(--muted)]">
                  <ClockIcon className="mx-auto mb-2 h-6 w-6 text-[var(--muted)]" />
                  No live classes recorded yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium text-[var(--foreground)]">{row.title}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {[row.branchName, row.level, row.sessionSlot ? slotTitle(row.sessionSlot) : null, row.kind === "private" ? "Private" : null]
                        .filter(Boolean)
                        .join(" · ") || fmt(row.startedAt)}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-[var(--foreground)]">{row.lecturerName ?? "—"}</td>
                  <td className="px-4 py-3 text-[var(--muted)]">
                    {row.scheduledAt ? clockOnly(row.scheduledAt) : "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--foreground)]">{fmt(row.startedAt)}</td>
                  <td className="px-4 py-3 text-[var(--muted)]">{row.endedAt ? clockOnly(row.endedAt) : "Still live"}</td>
                  <td className="px-4 py-3 text-[var(--muted)]">
                    {row.durationMinutes === null ? "—" : `${row.durationMinutes}m`}
                  </td>
                  <td className="px-4 py-3">
                    <LatePill minutes={row.lateMinutes} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 ? (
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium text-[var(--foreground)] disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-xs text-[var(--muted)]">Page {page} of {pageCount}</span>
          <button
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={page >= pageCount}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium text-[var(--foreground)] disabled:opacity-40"
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}
