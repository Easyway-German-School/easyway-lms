"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { LEVELS } from "@/lib/levels";

/**
 * Bulk email composer and queue dashboard.
 *
 * Sending to a few hundred people cannot be undone, so Send stays disabled
 * until the audience has actually been previewed.
 */

type Recipient = { name: string | null; email: string; level: string; studentCode: string | null };
type Message = {
  id: string; to: string; subject: string; type: string; status: string;
  attempts: number; lastError: string | null; sentAt: string | null; createdAt: string;
};
type Suppression = { id: string; email: string; reason: string; createdAt: string };

const STATUS_TONE: Record<string, string> = {
  sent: "bg-emerald-100 text-emerald-700",
  queued: "bg-slate-100 text-slate-700",
  sending: "bg-blue-100 text-blue-700",
  failed: "bg-red-100 text-red-700",
  suppressed: "bg-amber-100 text-amber-700",
  // Deliberately held back rather than failed — see the queue's "cancelled"
  // status. Grey, because nothing went wrong and nobody needs to act.
  cancelled: "bg-slate-100 text-slate-500",
};

export default function AdminEmailComposePage() {
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [branchId, setBranchId] = useState("");
  const [level, setLevel] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("all");
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);

  const [preview, setPreview] = useState<{ count: number; sample: Recipient[] } | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [recent, setRecent] = useState<Message[]>([]);
  const [suppressions, setSuppressions] = useState<Suppression[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const [dash, br] = await Promise.all([
        fetch("/api/admin/emails/bulk", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/branches", { cache: "no-store" }).then((r) => r.json()),
      ]);
      if (dash.error) throw new Error(dash.error);
      setCounts(dash.counts ?? {});
      setRecent(dash.recent ?? []);
      setSuppressions(dash.suppressions ?? []);
      setBranches(br.branches ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const audience = { branchId: branchId || null, level: level || null, paymentStatus };

  async function runPreview() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/emails/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ audience, preview: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Preview failed");
      setPreview(data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!preview) return;
    if (!confirm(`Queue this email to ${preview.count} recipient${preview.count === 1 ? "" : "s"}?`)) return;

    setBusy(true);
    try {
      const res = await fetch("/api/admin/emails/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject, html, audience }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Send failed");

      setNotice(`Queued ${data.queued}. Suppressed ${data.suppressed}. Duplicates skipped ${data.duplicate}.`);
      setSubject(""); setHtml(""); setPreview(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  async function drain() {
    setBusy(true);
    try {
      const res = await fetch("/api/cron/email-queue?limit=50", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Drain failed");
      setNotice(
        data.skipped && !data.processed
          ? `Nothing sent — email is not configured yet. ${data.skipped} message(s) still waiting.`
          : `Processed ${data.processed}: ${data.sent} sent, ${data.retrying} retrying, ${data.failed} failed.`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Drain failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell>
      <div className="p-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">Compose email</h1>
            <p className="mt-1 text-sm text-slate-500">
              Everything is queued and delivered by the worker, never sent inline.
            </p>
          </div>
          <button onClick={drain} disabled={busy} className="rounded-full border px-4 py-2 text-sm font-semibold disabled:opacity-60">
            Send queued now
          </button>
        </div>

        {error && <div className="mb-4 rounded bg-red-100 p-4 text-red-700">{error}</div>}
        {notice && <div className="mb-4 rounded bg-blue-50 p-4 text-blue-800">{notice}</div>}

        <div className="mb-6 grid gap-3 sm:grid-cols-5">
          {["queued", "sent", "failed", "suppressed", "sending"].map((k) => (
            <div key={k} className="rounded-xl border bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">{k}</p>
              <p className="mt-1 text-2xl font-bold">{counts[k] ?? 0}</p>
            </div>
          ))}
        </div>

        <div className="rounded-xl border bg-white p-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <select value={branchId} onChange={(e) => { setBranchId(e.target.value); setPreview(null); }} className="rounded-lg border px-3 py-2 text-sm">
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select value={level} onChange={(e) => { setLevel(e.target.value); setPreview(null); }} className="rounded-lg border px-3 py-2 text-sm">
              <option value="">All levels</option>
              {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <select value={paymentStatus} onChange={(e) => { setPaymentStatus(e.target.value); setPreview(null); }} className="rounded-lg border px-3 py-2 text-sm">
              <option value="all">Everyone</option>
              <option value="unpaid">Outstanding balance</option>
              <option value="paid">Fully paid</option>
            </select>
          </div>

          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="mt-3 w-full rounded-lg border px-3 py-2 text-sm"
          />
          <textarea
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            rows={8}
            placeholder="Message — HTML is allowed. Use {{name}} and {{level}} to personalise."
            className="mt-3 w-full rounded-lg border px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-slate-500">
            An unsubscribe footer is added automatically — bulk mail without one gets filtered as spam.
          </p>

          <div className="mt-4 flex flex-wrap gap-3">
            <button onClick={runPreview} disabled={busy} className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-60">
              Preview audience
            </button>
            <button
              onClick={send}
              disabled={busy || !preview || !subject.trim() || !html.trim()}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {preview ? `Queue to ${preview.count}` : "Preview first"}
            </button>
          </div>

          {preview && (
            <div className="mt-4 rounded-lg bg-slate-50 p-4">
              <p className="text-sm font-semibold">{preview.count} recipient{preview.count === 1 ? "" : "s"}</p>
              <div className="mt-2 max-h-40 overflow-y-auto text-xs text-slate-600">
                {preview.sample.map((r) => (
                  <div key={r.email}>{r.name} · {r.email} · {r.level}</div>
                ))}
                {preview.count > preview.sample.length && (
                  <p className="mt-1 italic">…and {preview.count - preview.sample.length} more</p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <div className="overflow-hidden rounded-xl border bg-white">
            <div className="border-b px-4 py-3"><h2 className="font-semibold">Recent messages</h2></div>
            <div className="max-h-96 overflow-y-auto">
              {recent.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">Nothing queued yet.</p>
              ) : recent.map((m) => (
                <div key={m.id} className="flex items-start justify-between gap-3 border-b px-4 py-3 last:border-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{m.subject}</p>
                    <p className="text-xs text-slate-500">{m.to} · {m.type}</p>
                    {m.lastError && <p className="mt-0.5 text-xs text-red-600">{m.lastError}</p>}
                  </div>
                  <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_TONE[m.status] ?? ""}`}>
                    {m.status}{m.attempts > 1 ? ` x${m.attempts}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border bg-white">
            <div className="border-b px-4 py-3">
              <h2 className="font-semibold">Suppressed</h2>
              <p className="text-xs text-slate-500">Never emailed again</p>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {suppressions.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">Nobody suppressed.</p>
              ) : suppressions.map((s) => (
                <div key={s.id} className="border-b px-4 py-3 last:border-0">
                  <p className="truncate text-sm">{s.email}</p>
                  <p className="text-xs text-slate-500">{s.reason}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
