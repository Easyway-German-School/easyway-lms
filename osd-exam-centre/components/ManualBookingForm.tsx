"use client";

import { useEffect, useState } from "react";

const MODULES = ["reading", "listening", "writing", "speaking"] as const;

type SessionOption = { id: string; title: string; startDate: string };

/**
 * The office booking a phone/walk-in candidate. Deliberately minimal next to
 * the public wizard — no rules step, no consent checkbox (there was no
 * online form to consent through; see lib/booking.ts createManualBooking),
 * and it marks the booking paid + seated immediately, since the office is
 * also the one confirming payment was received.
 */
export default function ManualBookingForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [form, setForm] = useState({
    sessionId: "", fullName: "", email: "", phone: "", addressLine: "", city: "", country: "Nigeria",
    dateOfBirth: "", placeOfBirth: "", countryOfBirth: "", nationality: "",
    idType: "", idNumber: "", idExpiry: "",
  });
  const [modules, setModules] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ referenceCode: string; feeTotal: number } | null>(null);

  useEffect(() => {
    if (!open || sessions.length) return;
    fetch("/api/admin/sessions", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setSessions((d.sessions ?? []).filter((s: { published: boolean }) => s.published)))
      .catch(() => {});
  }, [open, sessions.length]);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/bookings/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, modules: modules.size ? Array.from(modules) : ["full"] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create that booking");
      setResult({ referenceCode: data.referenceCode, feeTotal: data.feeTotal });
      setForm({
        sessionId: "", fullName: "", email: "", phone: "", addressLine: "", city: "", country: "Nigeria",
        dateOfBirth: "", placeOfBirth: "", countryOfBirth: "", nationality: "", idType: "", idNumber: "", idExpiry: "",
      });
      setModules(new Set());
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create that booking");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="rounded-sm border border-[var(--line)] px-4 py-2 text-sm font-semibold text-[var(--navy)]">
        Walk-in booking (already paid)
      </button>
    );
  }

  return (
    <div className="mt-4 seal-border rounded-sm bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-soft)]">Add a phone / walk-in booking</p>
        <button onClick={() => { setOpen(false); setResult(null); }} className="text-xs font-semibold text-[var(--ink-soft)]">Close</button>
      </div>

      {result && (
        <p className="mt-2 rounded-sm bg-[var(--green-soft)] p-2 text-xs font-semibold text-[var(--green)]">
          Booked and seated — {result.referenceCode} (₦{result.feeTotal.toLocaleString()}).
        </p>
      )}
      {error && <p className="mt-2 text-xs text-[var(--red)]">{error}</p>}

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <select
          value={form.sessionId}
          onChange={(e) => setForm({ ...form, sessionId: e.target.value })}
          className="rounded-sm border border-[var(--line)] px-3 py-2 text-xs sm:col-span-2"
        >
          <option value="">Choose a sitting…</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>{s.title} — {new Date(s.startDate).toLocaleDateString()}</option>
          ))}
        </select>
        <I label="Full name (as on passport)" value={form.fullName} onChange={(v) => setForm({ ...form, fullName: v })} full />
        <I label="Email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
        <I label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
        <I label="Address" value={form.addressLine} onChange={(v) => setForm({ ...form, addressLine: v })} />
        <I label="City" value={form.city} onChange={(v) => setForm({ ...form, city: v })} />
        <I label="Country" value={form.country} onChange={(v) => setForm({ ...form, country: v })} />
        <I label="Date of birth" type="date" value={form.dateOfBirth} onChange={(v) => setForm({ ...form, dateOfBirth: v })} />
        <I label="Place of birth" value={form.placeOfBirth} onChange={(v) => setForm({ ...form, placeOfBirth: v })} />
        <I label="Country of birth" value={form.countryOfBirth} onChange={(v) => setForm({ ...form, countryOfBirth: v })} />
        <I label="Nationality" value={form.nationality} onChange={(v) => setForm({ ...form, nationality: v })} />
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-soft)]">ID type</span>
          <select
            value={form.idType}
            onChange={(e) => setForm({ ...form, idType: e.target.value })}
            className="mt-0.5 w-full rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs focus:border-[var(--navy)] focus:outline-none"
          >
            <option value="">Select…</option>
            <option value="International Passport">International Passport</option>
            <option value="National ID Card (NIN)">National ID Card (NIN)</option>
            <option value="Driver's License">Driver's License</option>
            <option value="Other">Other</option>
          </select>
        </label>
        <I label="ID number" value={form.idNumber} onChange={(v) => setForm({ ...form, idNumber: v })} />
        <I label="ID expiry date" type="date" value={form.idExpiry} onChange={(v) => setForm({ ...form, idExpiry: v })} />
      </div>

      <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-soft)]">
        Modules (leave all unchecked for the whole exam)
      </p>
      <div className="mt-1 flex flex-wrap gap-3">
        {MODULES.map((m) => (
          <label key={m} className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={modules.has(m)}
              onChange={() => setModules((prev) => { const next = new Set(prev); next.has(m) ? next.delete(m) : next.add(m); return next; })}
            />
            {m}
          </label>
        ))}
      </div>

      <button
        onClick={submit}
        disabled={
          busy || !form.sessionId || !form.fullName || !form.email ||
          !form.countryOfBirth || !form.nationality || !form.idType || !form.idNumber || !form.idExpiry
        }
        className="mt-3 rounded-sm bg-[var(--navy)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
      >
        {busy ? "Booking…" : "Book & mark paid"}
      </button>
    </div>
  );
}

function I({ label, value, onChange, type = "text", full }: { label: string; value: string; onChange: (v: string) => void; type?: string; full?: boolean }) {
  return (
    <label className={`block ${full ? "sm:col-span-2" : ""}`}>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-soft)]">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs focus:border-[var(--navy)] focus:outline-none"
      />
    </label>
  );
}
