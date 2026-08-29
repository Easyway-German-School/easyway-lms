"use client";

import { useEffect, useState } from "react";
import { BroadcastIcon, CalendarIcon, CheckIcon, PlusIcon, SparklesIcon, TrashIcon } from "@/components/icons";
import {
  normalizeSchedulePreferences,
  SCHEDULE_DAYS,
  TIME_PATTERN,
  type DayScheduleEntry,
  type ScheduleDay,
} from "@/lib/private-schedule-preferences";

const ALL_DAY_RANGE = { start: "00:00", end: "23:59" };

type UpcomingSession = {
  id: string;
  scheduledAt: string;
  durationMinutes: number;
  topic: string | null;
  status: string;
  proposedAt: string | null;
  lecturerName: string | null;
  deliveryMode: string | null;
};

/** Same window the tutor's own "Start & ring" is honest about being worth joining late for. */
function isJoinableNow(session: UpcomingSession): boolean {
  if (session.deliveryMode === "physical") return false;
  if (session.status !== "scheduled" && session.status !== "postponed") return false;
  const start = new Date(session.scheduledAt).getTime();
  const end = start + session.durationMinutes * 60_000;
  const now = Date.now();
  return now >= start - 15 * 60_000 && now <= end;
}

const PENDING_STATUSES = ["cancel_requested", "reschedule_requested"];

export default function PrivateScheduleSetup({ classType }: { classType?: string }) {
  const [open, setOpen] = useState(false);
  const [eligible, setEligible] = useState(false);
  const [submitted, setSubmitted] = useState(true);
  const [dayRanges, setDayRanges] = useState<DayScheduleEntry[]>([]);
  const [preferredTimes, setPreferredTimes] = useState<string[]>([]);
  const [examTimes, setExamTimes] = useState<string[]>([]);
  const [frequency, setFrequency] = useState("weekly");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [requestDate, setRequestDate] = useState("");
  const [requestTime, setRequestTime] = useState("");
  const [requestBusy, setRequestBusy] = useState(false);
  const [error, setError] = useState("");

  const [sessions, setSessions] = useState<UpcomingSession[]>([]);
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [proposedDate, setProposedDate] = useState("");
  const [proposedTime, setProposedTime] = useState("");
  const [sessionBusy, setSessionBusy] = useState(false);

  /**
   * Becca's read on the draft. Deliberately held against the DRAFT rather than
   * against what is saved: advice that only arrives after you have committed
   * is a report, not help.
   */
  const [advice, setAdvice] = useState<{
    message: string;
    candidates: Array<{ day: string; start: string; score: number; tutorBusy: boolean }>;
    mismatch: { note: string } | null;
  } | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (classType !== "private") return;
    fetch("/api/student/private-schedule-preferences", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!data) return;
        setEligible(data.eligible === true);
        setSubmitted(data.submitted === true);
        if (data.preferences) {
          const normalized = normalizeSchedulePreferences(data.preferences);
          setDayRanges(normalized.dayRanges);
          setPreferredTimes(normalized.preferredTimes);
          setExamTimes(normalized.examTimes);
          setFrequency(normalized.frequency);
          setNotes(normalized.notes);
        }
        if (data.eligible === true && data.submitted !== true) {
          const reminderKey = `private-timetable-reminder:${new Date().toISOString().slice(0, 10)}`;
          if (window.localStorage.getItem(reminderKey) !== "dismissed") setOpen(true);
        }
      })
      .catch(() => {});
  }, [classType]);

  function loadSessions() {
    fetch("/api/student/private-classes", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (data) setSessions(data.classes ?? []); })
      .catch(() => {});
  }

  useEffect(() => {
    if (classType !== "private") return;
    loadSessions();
  }, [classType]);

  if (classType !== "private" || !eligible) return null;

  async function requestCancel(id: string) {
    if (!window.confirm("Ask to cancel this session? Your tutor and the office will need to approve it.")) return;
    setSessionBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/student/private-classes/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "request_cancel" }),
      });
      if (!response.ok) throw new Error((await response.json()).error ?? "Could not send this request");
      loadSessions();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send this request");
    } finally {
      setSessionBusy(false);
    }
  }

  async function sendRescheduleRequest(id: string) {
    if (!proposedDate || !proposedTime) return;
    setSessionBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/student/private-classes/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "request_reschedule", proposedAt: `${proposedDate}T${proposedTime}` }),
      });
      if (!response.ok) throw new Error((await response.json()).error ?? "Could not send this request");
      setReschedulingId(null);
      setProposedDate("");
      setProposedTime("");
      loadSessions();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send this request");
    } finally {
      setSessionBusy(false);
    }
  }

  function entryFor(day: ScheduleDay) {
    return dayRanges.find((entry) => entry.day === day) ?? null;
  }

  function toggleDay(day: ScheduleDay) {
    setDayRanges((current) =>
      current.some((entry) => entry.day === day)
        ? current.filter((entry) => entry.day !== day)
        : [...current, { day, ranges: [{ start: "09:00", end: "17:00" }] }],
    );
  }

  function setAllDay(day: ScheduleDay) {
    setDayRanges((current) => current.map((entry) => (entry.day === day ? { ...entry, ranges: [{ ...ALL_DAY_RANGE }] } : entry)));
  }

  function addRange(day: ScheduleDay) {
    setDayRanges((current) =>
      current.map((entry) => (entry.day === day ? { ...entry, ranges: [...entry.ranges, { start: "09:00", end: "17:00" }] } : entry)),
    );
  }

  function updateRange(day: ScheduleDay, index: number, field: "start" | "end", value: string) {
    setDayRanges((current) =>
      current.map((entry) =>
        entry.day === day
          ? { ...entry, ranges: entry.ranges.map((range, i) => (i === index ? { ...range, [field]: value } : range)) }
          : entry,
      ),
    );
  }

  function removeRange(day: ScheduleDay, index: number) {
    setDayRanges((current) =>
      current
        .map((entry) => (entry.day === day ? { ...entry, ranges: entry.ranges.filter((_, i) => i !== index) } : entry))
        .filter((entry) => entry.ranges.length > 0),
    );
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/student/private-schedule-preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dayRanges, preferredTimes, examTimes, frequency, notes, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
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

  /**
   * Ask Becca what she would pick.
   *
   * Posts the DRAFT, so the answer reflects what is ticked on screen right
   * now. Reads nothing back into the form on purpose — a suggestion that
   * silently rewrites your choices is not a suggestion.
   */
  async function askBecca() {
    setAsking(true);
    setError("");
    try {
      const response = await fetch("/api/student/private-schedule-preferences/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dayRanges, preferredTimes, examTimes, frequency, notes, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Becca could not work that out");
      setAdvice({ message: data.message, candidates: data.candidates ?? [], mismatch: data.mismatch ?? null });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Becca could not work that out");
    } finally {
      setAsking(false);
    }
  }

  /** Take one of Becca's slots into the form. The student's press, not hers. */
  function acceptSlot(day: string, start: string) {
    const target = day as ScheduleDay;
    if (!SCHEDULE_DAYS.includes(target)) return;
    const endHour = Math.min(23, Number(start.slice(0, 2)) + 1);
    const range = { start, end: `${String(endHour).padStart(2, "0")}:00` };
    setDayRanges((current) =>
      current.some((entry) => entry.day === target)
        ? current.map((entry) => (entry.day === target ? { ...entry, ranges: [range] } : entry))
        : [...current, { day: target, ranges: [range] }],
    );
    if (!preferredTimes.includes(start)) setPreferredTimes([...preferredTimes, start].sort());
  }

  function dismissForToday() {
    window.localStorage.setItem(`private-timetable-reminder:${new Date().toISOString().slice(0, 10)}`, "dismissed");
    setOpen(false);
  }

  function addTime(setTimes: (next: string[]) => void, current: string[], time: string) {
    if (TIME_PATTERN.test(time) && !current.includes(time)) setTimes([...current, time].sort());
  }

  async function requestSession() {
    if (!requestDate || !requestTime) return;
    setRequestBusy(true);
    try {
      const response = await fetch("/api/student/private-classes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scheduledAt: `${requestDate}T${requestTime}`, durationMinutes: 60 }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not send session request");
      setRequestDate("");
      setRequestTime("");
      loadSessions();
      window.alert("Your tutor has received the request. It will appear in your calendar after they confirm it.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send session request");
    } finally {
      setRequestBusy(false);
    }
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
      <div className="mb-6 rounded-[24px] border border-[var(--border)] bg-[var(--surface)] p-4 text-[var(--foreground)]">
        <p className="text-sm font-bold">Request a specific private session</p>
        <p className="mt-1 text-xs text-[var(--muted)]">Choose a date and exact time. Your tutor must acknowledge it before it appears in My Classes.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2"><input type="date" value={requestDate} onChange={(event) => setRequestDate(event.target.value)} className="rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm" /><input type="time" value={requestTime} onChange={(event) => setRequestTime(event.target.value)} className="rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm" /><button type="button" onClick={() => void requestSession()} disabled={requestBusy || !requestDate || !requestTime} className="rounded-xl bg-[#D4AF37] px-4 py-2 text-sm font-bold text-[#1c1508] disabled:opacity-50">{requestBusy ? "Sending..." : "Request session"}</button></div>
      </div>

      {sessions.length > 0 && (
        <div className="mb-6 rounded-[24px] border border-[var(--border)] bg-[var(--surface)] p-4 text-[var(--foreground)]">
          <p className="text-sm font-bold">Your upcoming sessions</p>
          <p className="mt-1 text-xs text-[var(--muted)]">Need a different time? Ask here — your tutor and the office approve it before anything changes.</p>
          {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
          <div className="mt-3 space-y-2">
            {sessions.map((session) => {
              const start = new Date(session.scheduledAt);
              const isPending = PENDING_STATUSES.includes(session.status);
              const isRescheduling = reschedulingId === session.id;
              return (
                <div key={session.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{start.toLocaleString()}</p>
                      <p className="text-xs text-[var(--muted)]">
                        {session.topic || "One-to-one session"}
                        {session.lecturerName ? ` · ${session.lecturerName}` : ""}
                      </p>
                    </div>
                    {isPending ? (
                      <span className="shrink-0 rounded-lg bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-600">
                        {session.status === "cancel_requested" ? "Cancellation pending" : `Reschedule pending${session.proposedAt ? ` — proposed ${new Date(session.proposedAt).toLocaleString()}` : ""}`}
                      </span>
                    ) : (
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {isJoinableNow(session) && (
                          <a
                            href={`/live?privateClassId=${session.id}`}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0D7C7E] px-2.5 py-1.5 text-xs font-semibold text-white hover:brightness-110"
                          >
                            <BroadcastIcon className="h-3.5 w-3.5" /> Join class
                          </a>
                        )}
                        <button type="button" onClick={() => { setReschedulingId(isRescheduling ? null : session.id); setProposedDate(""); setProposedTime(""); }} className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold hover:bg-[var(--surface)]">
                          {isRescheduling ? "Cancel" : "Request reschedule"}
                        </button>
                        <button type="button" onClick={() => void requestCancel(session.id)} disabled={sessionBusy} className="rounded-lg border border-rose-500/30 px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-500/10 disabled:opacity-50">
                          Request cancel
                        </button>
                      </div>
                    )}
                  </div>
                  {isRescheduling && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
                      <input type="date" value={proposedDate} onChange={(event) => setProposedDate(event.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm" />
                      <input type="time" value={proposedTime} onChange={(event) => setProposedTime(event.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm" />
                      <button type="button" onClick={() => void sendRescheduleRequest(session.id)} disabled={sessionBusy || !proposedDate || !proposedTime} className="rounded-lg bg-[#D4AF37] px-3 py-1.5 text-xs font-bold text-[#1c1508] disabled:opacity-50">
                        {sessionBusy ? "Sending..." : "Send request"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/65 p-4" role="dialog" aria-modal="true" aria-labelledby="private-schedule-title">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--foreground)] shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-xs font-bold uppercase tracking-[0.25em] text-[#B28A22]">Becca</p><h2 id="private-schedule-title" className="mt-2 text-2xl font-semibold">When should your tutor meet you?</h2><p className="mt-2 text-sm text-[var(--muted)]">Different days can have different free times — mark every day that works and the hours you're actually free on it. These are preferences, not a locked timetable.</p></div>
              <button type="button" onClick={dismissForToday} className="text-sm text-[var(--muted)]">Remind me tomorrow</button>
            </div>

            <fieldset className="mt-6">
              <legend className="text-sm font-semibold">Which days, and what time on each</legend>
              <div className="mt-3 space-y-2">
                {SCHEDULE_DAYS.map((day) => {
                  const entry = entryFor(day);
                  const enabled = entry !== null;
                  const isAllDay = entry?.ranges.length === 1 && entry.ranges[0].start === ALL_DAY_RANGE.start && entry.ranges[0].end === ALL_DAY_RANGE.end;
                  return (
                    <div key={day} className={`rounded-xl border p-3 ${enabled ? "border-[#D4AF37] bg-[#D4AF37]/10" : "border-[var(--border)] bg-[var(--surface-alt)]"}`}>
                      <button type="button" onClick={() => toggleDay(day)} className="flex w-full items-center gap-2 text-left text-sm font-semibold capitalize">
                        <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border ${enabled ? "border-[#D4AF37] bg-[#D4AF37] text-[#1c1508]" : "border-[var(--border)]"}`}>
                          {enabled && <CheckIcon className="h-3 w-3" />}
                        </span>
                        {day}
                      </button>

                      {enabled && entry && (
                        <div className="mt-3 space-y-2 pl-7">
                          {!isAllDay && entry.ranges.map((range, index) => (
                            <div key={index} className="flex items-center gap-2">
                              <input
                                type="time"
                                value={range.start}
                                onChange={(event) => updateRange(day, index, "start", event.target.value)}
                                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm"
                              />
                              <span className="text-xs text-[var(--muted)]">to</span>
                              <input
                                type="time"
                                value={range.end}
                                onChange={(event) => updateRange(day, index, "end", event.target.value)}
                                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm"
                              />
                              {entry.ranges.length > 1 && (
                                <button type="button" aria-label="Remove this time range" onClick={() => removeRange(day, index)} className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-500/10">
                                  <TrashIcon className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          ))}
                          {isAllDay && <p className="text-xs text-[var(--muted)]">Free all day</p>}
                          <div className="flex flex-wrap items-center gap-3 pt-1">
                            {!isAllDay && (
                              <button type="button" onClick={() => addRange(day)} className="inline-flex items-center gap-1 text-xs font-semibold text-[#8b6815]">
                                <PlusIcon className="h-3.5 w-3.5" /> Add another time on {day}
                              </button>
                            )}
                            <button type="button" onClick={() => setAllDay(day)} className="text-xs font-semibold text-[var(--muted)] underline decoration-dotted">
                              {isAllDay ? "Keep as all day" : "Free all day instead"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </fieldset>
            <fieldset className="mt-6"><legend className="text-sm font-semibold">Preferred class start times <span className="font-normal text-[var(--muted)]">(optional)</span></legend><p className="mt-1 text-xs text-[var(--muted)]">Add any time that works for you. Your tutor will confirm the final booking.</p><div className="mt-3 flex flex-wrap gap-2">{preferredTimes.map((time) => <span key={time} className="inline-flex items-center gap-2 rounded-xl border border-[#D4AF37] bg-[#D4AF37]/15 px-3 py-2 text-sm">{time}<button type="button" aria-label={`Remove ${time}`} onClick={() => setPreferredTimes(preferredTimes.filter((item) => item !== time))}>x</button></span>)}</div><input type="time" aria-label="Add preferred class start time" className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm" onChange={(event) => { addTime(setPreferredTimes, preferredTimes, event.target.value); event.target.value = ""; }} /></fieldset>
            <fieldset className="mt-6"><legend className="text-sm font-semibold">Preferred exam start times <span className="font-normal text-[var(--muted)]">(optional)</span></legend><p className="mt-1 text-xs text-[var(--muted)]">Add any start time. These guide the school; they do not change official exam times.</p><div className="mt-3 flex flex-wrap gap-2">{examTimes.map((time) => <span key={time} className="inline-flex items-center gap-2 rounded-xl border border-[#D4AF37] bg-[#D4AF37]/15 px-3 py-2 text-sm">{time}<button type="button" aria-label={`Remove ${time}`} onClick={() => setExamTimes(examTimes.filter((item) => item !== time))}>x</button></span>)}</div><input type="time" aria-label="Add preferred exam start time" className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm" onChange={(event) => { addTime(setExamTimes, examTimes, event.target.value); event.target.value = ""; }} /></fieldset>
            <label className="mt-6 block text-sm font-semibold">How often?<select value={frequency} onChange={(event) => setFrequency(event.target.value)} className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 font-normal"><option value="weekly">Once a week</option><option value="twice-weekly">Twice a week</option><option value="flexible">I am flexible</option></select></label>
            <label className="mt-6 block text-sm font-semibold">Anything Becca should know?<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="Travel days, work hours, preferred notice..." className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 font-normal" /></label>
            {/*
              BECCA'S ACTUAL OPINION. Everything above this is the student
              telling us their constraints; this is the one part of the panel
              that thinks. The slots are computed server-side from those
              constraints, their real study rhythm and the tutor's diary — see
              src/lib/private-schedule-advisor.ts — and only the wording comes
              from a model. Nothing here writes to the form unless the student
              presses "Use this".
            */}
            <div className="mt-6 rounded-2xl border border-[#D4AF37]/40 bg-[#D4AF37]/[0.07] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.25em] text-[#B28A22]">Becca</p>
                  <p className="mt-1 text-sm text-[var(--muted)]">Not sure what to pick? I will work it out from your free times and when you actually study.</p>
                </div>
                <button
                  type="button"
                  onClick={() => void askBecca()}
                  disabled={asking}
                  className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-[#D4AF37] px-4 py-2 text-sm font-bold text-[#8b6815] disabled:opacity-50"
                >
                  <SparklesIcon className="h-4 w-4" />
                  {asking ? "Thinking…" : advice ? "Ask again" : "Ask Becca"}
                </button>
              </div>

              {advice && (
                <div className="mt-4 border-t border-[#D4AF37]/30 pt-4">
                  <p className="text-sm">{advice.message}</p>
                  {advice.candidates.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {advice.candidates.map((candidate) => (
                        <button
                          key={`${candidate.day}-${candidate.start}`}
                          type="button"
                          onClick={() => acceptSlot(candidate.day, candidate.start)}
                          className="rounded-xl border border-[#D4AF37] bg-[var(--surface)] px-3 py-2 text-left text-xs font-semibold transition hover:bg-[#D4AF37]/15"
                        >
                          <span className="block capitalize">{candidate.day} · {candidate.start}</span>
                          <span className="mt-0.5 block font-normal text-[var(--muted)]">
                            {candidate.tutorBusy ? "tutor may need to shuffle · use this" : "use this"}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {advice.mismatch && (
                    <p className="mt-3 rounded-xl bg-[var(--surface-alt)] p-3 text-xs text-[var(--muted)]">{advice.mismatch.note}</p>
                  )}
                </div>
              )}
            </div>

            {error && <p className="mt-4 text-sm text-rose-600">{error}</p>}
            <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={dismissForToday} className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm">Remind me tomorrow</button><button type="button" onClick={() => void save()} disabled={saving || dayRanges.length === 0} className="rounded-xl bg-[#D4AF37] px-5 py-2 text-sm font-bold text-[#1c1508] disabled:opacity-50">{saving ? "Sending..." : "Send preferences"}</button></div>
          </div>
        </div>
      )}
    </>
  );
}
