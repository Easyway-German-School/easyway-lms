"use client";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { AlertIcon, PulseIcon, RefreshIcon } from "@/components/icons";
import type { RecorderStatus } from "@/lib/recorder-status";

const healthStyle: Record<RecorderStatus["health"], string> = {
  ok: "border-emerald-300 bg-emerald-50 text-emerald-900",
  idle: "border-[var(--border)] bg-[var(--surface)]",
  warning: "border-amber-300 bg-amber-50 text-amber-900",
  critical: "border-red-300 bg-red-50 text-red-800",
  off: "border-[var(--border)] bg-[var(--surface)]",
};

const modeLabel = { immediate: "Immediately", delayed: "After a wait", never: "Never" } as const;

export default function RecorderPage() {
  const [status, setStatus] = useState<RecorderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/recorder", { cache: "no-store" });
      const text = await response.text();
      let data: { error?: string } & Partial<RecorderStatus> = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(`The recording service returned an invalid response (${response.status}).`);
      }
      if (!response.ok) throw new Error(data.error || "Could not load recording status.");
      setStatus(data as RecorderStatus);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load recording status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const fb = status?.fallback;
  return (
    <AdminShell>
      <div className="min-w-0 space-y-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-3 text-3xl font-bold"><PulseIcon className="h-7 w-7" /> Class recording</h1>
            <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">Whether our own recorder is on duty, what the LiveKit safety net has cost this month, and which classes are coming.</p>
          </div>
          <button type="button" onClick={load} className="flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold"><RefreshIcon className="h-4 w-4" /> Refresh</button>
        </header>

        {error && <div className="flex items-center gap-3 rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-800"><AlertIcon className="h-5 w-5" />{error}</div>}
        {loading && !status ? <p className="text-sm text-[var(--muted)]">Checking the recorder…</p> : status && fb && (
          <>
            <section className={`rounded-3xl border p-5 ${healthStyle[status.health]}`}>
              <p className="text-lg font-semibold">{status.headline}</p>
              {status.warnings.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{status.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
            </section>

            <section className="grid gap-4 md:grid-cols-3">
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5"><p className="text-sm text-[var(--muted)]">Live right now</p><p className="mt-1 text-3xl font-bold">{status.forecast.liveNow}</p></div>
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5"><p className="text-sm text-[var(--muted)]">Most classes at once, next 24 h</p><p className="mt-1 text-3xl font-bold">{status.forecast.peakNext24h}</p>{status.forecast.nextClassAt && <p className="mt-1 text-xs text-[var(--muted)]">Next: {new Date(status.forecast.nextClassAt).toLocaleString()}</p>}</div>
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5"><p className="text-sm text-[var(--muted)]">Recorded this month</p><p className="mt-1 text-xl font-bold">{status.month.ownRecordings} by us · {status.month.liveKitRecordings} by LiveKit</p></div>
            </section>

            <section className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5">
                <h2 className="text-lg font-semibold">Recorder servers</h2>
                {status.servers.length ? (
                  <ul className="mt-3 space-y-2 text-sm">{status.servers.map((s) => <li key={s.id} className="flex justify-between"><span>Server {s.id}</span><strong>{s.active} of {s.capacity} classes</strong></li>)}</ul>
                ) : <p className="mt-3 text-sm text-[var(--muted)]">None running. Servers start by themselves before a class and stop afterwards.</p>}
                {status.directoryAgeSeconds !== null && <p className="mt-3 text-xs text-[var(--muted)]">Last report {status.directoryAgeSeconds}s ago</p>}
              </div>
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5">
                <h2 className="text-lg font-semibold">LiveKit safety net</h2>
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">Starts</dt><dd className="font-semibold">{modeLabel[fb.mode]}{fb.mode === "delayed" ? ` (${fb.afterMinutes} min)` : ""}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">Used this month</dt><dd className="font-semibold">{fb.minutesUsed} min · about ${fb.estimatedCostUsd.toFixed(2)}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">Monthly cap</dt><dd className="font-semibold">{fb.monthlyCapMinutes === null ? "None" : `${fb.monthlyCapMinutes} min`}</dd></div>
                </dl>
              </div>
            </section>
          </>
        )}
      </div>
    </AdminShell>
  );
}
