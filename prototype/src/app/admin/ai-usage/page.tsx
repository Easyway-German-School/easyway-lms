"use client";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { AlertIcon, PulseIcon, RefreshIcon } from "@/components/icons";

type Usage = {
  generatedAt: string;
  provider: { interactive: string; backoffice: string; localAvailable: boolean; groqConfigured: boolean; claudeConfigured: boolean };
  today: Array<{ kind: string; limit: number; requests: number }>;
  tokensLast7Days: number;
  recent: Array<{ kind: string; count: number; day: string; updatedAt: string; student: string }>;
  cache: Array<{ task: string; status: string; count: number }>;
};

const labels: Record<string, string> = {
  essay: "Essay grading",
  pronunciation: "Pronunciation",
  missionPractice: "Mission practice",
};

export default function AiUsagePage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/ai-usage", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load AI usage.");
      setUsage(data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load AI usage.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <AdminShell>
      <div className="min-w-0 space-y-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-3 text-3xl font-bold"><PulseIcon className="h-7 w-7" /> AI usage</h1>
            <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">Live student activity, provider routing, limits, and cache health. Content is never shown here.</p>
          </div>
          <button type="button" onClick={load} className="flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold"><RefreshIcon className="h-4 w-4" /> Refresh</button>
        </header>

        {error && <div className="flex items-center gap-3 rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-800"><AlertIcon className="h-5 w-5" />{error}</div>}
        {loading ? <p className="text-sm text-[var(--muted)]">Loading live usage…</p> : usage && (
          <>
            <section className="grid gap-4 md:grid-cols-3">
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5"><p className="text-sm text-[var(--muted)]">Student requests today</p><p className="mt-1 text-3xl font-bold">{usage.today.reduce((sum, row) => sum + row.requests, 0)}</p></div>
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5"><p className="text-sm text-[var(--muted)]">AI tokens, last 7 days</p><p className="mt-1 text-3xl font-bold">{usage.tokensLast7Days.toLocaleString()}</p></div>
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5"><p className="text-sm text-[var(--muted)]">Admin backoffice model</p><p className="mt-1 text-xl font-bold">{usage.provider.backoffice}</p><p className="mt-1 text-xs text-[var(--muted)]">{usage.provider.localAvailable ? "Local runtime reachable" : "Using hosted fallback"}</p></div>
            </section>

            <section className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5"><h2 className="text-lg font-semibold">Today&apos;s student limits</h2><div className="mt-4 space-y-4">{usage.today.map((row) => <div key={row.kind}><div className="flex justify-between text-sm"><span>{labels[row.kind] || row.kind}</span><strong>{row.requests} / {row.limit}</strong></div><div className="mt-2 h-2 rounded-full bg-[var(--border)]"><div className="h-2 rounded-full bg-[var(--primary)]" style={{ width: `${Math.min(100, row.requests / row.limit * 100)}%` }} /></div></div>)}</div></div>
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5"><h2 className="text-lg font-semibold">Provider routing</h2><dl className="mt-4 space-y-3 text-sm"><div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">Student interactive</dt><dd className="font-semibold">{usage.provider.interactive}</dd></div><div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">Admin backoffice</dt><dd className="font-semibold">{usage.provider.backoffice}</dd></div><div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">Ollama reachable</dt><dd className="font-semibold">{usage.provider.localAvailable ? "Yes" : "No"}</dd></div></dl></div>
            </section>

            <section className="space-y-3"><h2 className="text-lg font-semibold">Recent student activity</h2>{usage.recent.length ? <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead className="text-xs text-[var(--muted)]"><tr><th className="py-2 pr-4">Student</th><th className="py-2 pr-4">Feature</th><th className="py-2 pr-4">Requests</th><th className="py-2">Day</th></tr></thead><tbody>{usage.recent.map((row, index) => <tr key={`${row.student}-${row.kind}-${row.day}-${index}`} className="border-t border-[var(--border)]"><td className="py-2 pr-4 font-medium">{row.student}</td><td className="py-2 pr-4">{labels[row.kind] || row.kind}</td><td className="py-2 pr-4">{row.count}</td><td className="py-2 text-[var(--muted)]">{row.day}</td></tr>)}</tbody></table></div> : <p className="text-sm text-[var(--muted)]">No student AI requests recorded yet.</p>}</section>
          </>
        )}
      </div>
    </AdminShell>
  );
}