"use client";

import { useState } from "react";

type Details = {
  fullName: string;
  phone: string;
  addressLine: string;
  city: string;
  country: string;
  dateOfBirth: string; // ISO
  placeOfBirth: string;
  countryOfBirth: string;
  nationality: string;
  idType: string;
  idNumber: string;
  idExpiry: string; // ISO
};

/**
 * A candidate correcting their own typo before paying — see
 * lib/booking.ts updateBookingDetails for why this only exists while
 * unpaid. Kept separate from the main booking page so that file doesn't
 * grow another dozen pieces of state for something most bookings never use.
 */
export default function EditBookingDetails({
  referenceCode,
  email,
  initial,
  onSaved,
}: {
  referenceCode: string;
  email: string;
  initial: Details;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...initial, dateOfBirth: initial.dateOfBirth.slice(0, 10), idExpiry: initial.idExpiry.slice(0, 10) });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/bookings/${referenceCode}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, ...form }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save those changes");
      setOpen(false);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save those changes");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-2 text-xs font-semibold text-[var(--navy)] underline underline-offset-4">
        Spotted a typo in your details? Fix it before paying
      </button>
    );
  }

  return (
    <div className="mt-2 seal-border rounded-lg bg-[var(--paper-raised)] p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-soft)]">Edit your details</p>
      <p className="mt-1 text-[11px] text-[var(--red)]">
        Make sure your name matches your passport exactly — this prints on your certificate.
      </p>
      {error && <p className="mt-2 text-xs text-[var(--red)]">{error}</p>}
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <I label="Full name" value={form.fullName} onChange={(v) => setForm({ ...form, fullName: v })} full />
        <I label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
        <I label="Date of birth" type="date" value={form.dateOfBirth} onChange={(v) => setForm({ ...form, dateOfBirth: v })} />
        <I label="Address" value={form.addressLine} onChange={(v) => setForm({ ...form, addressLine: v })} full />
        <I label="City" value={form.city} onChange={(v) => setForm({ ...form, city: v })} />
        <I label="Country" value={form.country} onChange={(v) => setForm({ ...form, country: v })} />
        <I label="Place of birth" value={form.placeOfBirth} onChange={(v) => setForm({ ...form, placeOfBirth: v })} />
        <I label="Country of birth" value={form.countryOfBirth} onChange={(v) => setForm({ ...form, countryOfBirth: v })} />
        <I label="Nationality" value={form.nationality} onChange={(v) => setForm({ ...form, nationality: v })} />
        <I label="ID type" value={form.idType} onChange={(v) => setForm({ ...form, idType: v })} />
        <I label="ID number" value={form.idNumber} onChange={(v) => setForm({ ...form, idNumber: v })} />
        <I label="ID expiry date" type="date" value={form.idExpiry} onChange={(v) => setForm({ ...form, idExpiry: v })} full />
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={save} disabled={saving} className="rounded-lg bg-[var(--navy)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button onClick={() => setOpen(false)} className="rounded-lg border border-[var(--line)] px-4 py-2 text-xs font-semibold text-[var(--ink-soft)]">
          Cancel
        </button>
      </div>
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
        className="mt-0.5 w-full rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs focus:border-[var(--navy)] focus:outline-none"
      />
    </label>
  );
}
