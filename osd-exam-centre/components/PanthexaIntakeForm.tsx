"use client";

import { useEffect, useMemo, useState } from "react";

type SessionOption = {
  id: string;
  title: string;
  level: string;
  startDate: string;
  feeWholeExam: number;
  expressFee: number;
  modulePrices: { module: string; price: number }[];
};

type Result = { bookingId: string; referenceCode: string; invoiceNumber: string; feeTotal: number; emailSent: boolean; email: string };

const today = () => new Date().toISOString().slice(0, 10);
const blank = () => ({
  sessionId: "", fullName: "", email: "", phone: "", gender: "", dateOfBirth: "", placeOfBirth: "", nationality: "Nigeria",
  registeredOn: today(), panthexaReference: "", specialNeeds: "", isRepeatAttempt: false,
});

/**
 * The one form the desk fills in per Panthexa registration. Everything else —
 * the reference, the invoice number, the invoice PDF, the booking email — is
 * done by the system on submit (lib/panthexa-intake.ts). The fee shown under the
 * form is computed with the same rule the server uses, so what the office sees
 * is what the invoice will say.
 */
export default function PanthexaIntakeForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [form, setForm] = useState(blank());
  const [modules, setModules] = useState<"full" | "written" | "oral">("full");
  const [express, setExpress] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (!open || sessions.length) return;
    fetch("/api/admin/sessions", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setSessions(d.sessions ?? []))
      .catch(() => {});
  }, [open, sessions.length]);

  const session = sessions.find((s) => s.id === form.sessionId);

  const fee = useMemo(() => {
    if (!session) return null;
    const price = (m: string) => session.modulePrices.find((p) => p.module === m)?.price;
    const exam = modules === "full" ? session.feeWholeExam : price(modules);
    if (exam === undefined) return null;
    return exam + (express ? session.expressFee : 0);
  }, [session, modules, express]);

  async function submit() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/admin/panthexa", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, modules: [modules], express }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not register that candidate");
      setResult({ ...data, email: form.email.trim().toLowerCase() });
      setForm({ ...blank(), sessionId: form.sessionId });
      setModules("full");
      setExpress(false);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not register that candidate");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="rounded-sm bg-[var(--navy)] px-4 py-2 text-sm font-semibold text-white">
        + Register a Panthexa candidate
      </button>
    );
  }

  const ready = form.sessionId && form.fullName && form.email && form.phone && form.dateOfBirth && form.placeOfBirth && form.nationality && fee !== null;

  return (
    <div className="seal-border rounded-sm bg-white p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-soft)]">Register a Panthexa candidate</p>
          <p className="mt-0.5 text-[11px] text-[var(--ink-soft)]">
            Copy the details from the Panthexa dashboard. On submit we create the reference, generate the invoice and email it as the booking confirmation.
          </p>
        </div>
        <button onClick={() => { setOpen(false); setResult(null); setError(""); }} className="text-xs font-semibold text-[var(--ink-soft)]">Close</button>
      </div>

      {result && (
        <div className="mt-3 rounded-sm bg-[var(--green-soft)] p-3 text-xs text-[var(--green)]">
          <p className="font-semibold">
            Registered {result.referenceCode} — invoice {result.invoiceNumber} for ₦{result.feeTotal.toLocaleString()}.{" "}
            {result.emailSent ? `Booking email sent to ${result.email}.` : "The email could not be sent just now — it will retry automatically tonight; you can also resend it from the candidate's card."}
          </p>
          <a href={`/api/admin/bookings/${result.bookingId}/invoice`} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block font-semibold underline">
            Preview the invoice PDF
          </a>
        </div>
      )}
      {error && <p className="mt-3 rounded-sm bg-[var(--red-soft)] p-2 text-xs text-[var(--red)]">{error}</p>}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-soft)]">Sitting (level)</span>
          <select
            value={form.sessionId}
            onChange={(e) => setForm({ ...form, sessionId: e.target.value })}
            className="mt-0.5 w-full rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs"
          >
            <option value="">Choose a sitting…</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>{s.title} — {new Date(s.startDate).toLocaleDateString("en-GB")}</option>
            ))}
          </select>
        </label>
        <I label="Full name (as on Panthexa / passport)" value={form.fullName} onChange={(v) => setForm({ ...form, fullName: v })} full />
        <I label="Email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
        <I label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-soft)]">Gender</span>
          <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })} className="mt-0.5 w-full rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs">
            <option value="">—</option>
            <option>Female</option>
            <option>Male</option>
            <option>Other</option>
          </select>
        </label>
        <I label="Date of birth" type="date" value={form.dateOfBirth} onChange={(v) => setForm({ ...form, dateOfBirth: v })} />
        <I label="Place of birth" value={form.placeOfBirth} onChange={(v) => setForm({ ...form, placeOfBirth: v })} />
        <I label="Citizenship" value={form.nationality} onChange={(v) => setForm({ ...form, nationality: v })} />
        <I label="Registered on Panthexa" type="date" value={form.registeredOn} onChange={(v) => setForm({ ...form, registeredOn: v })} />
        <I label="Panthexa reference (optional)" value={form.panthexaReference} onChange={(v) => setForm({ ...form, panthexaReference: v })} />
      </div>

      <p className="mt-4 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-soft)]">Modules</p>
      <div className="mt-1 flex flex-wrap gap-4 text-xs">
        {([["full", "Written + Oral"], ["written", "Written only"], ["oral", "Oral only"]] as const).map(([value, label]) => (
          <label key={value} className="flex items-center gap-1.5">
            <input type="radio" name="panthexa-modules" checked={modules === value} onChange={() => setModules(value)} />
            {label}
          </label>
        ))}
        {session && session.expressFee > 0 && (
          <label className="flex items-center gap-1.5 font-semibold text-[var(--navy)]">
            <input type="checkbox" checked={express} onChange={(e) => setExpress(e.target.checked)} />
            Express result (+₦{session.expressFee.toLocaleString()})
          </label>
        )}
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-[11px] font-semibold text-[var(--ink-soft)]">Repeat attempt / special needs</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={form.isRepeatAttempt} onChange={(e) => setForm({ ...form, isRepeatAttempt: e.target.checked })} />
            Repeat attempt
          </label>
          <I label="Special needs (if declared)" value={form.specialNeeds} onChange={(v) => setForm({ ...form, specialNeeds: v })} />
        </div>
      </details>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button onClick={submit} disabled={busy || !ready} className="rounded-sm bg-[var(--navy)] px-5 py-2 text-xs font-semibold text-white disabled:opacity-40">
          {busy ? "Creating invoice & emailing…" : "Create booking, invoice & email"}
        </button>
        {session && (
          <p className="text-xs text-[var(--ink-soft)]">
            {fee !== null ? <>Invoice total: <strong className="text-[var(--navy)]">₦{fee.toLocaleString()}</strong></> : <span className="text-[var(--red)]">This sitting has no price for that selection — set it under Sittings.</span>}
          </p>
        )}
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
        className="mt-0.5 w-full rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs focus:border-[var(--navy)] focus:outline-none"
      />
    </label>
  );
}
