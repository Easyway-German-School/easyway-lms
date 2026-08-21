"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";

 type Report = {
  windowDays: number;
  consentedStudents: number;
  feedback: Array<{ id: string; kind: string; message: string; path: string | null; status: string; createdAt: string; user: { name: string | null; email: string } }>;
  usage: Array<{ area: string; seconds: number; events: number }>;
  patterns: Array<{ area: string; action: string; events: number }>;
};

export default function BetaPage() {
  const [report, setReport] = useState<Report | null>(null);
  useEffect(() => { fetch("/api/admin/beta", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then(setReport); }, []);
  return <AdminShell><div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
    <header className="mb-8"><p className="text-xs font-bold uppercase tracking-[0.25em] text-[var(--accent)]">Beta lab</p><h1 className="mt-2 text-3xl font-black text-[var(--foreground)]">Student feedback & usage</h1><p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">A 30-day view of what opted-in students spend time with, plus every note sent to Becca. Usage is feature-level and consent-based.</p></header>
    {!report ? <p className="text-sm text-[var(--muted)]">Loading beta insights…</p> : <>
      <section className="mb-8 grid gap-4 sm:grid-cols-3"><Metric label="Feedback notes" value={report.feedback.length} /><Metric label="Opted-in students" value={report.consentedStudents} /><Metric label="Tracked areas" value={report.usage.length} /></section>
      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5"><h2 className="text-lg font-bold text-[var(--foreground)]">What students use most</h2><div className="mt-4 space-y-3">{report.usage.map((row) => <div key={row.area}><div className="flex justify-between text-sm"><span className="font-semibold text-[var(--foreground)]">{row.area}</span><span className="text-[var(--muted)]">{Math.round(row.seconds / 60)} min · {row.events} events</span></div><div className="mt-1 h-2 rounded-full bg-[var(--surface-alt)]"><div className="h-2 rounded-full bg-[var(--accent)]" style={{ width: `${Math.max(5, Math.min(100, row.seconds / Math.max(1, report.usage[0]?.seconds ?? 1) * 100))}%` }} /></div></div>)}{!report.usage.length && <p className="text-sm text-[var(--muted)]">No opted-in usage yet.</p>}</div></section>
        <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5"><h2 className="text-lg font-bold text-[var(--foreground)]">Repeated patterns</h2><div className="mt-4 space-y-2">{report.patterns.map((row) => <div key={`${row.area}-${row.action}`} className="flex items-center justify-between rounded-2xl bg-[var(--surface-alt)] px-3 py-3 text-sm"><span className="text-[var(--foreground)]">{row.action} · {row.area}</span><strong className="text-[var(--accent)]">{row.events}</strong></div>)}</div></section>
      </div>
      <section className="mt-6 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5"><h2 className="text-lg font-bold text-[var(--foreground)]">Becca’s inbox</h2><div className="mt-4 divide-y divide-[var(--border)]">{report.feedback.map((item) => <article key={item.id} className="py-4 first:pt-0"><div className="flex flex-wrap justify-between gap-2 text-xs text-[var(--muted)]"><span className="font-bold uppercase tracking-wider text-[var(--accent)]">{item.kind}</span><span>{item.user.name || item.user.email} · {new Date(item.createdAt).toLocaleDateString()}</span></div><p className="mt-2 whitespace-pre-wrap text-sm text-[var(--foreground)]">{item.message}</p><p className="mt-1 text-xs text-[var(--muted)]">Seen on {item.path || "the portal"}</p></article>)}{!report.feedback.length && <p className="text-sm text-[var(--muted)]">No feedback yet.</p>}</div></section>
    </>}
  </div></AdminShell>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5"><p className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">{label}</p><p className="mt-2 text-3xl font-black text-[var(--foreground)]">{value}</p></div>; }
