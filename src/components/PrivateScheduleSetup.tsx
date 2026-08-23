"use client";

import { useEffect, useState } from "react";
import { CalendarIcon, CheckIcon, SparklesIcon } from "@/components/icons";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const WINDOWS = ["morning", "afternoon", "evening"];
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

type PrivateScheduleSetupProps = { classType?: string };

export default function PrivateScheduleSetup({ classType }: PrivateScheduleSetupProps) {
  const [open, setOpen] = useState(false);
  const [eligible, setEligible] = useState(false);
  const [submitted, setSubmitted] = useState(true);
  const [days, setDays] = useState<string[]>([]);
  const [windows, setWindows] = useState<string[]>([]);
  const [preferredTimes, setPreferredTimes] = useState<string[]>([]);
  const [examTimes, setExamTimes] = useState<string[]>([]);
  const [frequency, setFrequency] = useState("weekly");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (classType !== "private") return;
    fetch("/api/student/private-schedule-preferences", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!data) return;
        setEligible(data.eligible === true);
        setSubmitted(data.submitted === true);
        if (data.preferences) {
          setDays(data.preferences.days ?? []);
          setWindows(data.preferences.windows ?? []);
          setPreferredTimes(data.preferences.preferredTimes ?? []);
          setExamTimes(data.preferences.examTimes ?? []);
          setFrequency(data.preferences.frequency ?? "weekly");
          setNotes(data.preferences.notes ?? "");
        }
        if (data.eligible === true && data.submitted !== true) {
          const reminderKey = `private-timetable-reminder:${new Date().toISOString().slice(0, 10)}`;
          if (window.localStorage.getItem(reminderKey) !== "dismissed") setOpen(true);
        }
      })
      .catch(() => {});
  }, [classType]);

  if (classType !== "private" || !eligible) return null;

  function toggle(value: string, current: string[], update: (next: string[]) => void) {
    update(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/student/private-schedule-preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ days, windows, preferredTimes, examTimes, frequency, notes, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save your preferences");
      setSubmitted(true);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your preferences");
    } finally {
      setSaving(false);
    }
  }

  function dismissForToday() {
    window.localStorage.setItem(`private-timetable-reminder:${new Date().toISOString().slice(0, 10)}`, "dismissed");
    setOpen(false);
  }

  function addTime(setTimes: (next: string[]) => void, current: string[], time: string) {
    if (TIME_PATTERN.test(time) && !current.includes(time)) setTimes([...current, time].sort());
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-[28px] border border-[#D4AF37]/35 bg-[#0b1220] p-5 text-white shadow-lg">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#D4AF37]/15 text-[#E8C766]"><SparklesIcon className="h-5 w-5" /></span>
          <div>
            <p className="text-sm font-bold">{submitted ? "Your private timetable is on file" : "Set your private timetable"}</p>
            <p className="mt-1 text-xs text-white/60">Tell Becca when your one-to-one classes work best. Your tutor will confirm the bookings.</p>
          </div>
        </div>
        <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-2xl bg-[#D4AF37] px-4 py-2.5 text-sm font-bold text-[#1c1508] hover:brightness-110">
          <CalendarIcon className="h-4 w-4" /> {submitted ? "Adjust times" : "Customize timetable"}
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/65 p-4" role="dialog" aria-modal="true" aria-labelledby="private-schedule-title">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--foreground)] shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-xs font-bold uppercase tracking-[0.25em] text-[#B28A22]">Becca</p><h2 id="private-schedule-title" className="mt-2 text-2xl font-semibold">When should your tutor meet you?</h2><p className="mt-2 text-sm text-[var(--muted)]">These are preferences, not a locked timetable. Your tutor or the office will confirm the exact time.</p></div>
              <button type="button" onClick={dismissForToday} className="text-sm text-[var(--muted)]">Remind me tomorrow</button>
            </div>

            <fieldset className="mt-6"><legend className="text-sm font-semibold">Preferred days</legend><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{DAYS.map((day) => <button key={day} type="button" onClick={() => toggle(day, days, setDays)} className={`rounded-xl border px-3 py-2 text-sm capitalize ${days.includes(day) ? "border-[#D4AF37] bg-[#D4AF37]/15 text-[#8b6815]" : "border-[var(--border)] bg-[var(--surface-alt)]"}`}>{days.includes(day) && <CheckIcon className="mr-1 inline h-3.5 w-3.5" />}{day}</button>)}</div></fieldset>
            <fieldset className="mt-6"><legend className="text-sm font-semibold">Preferred time windows</legend><div className="mt-3 grid grid-cols-3 gap-2">{WINDOWS.map((window) => <button key={window} type="button" onClick={() => toggle(window, windows, setWindows)} className={`rounded-xl border px-3 py-2 text-sm capitalize ${windows.includes(window) ? "border-[#D4AF37] bg-[#D4AF37]/15 text-[#8b6815]" : "border-[var(--border)] bg-[var(--surface-alt)]"}`}>{windows.includes(window) && <CheckIcon className="mr-1 inline h-3.5 w-3.5" />}{window}</button>)}</div></fieldset>
            <fieldset className="mt-6"><legend className="text-sm font-semibold">Preferred class start times <span className="font-normal text-[var(--muted)]">(optional)</span></legend><p className="mt-1 text-xs text-[var(--muted)]">Add any time that works for you. Your tutor will confirm the final booking.</p><div className="mt-3 flex flex-wrap gap-2">{preferredTimes.map((time) => <span key={time} className="inline-flex items-center gap-2 rounded-xl border border-[#D4AF37] bg-[#D4AF37]/15 px-3 py-2 text-sm">{time}<button type="button" aria-label={`Remove ${time}`} onClick={() => setPreferredTimes(preferredTimes.filter((item) => item !== time))}>x</button></span>)}</div><input type="time" aria-label="Add preferred class start time" className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm" onChange={(event) => { addTime(setPreferredTimes, preferredTimes, event.target.value); event.target.value = ""; }} /></fieldset>
            <fieldset className="mt-6"><legend className="text-sm font-semibold">Preferred exam start times <span className="font-normal text-[var(--muted)]">(optional)</span></legend><p className="mt-1 text-xs text-[var(--muted)]">Add any start time. These guide the school; they do not change official exam times.</p><div className="mt-3 flex flex-wrap gap-2">{examTimes.map((time) => <span key={time} className="inline-flex items-center gap-2 rounded-xl border border-[#D4AF37] bg-[#D4AF37]/15 px-3 py-2 text-sm">{time}<button type="button" aria-label={`Remove ${time}`} onClick={() => setExamTimes(examTimes.filter((item) => item !== time))}>x</button></span>)}</div><input type="time" aria-label="Add preferred exam start time" className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm" onChange={(event) => { addTime(setExamTimes, examTimes, event.target.value); event.target.value = ""; }} /></fieldset>
            <label className="mt-6 block text-sm font-semibold">How often?<select value={frequency} onChange={(event) => setFrequency(event.target.value)} className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 font-normal"><option value="weekly">Once a week</option><option value="twice-weekly">Twice a week</option><option value="flexible">I am flexible</option></select></label>
            <label className="mt-6 block text-sm font-semibold">Anything Becca should know?<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="Travel days, work hours, preferred notice..." className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 font-normal" /></label>
            {error && <p className="mt-4 text-sm text-rose-600">{error}</p>}
            <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={dismissForToday} className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm">Remind me tomorrow</button><button type="button" onClick={() => void save()} disabled={saving || days.length === 0 || windows.length === 0} className="rounded-xl bg-[#D4AF37] px-5 py-2 text-sm font-bold text-[#1c1508] disabled:opacity-50">{saving ? "Sending..." : "Send preferences"}</button></div>
          </div>
        </div>
      )}
    </>
  );
}
