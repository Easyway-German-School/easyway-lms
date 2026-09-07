"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/AdminShell";
import { BroadcastIcon, CheckCircleIcon, SendIcon } from "@/components/icons";
import {
  DEFAULT_EXAM_CAMPAIGN,
  formatMoney,
  type ExamCampaignConfig,
} from "@/lib/exam-campaign";

type Tracker = {
  activeStudents: number;
  registered: number;
  enquired: number;
  notYetRegistered: number;
  recentEnquiries: Array<{ name: string; at: string | null; registered: boolean }>;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function ExamCampaignAdminPage() {
  const [config, setConfig] = useState<ExamCampaignConfig>(DEFAULT_EXAM_CAMPAIGN);
  const [tracker, setTracker] = useState<Tracker | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/exam-campaign", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Could not load the campaign"))))
      .then((data) => {
        setConfig(data.config as ExamCampaignConfig);
        setTracker(data.tracker as Tracker);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const set = useCallback(<K extends keyof ExamCampaignConfig>(key: K, value: ExamCampaignConfig[K]) => {
    setConfig((c) => ({ ...c, [key]: value }));
    setNotice(null);
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/exam-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", config }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save");
      setConfig(data.config as ExamCampaignConfig);
      setTracker(data.tracker as Tracker);
      setNotice("Saved. The popup, the banner and the reminders now use these details.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }, [config]);

  const sendNow = useCallback(async () => {
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/exam-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send-now" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not send");
      const r = data.result;
      setNotice(
        r.created > 0
          ? `Reminder sent to ${r.created} student${r.created === 1 ? "" : "s"} (${r.alreadyRegistered} already registered).`
          : `Nothing sent — ${r.reason ?? "everyone is up to date"}.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send");
    } finally {
      setSending(false);
    }
  }, []);

  const toggleWeekday = (day: number) => {
    const next = config.reminderWeekdays.includes(day)
      ? config.reminderWeekdays.filter((d) => d !== day)
      : [...config.reminderWeekdays, day].sort();
    set("reminderWeekdays", next);
  };

  const registeredPct = useMemo(() => {
    if (!tracker || tracker.activeStudents === 0) return 0;
    return Math.round((tracker.registered / tracker.activeStudents) * 100);
  }, [tracker]);

  return (
    <AdminShell>
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <header className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[var(--accent)]/10 text-[var(--accent)]">
            <BroadcastIcon className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-xl font-bold text-[var(--foreground)]">ÖSD exam campaign</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              The daily student popup, the pinned banner and the 3×/week reminder all read from here.
              Turn it off once the sitting is done.
            </p>
          </div>
        </header>

        {loading ? (
          <p className="mt-8 text-sm text-[var(--muted)]">Loading…</p>
        ) : (
          <div className="mt-6 space-y-6">
            {error ? (
              <p className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-600">{error}</p>
            ) : null}
            {notice ? (
              <p className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700">{notice}</p>
            ) : null}

            {/* -------------------------------------------------- on/off + tracker */}
            <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <label className="flex items-center justify-between gap-4">
                <span>
                  <span className="block text-sm font-semibold text-[var(--foreground)]">Campaign is live</span>
                  <span className="block text-xs text-[var(--muted)]">
                    Off means no popup, no banner, no reminders. The details below are kept.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={config.enabled}
                  onChange={(e) => set("enabled", e.target.checked)}
                  className="h-6 w-11 shrink-0 cursor-pointer appearance-none rounded-full bg-[var(--surface-alt)] transition checked:bg-[var(--accent)] relative before:absolute before:left-0.5 before:top-0.5 before:h-5 before:w-5 before:rounded-full before:bg-white before:transition checked:before:translate-x-5"
                />
              </label>

              {tracker ? (
                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Active students" value={tracker.activeStudents} />
                  <Stat label="Marked registered" value={tracker.registered} accent />
                  <Stat label="Yet to register" value={tracker.notYetRegistered} />
                  <Stat label="Enquired" value={tracker.enquired} />
                  <div className="col-span-2 sm:col-span-4">
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-alt)]">
                      <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${registeredPct}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-[var(--muted)]">{registeredPct}% of active students have marked themselves registered.</p>
                  </div>
                </div>
              ) : null}

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={sendNow}
                  disabled={sending || !config.enabled}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--foreground-soft)] transition hover:bg-[var(--surface-alt)] disabled:opacity-50"
                >
                  <SendIcon className="h-4 w-4" />
                  {sending ? "Sending…" : "Send a reminder now"}
                </button>
                <Link href="/admin/enquiries" className="text-sm font-semibold text-[var(--accent)]">
                  Open enquiries →
                </Link>
              </div>
              {tracker && tracker.recentEnquiries.length > 0 ? (
                <ul className="mt-4 space-y-1 text-xs text-[var(--muted)]">
                  {tracker.recentEnquiries.map((e, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <CheckCircleIcon className={`h-3.5 w-3.5 ${e.registered ? "text-emerald-500" : "text-[var(--border)]"}`} />
                      {e.name}
                      {e.at ? ` · ${new Date(e.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>

            {/* -------------------------------------------------- copy */}
            <Section title="What students read">
              <Field label="Headline">
                <input className={inputClass} value={config.title} onChange={(e) => set("title", e.target.value)} />
              </Field>
              <Field label="One-line tagline">
                <input className={inputClass} value={config.tagline} onChange={(e) => set("tagline", e.target.value)} />
              </Field>
              <Field label="Short blurb (details page + banner)">
                <textarea className={inputClass} rows={3} value={config.blurb} onChange={(e) => set("blurb", e.target.value)} />
              </Field>
              <Field label="Reminder title (bell + push)">
                <input className={inputClass} value={config.reminderTitle} onChange={(e) => set("reminderTitle", e.target.value)} />
              </Field>
              <Field label="Reminder message">
                <textarea className={inputClass} rows={3} value={config.reminderMessage} onChange={(e) => set("reminderMessage", e.target.value)} />
              </Field>
            </Section>

            {/* -------------------------------------------------- dates */}
            <Section title="Dates">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Exam starts"><DateInput value={config.examStart} onChange={(v) => set("examStart", v)} /></Field>
                <Field label="Exam ends"><DateInput value={config.examEnd} onChange={(v) => set("examEnd", v)} /></Field>
                <Field label="Free prep class"><DateInput value={config.prepClassDate} onChange={(v) => set("prepClassDate", v)} /></Field>
                <Field label="Registration deadline"><DateInput value={config.registrationDeadline} onChange={(v) => set("registrationDeadline", v)} /></Field>
                <Field label="Start showing the popup on"><DateInput value={config.startPopupsOn} onChange={(v) => set("startPopupsOn", v)} /></Field>
                <Field label="Prep class venue"><input className={inputClass} value={config.prepClassVenue} onChange={(e) => set("prepClassVenue", e.target.value)} /></Field>
              </div>
              <Field label="Reminder days (3× a week)">
                <div className="flex flex-wrap gap-2">
                  {WEEKDAYS.map((label, day) => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleWeekday(day)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                        config.reminderWeekdays.includes(day)
                          ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                          : "border-[var(--border)] text-[var(--muted)]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Field>
            </Section>

            {/* -------------------------------------------------- fees */}
            <Section title="Fees">
              <div className="space-y-2">
                {config.fees.map((fee, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      className={`${inputClass} w-20`}
                      value={fee.level}
                      onChange={(e) => {
                        const fees = [...config.fees];
                        fees[i] = { ...fee, level: e.target.value };
                        set("fees", fees);
                      }}
                    />
                    <input
                      type="number"
                      className={`${inputClass} w-40`}
                      value={fee.amount}
                      onChange={(e) => {
                        const fees = [...config.fees];
                        fees[i] = { ...fee, amount: Number(e.target.value) };
                        set("fees", fees);
                      }}
                    />
                    <span className="text-xs text-[var(--muted)]">{formatMoney(fee.amount, config.currency)}</span>
                    <button
                      type="button"
                      onClick={() => set("fees", config.fees.filter((_, j) => j !== i))}
                      className="text-xs text-rose-500"
                    >
                      remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => set("fees", [...config.fees, { level: "", amount: 0 }])}
                  className="text-xs font-semibold text-[var(--accent)]"
                >
                  + add a level
                </button>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="Express result fee">
                  <input type="number" className={inputClass} value={config.expressFee} onChange={(e) => set("expressFee", Number(e.target.value))} />
                </Field>
                <Field label="Regular result wait">
                  <input className={inputClass} value={config.regularResultText} onChange={(e) => set("regularResultText", e.target.value)} />
                </Field>
                <Field label="Express result wait">
                  <input className={inputClass} value={config.expressResultText} onChange={(e) => set("expressResultText", e.target.value)} />
                </Field>
              </div>
            </Section>

            {/* -------------------------------------------------- venues + links */}
            <Section title="Venues & links">
              <div className="space-y-2">
                {config.venues.map((v, i) => (
                  <div key={i} className="grid gap-2 sm:grid-cols-[10rem_1fr_auto]">
                    <input className={inputClass} value={v.name} placeholder="Name" onChange={(e) => {
                      const venues = [...config.venues];
                      venues[i] = { ...v, name: e.target.value };
                      set("venues", venues);
                    }} />
                    <input className={inputClass} value={v.address} placeholder="Address" onChange={(e) => {
                      const venues = [...config.venues];
                      venues[i] = { ...v, address: e.target.value };
                      set("venues", venues);
                    }} />
                    <button type="button" onClick={() => set("venues", config.venues.filter((_, j) => j !== i))} className="text-xs text-rose-500">remove</button>
                  </div>
                ))}
                <button type="button" onClick={() => set("venues", [...config.venues, { name: "", address: "" }])} className="text-xs font-semibold text-[var(--accent)]">
                  + add a venue
                </button>
              </div>
              <div className="mt-4 grid gap-4">
                <Field label="Registration link (ÖSD site)"><input className={inputClass} value={config.registerUrl} onChange={(e) => set("registerUrl", e.target.value)} /></Field>
                <Field label="Practice materials link"><input className={inputClass} value={config.practiceUrl} onChange={(e) => set("practiceUrl", e.target.value)} /></Field>
                <Field label="Contact email"><input className={inputClass} value={config.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} /></Field>
              </div>
            </Section>

            <div className="sticky bottom-0 flex justify-end gap-3 border-t border-[var(--border)] bg-[var(--surface)]/95 py-4 backdrop-blur">
              <button type="button" onClick={load} className="rounded-full border border-[var(--border)] px-5 py-2 text-sm font-semibold text-[var(--muted)]">
                Reset
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="rounded-full bg-[var(--accent)] px-6 py-2 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save campaign"}
              </button>
            </div>
          </div>
        )}
      </div>
    </AdminShell>
  );
}

const inputClass =
  "w-full rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--muted)]">{title}</h2>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-[var(--foreground-soft)]">{label}</span>
      {children}
    </label>
  );
}

function DateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input type="date" className={inputClass} value={value} onChange={(e) => onChange(e.target.value)} />;
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-[var(--surface-alt)] p-3">
      <p className={`text-2xl font-black tabular-nums ${accent ? "text-[var(--accent)]" : "text-[var(--foreground)]"}`}>{value}</p>
      <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">{label}</p>
    </div>
  );
}
