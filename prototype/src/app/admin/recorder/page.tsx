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
const card = "rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5";
const button = "rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold disabled:opacity-50";

const schoolTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const ago = (seconds: number | null) => (seconds === null ? "never" : seconds < 90 ? "just now" : seconds < 5400 ? `${Math.round(seconds / 60)} min ago` : `${Math.round(seconds / 3600)} h ago`);

export default function RecorderPage() {
  const [status, setStatus] = useState<RecorderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pauseNote, setPauseNote] = useState("");
  const [boostClasses, setBoostClasses] = useState(1);
  const [boostHours, setBoostHours] = useState(2);
  const [skipDate, setSkipDate] = useState("");

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

  // One place for every change: send it, show what happened, refresh.
  const change = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/recorder/control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "That did not work.");
      setNotice(`${done} It reaches the servers within about 5 minutes.`);
      setError(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  const fb = status?.fallback;
  const control = status?.control;
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
        {notice && <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">{notice}</div>}
        {loading && !status ? <p className="text-sm text-[var(--muted)]">Checking the recorder…</p> : status && fb && control && (
          <>
            <section className={`rounded-3xl border p-5 ${healthStyle[status.health]}`}>
              <p className="text-lg font-semibold">{status.headline}</p>
              {status.warnings.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{status.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
            </section>

            <section className="grid gap-4 md:grid-cols-3">
              <div className={card}><p className="text-sm text-[var(--muted)]">Live right now</p><p className="mt-1 text-3xl font-bold">{status.forecast.liveNow}</p></div>
              <div className={card}><p className="text-sm text-[var(--muted)]">Most classes at once, next 24 h</p><p className="mt-1 text-3xl font-bold">{status.forecast.peakNext24h}</p>{status.forecast.nextClassAt && <p className="mt-1 text-xs text-[var(--muted)]">Next: {schoolTime(status.forecast.nextClassAt)}</p>}</div>
              <div className={card}><p className="text-sm text-[var(--muted)]">Recorded this month</p><p className="mt-1 text-xl font-bold">{status.month.ownRecordings} by us · {status.month.liveKitRecordings} by LiveKit</p></div>
            </section>

            {status.fleet && (
              <section className="grid gap-6 lg:grid-cols-2">
                <div className={card}>
                  <h2 className="text-lg font-semibold">Controls</h2>
                  <p className="mt-1 text-xs text-[var(--muted)]">Servers start and stop by themselves from the timetable. Use these only to steer. Nothing here can stop a recording that is in progress.</p>

                  <div className="mt-4 space-y-2 border-t border-[var(--border)] pt-4">
                    <p className="text-sm font-semibold">Automatic servers: {control.paused ? "PAUSED" : "running"}</p>
                    {control.paused ? (
                      <button type="button" disabled={busy} className={button} onClick={() => change({ paused: false }, "Resumed.")}>Resume</button>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <input value={pauseNote} onChange={(e) => setPauseNote(e.target.value)} maxLength={200} placeholder="Why? (optional)" className="min-w-0 flex-1 rounded-full border border-[var(--border)] bg-transparent px-4 py-2 text-sm" />
                        <button type="button" disabled={busy} className={button} onClick={() => { if (window.confirm("Pause automatic servers? No new server will start, so classes will be recorded by LiveKit (which costs money) until you resume.")) change({ paused: true, pauseNote }, "Paused."); }}>Pause</button>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 space-y-2 border-t border-[var(--border)] pt-4">
                    <p className="text-sm font-semibold">Start room for an unplanned class</p>
                    {status.boostActive && control.boost ? (
                      <div className="flex flex-wrap items-center gap-3 text-sm">
                        <span>Room for {control.boost.classes} class{control.boost.classes === 1 ? "" : "es"} until {schoolTime(control.boost.until)}</span>
                        <button type="button" disabled={busy} className={button} onClick={() => change({ boost: null }, "Cancelled.")}>Cancel</button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <select value={boostClasses} onChange={(e) => setBoostClasses(Number(e.target.value))} className="rounded-full border border-[var(--border)] bg-transparent px-3 py-2">{[1, 2, 3, 4, 6].map((n) => <option key={n} value={n}>{n} class{n === 1 ? "" : "es"}</option>)}</select>
                        <select value={boostHours} onChange={(e) => setBoostHours(Number(e.target.value))} className="rounded-full border border-[var(--border)] bg-transparent px-3 py-2">{[1, 2, 4, 8].map((n) => <option key={n} value={n}>for {n} h</option>)}</select>
                        <button type="button" disabled={busy} className={button} onClick={() => change({ boost: { classes: boostClasses, hours: boostHours } }, "A server is being prepared.")}>Start now</button>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 space-y-2 border-t border-[var(--border)] pt-4">
                    <p className="text-sm font-semibold">Days with no classes</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <input type="date" value={skipDate} onChange={(e) => setSkipDate(e.target.value)} className="rounded-full border border-[var(--border)] bg-transparent px-3 py-2 text-sm" />
                      <button type="button" disabled={busy || !skipDate} className={button} onClick={() => { change({ addSkipDate: skipDate }, "Day off added."); setSkipDate(""); }}>Add</button>
                    </div>
                    {control.skipDates.length > 0 && (
                      <ul className="flex flex-wrap gap-2 text-sm">
                        {control.skipDates.map((d) => (
                          <li key={d} className="flex items-center gap-2 rounded-full border border-[var(--border)] px-3 py-1">
                            {d}
                            <button type="button" disabled={busy} aria-label={`Remove ${d}`} className="font-bold" onClick={() => change({ removeSkipDate: d }, "Day removed.")}>×</button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="text-xs text-[var(--muted)]">The timetable already follows holidays you set there. This is for a day you want to switch off for recording only.</p>
                  </div>
                  {control.updatedBy && <p className="mt-4 text-xs text-[var(--muted)]">Last changed by {control.updatedBy}{control.updatedAt ? `, ${schoolTime(control.updatedAt)}` : ""}.</p>}
                </div>

                <div className={card}>
                  <h2 className="text-lg font-semibold">Scheduler</h2>
                  <dl className="mt-3 space-y-2 text-sm">
                    <div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">Main scheduler last reported</dt><dd className="font-semibold">{ago(status.scheduler.primaryAgeSeconds)}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">Standby (second region)</dt><dd className="font-semibold">{status.scheduler.standbyAgeSeconds === null ? "not running" : status.scheduler.standbyActing ? "TAKEN OVER" : `waiting · ${ago(status.scheduler.standbyAgeSeconds)}`}</dd></div>
                  </dl>
                  <h3 className="mt-4 text-sm font-semibold">What it did lately</h3>
                  {status.scheduler.log.length ? (
                    <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto text-xs">
                      {[...status.scheduler.log].reverse().map((line, i) => <li key={`${line.at}-${i}`} className="flex gap-2"><span className="shrink-0 text-[var(--muted)]">{schoolTime(line.at)}</span><span>{line.text}</span></li>)}
                    </ul>
                  ) : <p className="mt-2 text-xs text-[var(--muted)]">Nothing yet. It writes here when it starts or removes a server.</p>}
                </div>
              </section>
            )}

            <section className="grid gap-6 lg:grid-cols-2">
              <div className={card}>
                <h2 className="text-lg font-semibold">Recorder servers</h2>
                {status.servers.length ? (
                  <ul className="mt-3 space-y-2 text-sm">{status.servers.map((s) => <li key={s.id} className="flex justify-between"><span>Server {s.id}</span><strong>{s.active} of {s.capacity} classes</strong></li>)}</ul>
                ) : <p className="mt-3 text-sm text-[var(--muted)]">None running. Servers start by themselves before a class and stop afterwards.</p>}
                {status.directoryAgeSeconds !== null && <p className="mt-3 text-xs text-[var(--muted)]">Last report {status.directoryAgeSeconds}s ago</p>}
              </div>
              <div className={card}>
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
