"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import { ArrowLeftIcon, TrashIcon } from "@/components/icons";

/**
 * Dates the private-class series generator skips instead of booking over.
 * Feeds `generateOccurrences()` in src/lib/private-class-series.ts — nothing
 * here is read by anything else, so an empty list just means the generator
 * never skips a date, exactly like before this existed.
 */

type Holiday = { id: string; date: string; label: string; branchId: string | null; branchName: string | null };
type Branch = { id: string; name: string };

export default function AdminHolidaysPage() {
  const router = useRouter();
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [date, setDate] = useState("");
  const [label, setLabel] = useState("");
  const [branchId, setBranchId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [holidaysRes, branchesRes] = await Promise.all([
        fetch("/api/admin/holidays", { cache: "no-store" }),
        fetch("/api/branches", { cache: "no-store" }),
      ]);
      const holidaysData = await holidaysRes.json();
      if (!holidaysRes.ok) throw new Error(holidaysData.error ?? "Unable to load holidays");
      setHolidays(holidaysData.holidays ?? []);
      if (branchesRes.ok) setBranches(((await branchesRes.json()).branches ?? []).filter((b: Branch) => b.id));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load holidays");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function add() {
    if (!date || !label.trim()) return;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/holidays", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date, label: label.trim(), branchId: branchId || undefined }),
      });
      if (!response.ok) throw new Error((await response.json()).error ?? "Could not add this holiday");
      setDate("");
      setLabel("");
      setBranchId("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add this holiday");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/admin/holidays?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell>
      <main className="p-8">
        <button type="button" onClick={() => router.push("/admin/schedule")} className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--muted)] hover:text-[var(--foreground)]">
          <ArrowLeftIcon className="h-4 w-4" /> All schedules
        </button>

        <p className="text-xs font-bold uppercase tracking-[0.25em] text-[var(--accent)]">School calendar</p>
        <h1 className="mt-2 text-3xl font-bold">Holidays</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          A date here is a date recurring private classes skip automatically instead of booking over. It does not
          touch anything already on a student's calendar — only future occurrences a series would otherwise create.
        </p>

        {error && <p className="mt-4 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-600">{error}</p>}

        <div className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <label>
            <span className="block text-xs font-medium text-[var(--foreground-soft)]">Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm" />
          </label>
          <label className="min-w-[12rem] flex-1">
            <span className="block text-xs font-medium text-[var(--foreground-soft)]">Label</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Public holiday" className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm" />
          </label>
          <label>
            <span className="block text-xs font-medium text-[var(--foreground-soft)]">Branch</span>
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="mt-1 rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm">
              <option value="">Every branch</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => void add()} disabled={busy || !date || !label.trim()} className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">
            Add
          </button>
        </div>

        <div className="mt-6 space-y-2">
          {loading ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">Loading…</p>
          ) : holidays.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">No upcoming holidays on file.</p>
          ) : (
            holidays.map((h) => (
              <div key={h.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div>
                  <p className="text-sm font-semibold">{new Date(h.date).toLocaleDateString(undefined, { dateStyle: "medium" })} — {h.label}</p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">{h.branchName ?? "Every branch"}</p>
                </div>
                <button type="button" onClick={() => void remove(h.id)} disabled={busy} aria-label={`Remove ${h.label}`} className="rounded-lg p-2 text-rose-600 hover:bg-rose-500/10 disabled:opacity-50">
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </main>
    </AdminShell>
  );
}
