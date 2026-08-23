"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import { ArrowLeftIcon, BellIcon, CheckIcon } from "@/components/icons";
import {
  formatDayRanges,
  formatInTimezone,
  normalizeSchedulePreferences,
  SCHEDULE_DAYS,
  type DayScheduleEntry,
  type NormalizedSchedulePreferences,
  type ScheduleDay,
} from "@/lib/private-schedule-preferences";

/**
 * Admin's view of ONE private student's schedule.
 *
 * Where the "Private timetable preferences received" / "Private session
 * request" notifications now send admin, instead of the tutor's booking
 * screen. Read-only by default — a "Notify tutor" button and an explicit
 * "Edit" toggle for the preferences, never a booking form.
 */

type StudentInfo = {
  id: string;
  name: string;
  email: string;
  level: string;
  studentCode: string | null;
  branchName: string | null;
  tutorId: string | null;
  tutorName: string | null;
};

type PrivateClass = {
  id: string;
  scheduledAt: string;
  durationMinutes: number;
  topic: string | null;
  status: string;
  lecturerName: string | null;
  seriesId: string | null;
  isException: boolean;
  proposedAt: string | null;
  deliveryMode: string | null;
};

const STATUSES = ["requested", "scheduled", "completed", "cancelled", "postponed", "declined"];
const PENDING_STATUSES = ["cancel_requested", "reschedule_requested"];
const DELIVERY_MODES = ["physical", "online", "hybrid"];

/** datetime-local needs "YYYY-MM-DDTHH:mm" in LOCAL time, not an ISO UTC string. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const STATUS_STYLES: Record<string, string> = {
  requested: "bg-amber-500/15 text-amber-600",
  scheduled: "bg-[var(--surface-alt)] text-[var(--foreground-soft)]",
  completed: "bg-emerald-500/15 text-emerald-600",
  cancelled: "bg-rose-500/15 text-rose-600",
  postponed: "bg-amber-500/15 text-amber-600",
  cancel_requested: "bg-amber-500/15 text-amber-600",
  reschedule_requested: "bg-amber-500/15 text-amber-600",
};

const EMPTY_PREFERENCES: NormalizedSchedulePreferences = {
  dayRanges: [],
  preferredTimes: [],
  examTimes: [],
  frequency: "weekly",
  timezone: "UTC",
  notes: "",
};

export default function AdminPrivateSchedulePage() {
  const params = useParams<{ studentId: string }>();
  const studentId = params?.studentId;
  const router = useRouter();

  const [student, setStudent] = useState<StudentInfo | null>(null);
  const [preferences, setPreferences] = useState<NormalizedSchedulePreferences | null>(null);
  const [classes, setClasses] = useState<PrivateClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<NormalizedSchedulePreferences>(EMPTY_PREFERENCES);
  const [saving, setSaving] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [editingClassId, setEditingClassId] = useState<string | null>(null);
  const [rescheduleWhen, setRescheduleWhen] = useState("");
  const [classBusy, setClassBusy] = useState(false);

  const load = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    try {
      const [prefsRes, classesRes] = await Promise.all([
        fetch(`/api/admin/schedule/private/${encodeURIComponent(studentId)}`, { cache: "no-store" }),
        fetch(`/api/lecturer/private-classes?studentId=${encodeURIComponent(studentId)}`, { cache: "no-store" }),
      ]);
      const prefsData = await prefsRes.json();
      if (!prefsRes.ok) throw new Error(prefsData.error ?? "Unable to load this student's schedule");
      setStudent(prefsData.student);
      const normalized = prefsData.preferences ? (prefsData.preferences as NormalizedSchedulePreferences) : normalizeSchedulePreferences(null);
      setPreferences(prefsData.submitted ? normalized : null);
      setDraft(normalized);

      if (classesRes.ok) {
        const classesData = await classesRes.json();
        setClasses(classesData.classes ?? []);
      }
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load this student's schedule");
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => { void load(); }, [load]);

  function entryFor(day: ScheduleDay): DayScheduleEntry | null {
    return draft.dayRanges.find((entry) => entry.day === day) ?? null;
  }

  function toggleDay(day: ScheduleDay) {
    setDraft((current) => ({
      ...current,
      dayRanges: current.dayRanges.some((entry) => entry.day === day)
        ? current.dayRanges.filter((entry) => entry.day !== day)
        : [...current.dayRanges, { day, ranges: [{ start: "09:00", end: "17:00" }] }],
    }));
  }

  function updateRange(day: ScheduleDay, index: number, field: "start" | "end", value: string) {
    setDraft((current) => ({
      ...current,
      dayRanges: current.dayRanges.map((entry) =>
        entry.day === day
          ? { ...entry, ranges: entry.ranges.map((range, i) => (i === index ? { ...range, [field]: value } : range)) }
          : entry,
      ),
    }));
  }

  async function saveEdits() {
    if (!studentId) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/schedule/private/${encodeURIComponent(studentId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save these changes");
      setPreferences(data.preferences);
      setEditing(false);
      setNotice("Saved. The student and tutor were both notified.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save these changes");
    } finally {
      setSaving(false);
    }
  }

  // These three call the SAME `/api/lecturer/private-classes` endpoint the
  // tutor's own booking screen uses — already admin-authorized (see
  // `requireStaff()` there) — by `fetch`, never by navigating admin into the
  // `/lecturer/*` portal. One update path for both admin and tutor, no
  // separate admin booking logic to drift out of sync with it.
  async function setClassStatus(id: string, status: string) {
    setClassBusy(true);
    setError("");
    try {
      const response = await fetch("/api/lecturer/private-classes", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (!response.ok) throw new Error((await response.json()).error ?? "Could not update this session");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update this session");
    } finally {
      setClassBusy(false);
    }
  }

  async function setClassDeliveryMode(id: string, deliveryMode: string) {
    setClassBusy(true);
    setError("");
    try {
      const response = await fetch("/api/lecturer/private-classes", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, deliveryMode: deliveryMode || null }),
      });
      if (!response.ok) throw new Error((await response.json()).error ?? "Could not update this session");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update this session");
    } finally {
      setClassBusy(false);
    }
  }

  async function rescheduleClass(id: string) {
    if (!rescheduleWhen) return;
    setClassBusy(true);
    setError("");
    try {
      const response = await fetch("/api/lecturer/private-classes", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, scheduledAt: new Date(rescheduleWhen).toISOString() }),
      });
      if (!response.ok) throw new Error((await response.json()).error ?? "Could not reschedule this session");
      setEditingClassId(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reschedule this session");
    } finally {
      setClassBusy(false);
    }
  }

  async function removeClass(id: string) {
    if (!window.confirm("Remove this booking? The student and tutor will both be notified.")) return;
    setClassBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/lecturer/private-classes?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json()).error ?? "Could not remove this session");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove this session");
    } finally {
      setClassBusy(false);
    }
  }

  async function respondToRequest(id: string, action: "approve_request" | "decline_request") {
    setClassBusy(true);
    setError("");
    try {
      const response = await fetch("/api/lecturer/private-classes", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      if (!response.ok) throw new Error((await response.json()).error ?? "Could not respond to this request");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not respond to this request");
    } finally {
      setClassBusy(false);
    }
  }

  async function endSeries(seriesId: string) {
    if (!window.confirm("End this recurring series? Sessions already on the calendar stay — only future ones stop generating.")) return;
    setClassBusy(true);
    setError("");
    try {
      const response = await fetch("/api/lecturer/private-classes/series", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seriesId }),
      });
      if (!response.ok) throw new Error((await response.json()).error ?? "Could not end this series");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not end this series");
    } finally {
      setClassBusy(false);
    }
  }

  async function notifyTutor() {
    if (!studentId) return;
    setNotifying(true);
    setNotice("");
    setError("");
    try {
      const response = await fetch(`/api/admin/schedule/private/${encodeURIComponent(studentId)}`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not notify the tutor");
      setNotice(`${student?.tutorName ?? "The tutor"} has been notified to review this.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not notify the tutor");
    } finally {
      setNotifying(false);
    }
  }

  return (
    <AdminShell>
      <main className="p-8">
        <button type="button" onClick={() => router.push("/admin/schedule")} className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--muted)] hover:text-[var(--foreground)]">
          <ArrowLeftIcon className="h-4 w-4" /> All schedules
        </button>

        {loading ? (
          <p className="py-12 text-center text-[var(--muted)]">Loading…</p>
        ) : error && !student ? (
          <p className="rounded-lg bg-rose-500/10 p-4 text-rose-600">{error}</p>
        ) : student ? (
          <>
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.25em] text-[var(--accent)]">Private class review</p>
                <h1 className="mt-2 text-3xl font-bold">{student.name}</h1>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {student.level}
                  {student.branchName ? ` · ${student.branchName}` : ""}
                  {student.studentCode ? ` · ${student.studentCode}` : ""}
                </p>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Tutor: {student.tutorName ?? <span className="italic">Not assigned</span>}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void notifyTutor()}
                  disabled={notifying || !student.tutorId}
                  className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  <BellIcon className="h-4 w-4" /> {notifying ? "Notifying…" : "Notify tutor"}
                </button>
              </div>
            </div>

            {notice && <p className="mb-4 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-700">{notice}</p>}
            {error && <p className="mb-4 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-600">{error}</p>}

            <section className="mb-8 rounded-xl border border-[#D4AF37]/30 bg-[#D4AF37]/10 p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold text-[#8b6815]">Student's timetable preferences</h2>
                {!editing && (
                  <button type="button" onClick={() => setEditing(true)} className="rounded-lg border border-[#D4AF37]/50 px-3 py-1.5 text-xs font-semibold text-[#8b6815]">
                    Edit
                  </button>
                )}
              </div>

              {!editing ? (
                preferences && preferences.dayRanges.length > 0 ? (
                  <div className="mt-3 text-sm text-[var(--foreground-soft)]">
                    <p>{formatDayRanges(preferences.dayRanges)}</p>
                    <p className="mt-1">
                      {preferences.frequency}
                      {preferences.timezone ? ` · ${preferences.timezone}` : ""}
                    </p>
                    {preferences.notes && <p className="mt-1 text-[var(--muted)]">{preferences.notes}</p>}
                    {preferences.examTimes.length > 0 && <p className="mt-1 text-[var(--muted)]">Exam times: {preferences.examTimes.join(", ")}</p>}
                    {preferences.preferredTimes.length > 0 && <p className="mt-1 text-[var(--muted)]">Class times: {preferences.preferredTimes.join(", ")}</p>}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-[var(--foreground-soft)]">This student has not shared timetable preferences yet.</p>
                )
              ) : (
                <div className="mt-4 space-y-2">
                  {SCHEDULE_DAYS.map((day) => {
                    const entry = entryFor(day);
                    const enabled = entry !== null;
                    return (
                      <div key={day} className={`rounded-xl border p-3 ${enabled ? "border-[#D4AF37] bg-[#D4AF37]/10" : "border-[var(--border)] bg-[var(--surface-alt)]"}`}>
                        <button type="button" onClick={() => toggleDay(day)} className="flex w-full items-center gap-2 text-left text-sm font-semibold capitalize">
                          <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border ${enabled ? "border-[#D4AF37] bg-[#D4AF37] text-[#1c1508]" : "border-[var(--border)]"}`}>
                            {enabled && <CheckIcon className="h-3 w-3" />}
                          </span>
                          {day}
                        </button>
                        {enabled && entry && (
                          <div className="mt-2 space-y-2 pl-7">
                            {entry.ranges.map((range, index) => (
                              <div key={index} className="flex items-center gap-2">
                                <input type="time" value={range.start} onChange={(e) => updateRange(day, index, "start", e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm" />
                                <span className="text-xs text-[var(--muted)]">to</span>
                                <input type="time" value={range.end} onChange={(e) => updateRange(day, index, "end", e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm" />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div className="flex justify-end gap-2 pt-2">
                    <button type="button" onClick={() => { setDraft(preferences ?? EMPTY_PREFERENCES); setEditing(false); }} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm">
                      Cancel
                    </button>
                    <button type="button" onClick={() => void saveEdits()} disabled={saving || draft.dayRanges.length === 0} className="rounded-lg bg-[#D4AF37] px-4 py-2 text-sm font-bold text-[#1c1508] disabled:opacity-50">
                      {saving ? "Saving…" : "Save changes"}
                    </button>
                  </div>
                </div>
              )}
            </section>

            {classes.some((c) => PENDING_STATUSES.includes(c.status)) && (
              <section className="mb-8 rounded-xl border border-amber-500/30 bg-amber-500/10 p-5">
                <h2 className="font-semibold text-amber-700">Pending requests</h2>
                <div className="mt-3 space-y-2">
                  {classes.filter((c) => PENDING_STATUSES.includes(c.status)).map((c) => {
                    const start = new Date(c.scheduledAt);
                    const isReschedule = c.status === "reschedule_requested";
                    return (
                      <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                        <div>
                          <p className="text-sm font-semibold">
                            {isReschedule ? "Reschedule request" : "Cancellation request"} — {start.toLocaleString()}
                          </p>
                          {isReschedule && c.proposedAt && (
                            <p className="mt-1 text-sm text-[var(--foreground-soft)]">Proposed: {new Date(c.proposedAt).toLocaleString()}</p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => void respondToRequest(c.id, "approve_request")} disabled={classBusy} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">Approve</button>
                          <button type="button" onClick={() => void respondToRequest(c.id, "decline_request")} disabled={classBusy} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-semibold hover:bg-[var(--surface-alt)] disabled:opacity-50">Decline</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            <h2 className="mb-3 text-lg font-semibold">Booked and requested sessions</h2>
            {classes.length === 0 ? (
              <p className="py-6 text-center text-sm text-[var(--muted)]">Nothing booked for this student yet.</p>
            ) : (
              <div className="space-y-2">
                {classes.map((c) => {
                  const start = new Date(c.scheduledAt);
                  const end = new Date(start.getTime() + c.durationMinutes * 60_000);
                  const isEditingTime = editingClassId === c.id;
                  return (
                    <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                      <div className="min-w-0">
                        {isEditingTime ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="datetime-local"
                              value={rescheduleWhen}
                              onChange={(e) => setRescheduleWhen(e.target.value)}
                              className="rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] px-2.5 py-1.5 text-sm"
                            />
                            {rescheduleWhen && preferences?.timezone && formatInTimezone(new Date(rescheduleWhen), preferences.timezone) && (
                              <span className="text-xs text-[var(--muted)]">
                                {formatInTimezone(new Date(rescheduleWhen), preferences.timezone)} for {student?.name} ({preferences.timezone})
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold">{start.toLocaleString()}</span>
                            <span className="text-xs text-[var(--muted)]">to {end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                            <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[c.status] ?? STATUS_STYLES.scheduled}`}>{c.status}</span>
                            {c.seriesId && (
                              <span className="rounded bg-[var(--accent-soft)] px-2 py-0.5 text-xs font-medium text-[var(--accent)]">
                                {c.isException ? "Recurring · edited" : "Recurring"}
                              </span>
                            )}
                          </div>
                        )}
                        <p className="mt-1 text-sm text-[var(--foreground-soft)]">
                          {c.topic || <span className="italic text-[var(--muted)]">No topic set</span>}
                          {c.lecturerName && <span className="text-[var(--muted)]"> · {c.lecturerName}</span>}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {isEditingTime ? (
                          <>
                            <button type="button" onClick={() => void rescheduleClass(c.id)} disabled={classBusy || !rescheduleWhen} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">Save time</button>
                            <button type="button" onClick={() => setEditingClassId(null)} disabled={classBusy} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm">Cancel</button>
                          </>
                        ) : (
                          <>
                            <select
                              value={c.deliveryMode ?? ""}
                              onChange={(e) => void setClassDeliveryMode(c.id, e.target.value)}
                              disabled={classBusy}
                              aria-label="Delivery mode"
                              className="rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-1.5 text-sm capitalize text-[var(--foreground)]"
                            >
                              <option value="">Usual delivery</option>
                              {DELIVERY_MODES.map((mode) => <option key={mode} value={mode} className="capitalize">{mode}</option>)}
                            </select>
                            <select
                              value={c.status}
                              onChange={(e) => void setClassStatus(c.id, e.target.value)}
                              disabled={classBusy}
                              className="rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-1.5 text-sm text-[var(--foreground)]"
                            >
                              {PENDING_STATUSES.includes(c.status) && <option value={c.status}>{c.status.replace("_", " ")}</option>}
                              {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                            </select>
                            <button type="button" onClick={() => { setEditingClassId(c.id); setRescheduleWhen(toLocalInput(start)); }} disabled={classBusy} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-semibold text-[var(--foreground-soft)] hover:bg-[var(--surface-alt)]">Reschedule</button>
                            <button type="button" onClick={() => void removeClass(c.id)} disabled={classBusy} className="rounded-lg border border-rose-500/30 px-3 py-1.5 text-sm font-semibold text-rose-600 hover:bg-rose-500/10">Remove</button>
                            {c.seriesId && (
                              <button type="button" onClick={() => void endSeries(c.seriesId as string)} disabled={classBusy} className="rounded-lg border border-amber-500/30 px-3 py-1.5 text-sm font-semibold text-amber-600 hover:bg-amber-500/10">End series</button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : null}
      </main>
    </AdminShell>
  );
}
