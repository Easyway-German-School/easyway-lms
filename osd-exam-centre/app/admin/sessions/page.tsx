"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const MODULES = ["reading", "listening", "writing", "speaking"] as const;

type Session = {
  id: string;
  level: string;
  title: string;
  venueName: string;
  venueAddress: string;
  startDate: string;
  endDate: string;
  registrationDeadline: string;
  capacity: number;
  examFormat: string;
  feeWholeExam: number;
  published: boolean;
  modulePrices: { module: string; price: number }[];
  _count: { bookings: number };
};

const emptyForm = {
  level: "B2", title: "", venueName: "Easyway German Language School, Ikeja", venueAddress: "",
  startDate: "", endDate: "", registrationDeadline: "", capacity: "50", examFormat: "paper", feeWholeExam: "",
  modulePrices: { reading: "", listening: "", writing: "", speaking: "" } as Record<string, string>,
};

export default function AdminSessionsPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/sessions", { cache: "no-store" });
      if (res.status === 401) { router.push("/admin/login"); return; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Unable to load sittings");
      setSessions(data.sessions ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load sittings");
    } finally {
      setLoaded(true);
    }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  function startCreate() {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(true);
  }

  function startEdit(s: Session) {
    setForm({
      level: s.level,
      title: s.title,
      venueName: s.venueName,
      venueAddress: s.venueAddress,
      startDate: s.startDate.slice(0, 10),
      endDate: s.endDate.slice(0, 10),
      registrationDeadline: s.registrationDeadline.slice(0, 10),
      capacity: String(s.capacity),
      examFormat: s.examFormat,
      feeWholeExam: String(s.feeWholeExam),
      modulePrices: {
        reading: "", listening: "", writing: "", speaking: "",
        ...Object.fromEntries(s.modulePrices.map((m) => [m.module, String(m.price)])),
      },
    });
    setEditingId(s.id);
    setShowForm(true);
  }

  async function saveSession() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/sessions", {
        method: editingId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(editingId ? { ...form, sessionId: editingId } : form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Could not ${editingId ? "update" : "create"} that sitting`);
      setForm(emptyForm);
      setShowForm(false);
      setEditingId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not ${editingId ? "update" : "create"} that sitting`);
    } finally {
      setBusy(false);
    }
  }

  async function togglePublished(sessionId: string, published: boolean) {
    await fetch("/api/admin/sessions", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, published }),
    });
    await load();
  }

  if (!loaded) return <div className="p-8 text-sm text-[var(--ink-soft)]">Loading…</div>;

  return (
    <div className="min-h-screen bg-[var(--paper)] p-6">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between">
          <h1 className="font-serif-display text-2xl font-semibold text-[var(--navy)]">Sittings</h1>
          <div className="flex gap-3">
            <Link href="/admin" className="rounded-sm border border-[var(--line)] px-4 py-2 text-sm font-semibold text-[var(--navy)]">← Bookings</Link>
            <button
              onClick={() => { if (showForm) { setShowForm(false); setEditingId(null); } else { startCreate(); } }}
              className="rounded-sm bg-[var(--navy)] px-4 py-2 text-sm font-semibold text-white"
            >
              {showForm ? "Cancel" : "New sitting"}
            </button>
          </div>
        </div>

        {error && !showForm && <p className="mt-4 rounded-sm bg-[var(--red-soft)] px-4 py-3 text-sm text-[var(--red)]">{error}</p>}

        {showForm && (
          <div className="mt-6 seal-border rounded-sm bg-white p-6">
            {error && <p className="mb-4 rounded-sm bg-[var(--red-soft)] px-3 py-2 text-xs text-[var(--red)]">{error}</p>}
            <div className="grid gap-4 sm:grid-cols-2">
              <F label="Level" value={form.level} onChange={(v) => setForm({ ...form, level: v })} />
              <F label="Title" value={form.title} onChange={(v) => setForm({ ...form, title: v })} placeholder="ÖSD Zertifikat B2" />
              <F label="Venue name" value={form.venueName} onChange={(v) => setForm({ ...form, venueName: v })} />
              <F label="Venue address" value={form.venueAddress} onChange={(v) => setForm({ ...form, venueAddress: v })} />
              <F label="Start date" type="date" value={form.startDate} onChange={(v) => setForm({ ...form, startDate: v })} />
              <F label="End date" type="date" value={form.endDate} onChange={(v) => setForm({ ...form, endDate: v })} />
              <F label="Registration deadline" type="date" value={form.registrationDeadline} onChange={(v) => setForm({ ...form, registrationDeadline: v })} />
              <F label="Capacity (seats)" type="number" value={form.capacity} onChange={(v) => setForm({ ...form, capacity: v })} />
              <F label="Whole-exam fee (₦)" type="number" value={form.feeWholeExam} onChange={(v) => setForm({ ...form, feeWholeExam: v })} />
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">Format</span>
                <select
                  value={form.examFormat}
                  onChange={(e) => setForm({ ...form, examFormat: e.target.value })}
                  className="mt-1 w-full rounded-sm border border-[var(--line)] px-3 py-2 text-sm focus:border-[var(--navy)] focus:outline-none"
                >
                  <option value="paper">Paper</option>
                  <option value="computer">Computer</option>
                </select>
              </label>
            </div>
            <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">Individual module prices (optional)</p>
            <div className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {MODULES.map((m) => (
                <F key={m} label={m} type="number" value={form.modulePrices[m]} onChange={(v) => setForm({ ...form, modulePrices: { ...form.modulePrices, [m]: v } })} />
              ))}
            </div>
            <button onClick={saveSession} disabled={busy} className="mt-5 rounded-sm bg-[var(--gold)] px-6 py-2.5 text-sm font-semibold text-[var(--navy-deep)] disabled:opacity-40">
              {busy ? "Saving…" : editingId ? "Save changes" : "Create sitting (unpublished)"}
            </button>
          </div>
        )}

        <div className="mt-6 space-y-3">
          {sessions.map((s) => (
            <div key={s.id} className="seal-border flex items-center justify-between rounded-sm bg-white p-4">
              <div>
                <p className="font-semibold text-[var(--navy)]">{s.title}</p>
                <p className="text-xs text-[var(--ink-soft)]">
                  {new Date(s.startDate).toLocaleDateString()} · {s.venueName} · {s.examFormat} · {s._count.bookings} booked / {s.capacity} seats · ₦{s.feeWholeExam.toLocaleString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`/api/admin/sessions/${s.id}/roster`}
                  className="rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-soft)] hover:border-[var(--navy)] hover:text-[var(--navy)]"
                >
                  Roster
                </a>
                <button
                  onClick={() => startEdit(s)}
                  className="rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-soft)] hover:border-[var(--navy)] hover:text-[var(--navy)]"
                >
                  Edit
                </button>
                <button
                  onClick={() => togglePublished(s.id, !s.published)}
                  className={`rounded-sm px-3 py-1.5 text-xs font-bold uppercase ${s.published ? "bg-[var(--green-soft)] text-[var(--green)]" : "border border-[var(--line)] text-[var(--ink-soft)]"}`}
                >
                  {s.published ? "Published" : "Draft"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function F({ label, value, onChange, type = "text", placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-sm border border-[var(--line)] px-3 py-2 text-sm focus:border-[var(--navy)] focus:outline-none"
      />
    </label>
  );
}
