"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/AdminShell";
import { BroadcastIcon, PlusIcon, SignalIcon } from "@/components/icons";

type Webinar = {
  id: string;
  title: string;
  startAt: string;
  status: string;
  mode: string;
  audience: string;
  landingSlug: string | null;
  live: boolean;
  registrations: number;
};

function when(v: string) {
  return new Date(v).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function WebinarsPage() {
  const [items, setItems] = useState<Webinar[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/work-drive/webinars", { cache: "no-store" });
    const json = await res.json();
    setItems(res.ok ? json.webinars ?? [] : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AdminShell>
      <div className="space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
              <BroadcastIcon className="h-6 w-6" />
            </span>
            <div>
              <h1 className="text-xl font-bold text-[var(--foreground)]">Webinars</h1>
              <p className="text-sm text-[var(--muted)]">Live sessions for staff, students, or the public.</p>
            </div>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white transition hover:brightness-110"
          >
            <PlusIcon className="h-4 w-4" />
            New webinar
          </button>
        </header>

        {loading ? (
          <p className="text-sm text-[var(--muted)]">Loading…</p>
        ) : items.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-10 text-center">
            <p className="text-sm text-[var(--muted)]">No webinars yet.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((w) => (
              <li key={w.id}>
                <Link
                  href={`/admin/webinars/${w.id}`}
                  className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:border-[var(--border-strong)]"
                >
                  {w.live ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                      <SignalIcon className="h-3 w-3" />
                      LIVE
                    </span>
                  ) : (
                    <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs font-medium capitalize text-[var(--muted)]">
                      {w.status}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-[var(--foreground)]">{w.title}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {when(w.startAt)} · {w.audience} · {w.registrations} registered
                    </p>
                  </div>
                  {w.landingSlug && (
                    <span className="text-xs font-semibold text-[var(--accent)]">/w/{w.landingSlug}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {creating && <CreateWebinarModal onClose={() => setCreating(false)} onCreated={(id) => (window.location.href = `/admin/webinars/${id}`)} />}
    </AdminShell>
  );
}

function CreateWebinarModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState("15:00");
  const [audience, setAudience] = useState("staff");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!title.trim()) return;
    setBusy(true);
    setErr(null);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const res = await fetch("/api/admin/work-drive/webinars", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, startAt: `${date}T${time}`, audience, timezone: tz }),
    });
    const json = await res.json();
    if (!res.ok) {
      setErr(json?.error || "Could not create the webinar.");
      setBusy(false);
    } else onCreated(json.webinar.id);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-[var(--foreground)]">New webinar</h2>
        <div className="mt-4 space-y-3">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Open evening: study in Germany"
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
          />
          <div className="flex gap-2">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground)]" />
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground)]" />
          </div>
          <select value={audience} onChange={(e) => setAudience(e.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground)]">
            <option value="staff">Staff only</option>
            <option value="students">Students</option>
            <option value="public">Public (landing page + registration)</option>
          </select>
          {err && <p className="text-sm text-rose-600 dark:text-rose-400">{err}</p>}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-full px-4 py-2 text-sm font-medium text-[var(--muted)] transition hover:bg-[var(--surface-alt)]">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || !title.trim()}
            className="rounded-full bg-[var(--accent)] px-5 py-2 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
