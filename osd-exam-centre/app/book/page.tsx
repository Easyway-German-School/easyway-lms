"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SiteFooter } from "@/components/SiteChrome";
import PageHero from "@/components/PageHero";
import vienna from "@/assets/images/vienna.jpg";

type ModulePrice = { module: string; price: number };
type Session = {
  id: string;
  level: string;
  title: string;
  venueName: string;
  venueAddress: string;
  startDate: string;
  endDate: string;
  feeWholeExam: number;
  modulePrices: ModulePrice[];
  remaining: number;
  capacity: number;
};

const MODULE_LABEL: Record<string, string> = {
  reading: "Reading",
  listening: "Listening",
  writing: "Writing",
  speaking: "Speaking",
};

const STEP_TITLES = ["Choose sitting", "Your details", "Modules & fee", "Review"];

export default function BookPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [sessionId, setSessionId] = useState("");
  const [selection, setSelection] = useState<"full" | "custom">("full");
  const [modules, setModules] = useState<Set<string>>(new Set());

  const [form, setForm] = useState({
    fullName: "", email: "", phone: "", addressLine: "", city: "", country: "Nigeria",
    dateOfBirth: "", placeOfBirth: "", countryOfBirth: "", nationality: "", gender: "",
    idType: "", idNumber: "", idExpiry: "", specialNeeds: "",
  });
  const [isRepeatAttempt, setIsRepeatAttempt] = useState(false);
  const [ack, setAck] = useState(false);
  const [consent, setConsent] = useState(false);
  // Honeypot — invisible to a real candidate (off-screen, unreachable by
  // tab), filled only by a bot that fills every field it finds in the DOM.
  const [website, setWebsite] = useState("");

  useEffect(() => {
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((d) => setSessions(d.sessions ?? []))
      .catch(() => setSessions([]))
      .finally(() => setLoaded(true));
  }, []);

  const session = useMemo(() => sessions.find((s) => s.id === sessionId) ?? null, [sessions, sessionId]);

  const feeTotal = useMemo(() => {
    if (!session) return 0;
    if (selection === "full") return session.feeWholeExam;
    const priceByModule = new Map(session.modulePrices.map((m) => [m.module, m.price]));
    let total = 0;
    for (const m of modules) total += priceByModule.get(m) ?? 0;
    return total;
  }, [session, selection, modules]);

  function toggleModule(m: string) {
    setModules((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
  }

  function canAdvance(): boolean {
    if (step === 0) return Boolean(sessionId) && (session?.remaining ?? 0) > 0;
    if (step === 1) {
      return Boolean(
        form.fullName.trim() && form.email.trim() && form.phone.trim() &&
        form.addressLine.trim() && form.city.trim() && form.dateOfBirth && form.placeOfBirth.trim() &&
        form.countryOfBirth.trim() && form.nationality.trim() &&
        form.idType.trim() && form.idNumber.trim() && form.idExpiry,
      );
    }
    if (step === 2) return selection === "full" || modules.size > 0;
    return ack && consent;
  }

  async function submit() {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId,
          ...form,
          isRepeatAttempt,
          modules: selection === "full" ? ["full"] : Array.from(modules),
          consentAccepted: consent,
          website,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not complete that booking");
      router.push(`/booking/${data.referenceCode}?email=${encodeURIComponent(form.email)}&justBooked=1`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not complete that booking");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen">
      <PageHero
        eyebrow="Registration"
        title="Register for your exam"
        subtitle="Four short steps. Your seat is reserved automatically the moment your payment is confirmed."
        image={vienna}
        alt="Vienna's skyline reflected in still water at sunset"
        position="object-[40%_50%]"
      />
      <main className="relative z-10 mx-auto -mt-16 max-w-2xl px-5 pb-20 sm:px-6">
        <div className="rounded-2xl bg-white px-5 py-4 shadow-xl shadow-[var(--navy)]/15 ring-1 ring-black/5">
          <div className="hidden items-center gap-2 sm:flex">
            {STEP_TITLES.map((title, i) => (
              <div key={title} className="flex flex-1 items-center gap-2">
                <span className="step-dot" data-active={i === step} data-done={i < step} />
                <span className={`text-xs font-medium ${i === step ? "text-[var(--navy)]" : "text-[var(--ink-soft)]"}`}>{title}</span>
                {i < STEP_TITLES.length - 1 && <span className="h-px flex-1 bg-[var(--line)]" />}
              </div>
            ))}
          </div>
          <p className="text-xs font-semibold text-[var(--navy)] sm:hidden">
            Step {step + 1} of {STEP_TITLES.length} · {STEP_TITLES[step]}
          </p>
        </div>

        {error &&<p className="mt-6 rounded-lg bg-[var(--red-soft)] px-4 py-3 text-sm text-[var(--red)]">{error}</p>}

        {/* Honeypot: real candidates never see this field. */}
        <input
          type="text"
          name="website"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
        />

        <div className="mt-8 seal-border rounded-lg bg-[var(--paper-raised)] p-6">
          {step === 0 && (
            <div className="space-y-3">
              {!loaded ? (
                <p className="text-sm text-[var(--ink-soft)]">Loading sittings…</p>
              ) : sessions.length === 0 ? (
                <p className="text-sm text-[var(--ink-soft)]">No sittings are open for registration right now — check back soon.</p>
              ) : (
                sessions.map((s) => (
                  <label
                    key={s.id}
                    className={`block cursor-pointer rounded-lg border p-4 ${sessionId === s.id ? "border-[var(--gold)] bg-[var(--gold-soft)]/30" : "border-[var(--line)]"}`}
                  >
                    <input type="radio" name="session" className="sr-only" checked={sessionId === s.id} onChange={() => setSessionId(s.id)} />
                    <p className="font-semibold text-[var(--navy)]">{s.title}</p>
                    <p className="mt-1 text-sm text-[var(--ink-soft)]">
                      {s.venueName} · {new Date(s.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
                      {new Date(s.endDate).toDateString() !== new Date(s.startDate).toDateString() && ` –${new Date(s.endDate).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}`}
                    </p>
                    <p className="mt-1 text-xs text-[var(--ink-soft)]">
                      {s.remaining > 0 ? `${s.remaining} of ${s.capacity} seats left` : "Full"} · from ₦{s.feeWholeExam.toLocaleString()}
                    </p>
                  </label>
                ))
              )}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <p className="text-xs text-[var(--red)]">
                Enter your name exactly as it appears on your international passport — this is what will print on your certificate.
              </p>
              <Field label="Full name (as on passport)" value={form.fullName} onChange={(v) => setForm({ ...form, fullName: v })} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
                <Field label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
              </div>
              <Field label="Address" value={form.addressLine} onChange={(v) => setForm({ ...form, addressLine: v })} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="City" value={form.city} onChange={(v) => setForm({ ...form, city: v })} />
                <Field label="Country" value={form.country} onChange={(v) => setForm({ ...form, country: v })} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Date of birth" type="date" value={form.dateOfBirth} onChange={(v) => setForm({ ...form, dateOfBirth: v })} />
                <Field label="Place of birth" value={form.placeOfBirth} onChange={(v) => setForm({ ...form, placeOfBirth: v })} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Country of birth" value={form.countryOfBirth} onChange={(v) => setForm({ ...form, countryOfBirth: v })} />
                <Field label="Nationality" value={form.nationality} onChange={(v) => setForm({ ...form, nationality: v })} />
              </div>
              <Field label="Gender (optional)" value={form.gender} onChange={(v) => setForm({ ...form, gender: v })} />

              <p className="pt-2 text-xs font-bold uppercase tracking-wide text-[var(--ink-soft)]">Identification — bring this document on exam day</p>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">ID type</span>
                <select
                  value={form.idType}
                  onChange={(e) => setForm({ ...form, idType: e.target.value })}
                  className="mt-1.5 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2.5 text-sm text-[var(--ink)] focus:border-[var(--navy)] focus:outline-none"
                >
                  <option value="">Select…</option>
                  <option value="International Passport">International Passport</option>
                  <option value="National ID Card (NIN)">National ID Card (NIN)</option>
                  <option value="Driver's License">Driver's License</option>
                  <option value="Other">Other</option>
                </select>
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="ID number" value={form.idNumber} onChange={(v) => setForm({ ...form, idNumber: v })} />
                <Field label="ID expiry date" type="date" value={form.idExpiry} onChange={(v) => setForm({ ...form, idExpiry: v })} />
              </div>

              <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                <input type="checkbox" checked={isRepeatAttempt} onChange={(e) => setIsRepeatAttempt(e.target.checked)} />
                This is a repeat attempt (I have sat this exam before)
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">Special examination needs (optional)</span>
                <textarea
                  value={form.specialNeeds}
                  onChange={(e) => setForm({ ...form, specialNeeds: e.target.value })}
                  rows={2}
                  placeholder="Leave blank if none. If you require an accommodation, describe it here — the office will follow up."
                  className="mt-1.5 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2.5 text-sm text-[var(--ink)] focus:border-[var(--navy)] focus:outline-none"
                />
              </label>
            </div>
          )}

          {step === 2 && session && (
            <div className="space-y-4">
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setSelection("full")}
                  className={`flex-1 rounded-lg border px-4 py-3 text-sm font-semibold ${selection === "full" ? "border-[var(--gold)] bg-[var(--gold-soft)]/30" : "border-[var(--line)]"}`}
                >
                  Whole exam — ₦{session.feeWholeExam.toLocaleString()}
                </button>
                <button
                  type="button"
                  onClick={() => setSelection("custom")}
                  disabled={session.modulePrices.length === 0}
                  className={`flex-1 rounded-lg border px-4 py-3 text-sm font-semibold disabled:opacity-40 ${selection === "custom" ? "border-[var(--gold)] bg-[var(--gold-soft)]/30" : "border-[var(--line)]"}`}
                >
                  Individual modules
                </button>
              </div>

              {selection === "custom" && (
                <div className="space-y-2">
                  {session.modulePrices.map((m) => (
                    <label key={m.module} className="flex items-center justify-between rounded-lg border border-[var(--line)] px-4 py-2.5">
                      <span className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={modules.has(m.module)} onChange={() => toggleModule(m.module)} />
                        {MODULE_LABEL[m.module] ?? m.module}
                      </span>
                      <span className="text-sm font-semibold text-[var(--navy)]">₦{m.price.toLocaleString()}</span>
                    </label>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between rounded-lg bg-[var(--gold-soft)]/40 px-4 py-3">
                <span className="text-sm font-semibold text-[var(--navy)]">Total</span>
                <span className="font-serif-display text-2xl text-[var(--navy)]">₦{feeTotal.toLocaleString()}</span>
              </div>
            </div>
          )}

          {step === 3 && session && (
            <div className="space-y-4 text-sm">
              <Row label="Sitting" value={`${session.title} · ${session.venueName}`} />
              <Row label="Candidate" value={form.fullName} />
              <Row label="Email" value={form.email} />
              <Row label="Nationality" value={form.nationality} />
              <Row label="ID" value={`${form.idType} · ${form.idNumber}`} />
              {isRepeatAttempt && <Row label="Attempt" value="Repeat attempt" />}
              <Row label="Modules" value={selection === "full" ? "Whole exam" : Array.from(modules).map((m) => MODULE_LABEL[m]).join(", ")} />
              <Row label="Amount due" value={`₦${feeTotal.toLocaleString()}`} strong />

              <div className="rounded-lg bg-[var(--gold-soft)]/30 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-soft)]">Examination rules</p>
                <ul className="mt-2 space-y-1 text-xs text-[var(--ink-soft)]">
                  <li>• Do not arrive late — latecomers may not be admitted.</li>
                  <li>• Bring a normal ballpoint pen. No pencils, no correction fluid.</li>
                  <li>• Bring your passport's data page and your printed admission slip.</li>
                  <li>• Phones and smart watches off and out of reach for the whole exam.</li>
                </ul>
              </div>

              <label className="mt-4 flex items-start gap-3 rounded-lg border border-[var(--line)] p-4">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
                <span className="text-xs text-[var(--ink-soft)]">
                  I have read the examination rules above, and I understand this booking is{" "}
                  <strong>not reversible or refundable</strong> once payment is confirmed, and that I
                  must pay from a commercial bank account, not a wallet app.
                </span>
              </label>

              <label className="flex items-start gap-3 rounded-lg border border-[var(--line)] p-4">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
                <span className="text-xs text-[var(--ink-soft)]">
                  I consent to Easyway German Language School collecting and processing the personal data above —
                  including my passport photograph and data page once uploaded — for the purpose of registering me
                  for this ÖSD examination and issuing my certificate, per the{" "}
                  <a href="/privacy" target="_blank" className="underline">privacy policy</a> and{" "}
                  <a href="/terms" target="_blank" className="underline">terms</a>.
                </span>
              </label>
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-between">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="rounded-lg border border-[var(--line)] px-5 py-2.5 text-sm font-semibold text-[var(--ink-soft)] disabled:opacity-40"
          >
            Back
          </button>
          {step < 3 ? (
            <button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              disabled={!canAdvance()}
              className="rounded-lg bg-[var(--navy)] px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!canAdvance() || submitting}
              className="rounded-lg bg-[var(--gold)] px-6 py-2.5 text-sm font-semibold text-[var(--navy-deep)] disabled:opacity-40"
            >
              {submitting ? "Submitting…" : "Confirm booking"}
            </button>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-soft)]">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2.5 text-sm text-[var(--ink)] focus:border-[var(--navy)] focus:outline-none"
      />
    </label>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--line)] pb-2">
      <span className="text-[var(--ink-soft)]">{label}</span>
      <span className={strong ? "font-serif-display text-lg text-[var(--navy)]" : "font-medium text-[var(--navy)]"}>{value}</span>
    </div>
  );
}
