"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useRef, useState } from "react";
import LecturerShell from "@/components/LecturerShell";
import TutorLivePanel from "@/components/live/TutorLivePanel";
import { AttachmentIcon, BroadcastIcon, PrivateClassIcon, SendIcon } from "@/components/icons";

/**
 * One-to-one class booking.
 *
 * Private students have no group timetable, so this is the only thing that puts
 * classes on their calendar. Saving here shows up on the student's calendar
 * immediately, the same as the group timetable editor.
 */

type Student = {
  id: string;
  name: string;
  email: string;
  level: string;
  studentCode: string | null;
  branchName: string | null;
};

type PrivateClass = {
  id: string;
  scheduledAt: string;
  durationMinutes: number;
  topic: string | null;
  status: string;
  notes: string | null;
  lecturerName: string | null;
  materialTitle: string | null;
};

type Lecturer = { id: string; name: string };
type Material = { id: string; title: string };
type TutorMessage = { id: string; body: string; isMine: boolean; createdAt: string };
type SessionNote = { id: string; summary: string; sessionTopic: string | null; sessionDate: string | null; createdAt: string };

/**
 * Translucent tints rather than solid pastels.
 *
 * `bg-emerald-100` is a fixed near-white; on the Nacht and Dämmerung themes it
 * lands as a bright chip glued to a dark card. A `/15` tint of the same hue
 * takes its lightness from whatever it is sitting on, so one definition works
 * on all three themes instead of looking correct on exactly one of them.
 *
 * Cancelled and postponed are also no longer the same colour. They mean
 * opposite things to a student — one is gone, one is moving — and a tutor
 * scanning a list needs to tell them apart at a glance.
 */
const STATUS_STYLES: Record<string, string> = {
  scheduled: "bg-[var(--surface-alt)] text-[var(--foreground-soft)]",
  completed: "bg-emerald-500/15 text-emerald-600",
  cancelled: "bg-rose-500/15 text-rose-600",
  postponed: "bg-amber-500/15 text-amber-600",
};

/** datetime-local needs "YYYY-MM-DDTHH:mm" in LOCAL time, not an ISO UTC string. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function LecturerPrivateClassesPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<PrivateClass[]>([]);
  const [lecturers, setLecturers] = useState<Lecturer[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [studentId, setStudentId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [when, setWhen] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() + 24, 0, 0, 0);
    return toLocalInput(d);
  });
  const [duration, setDuration] = useState(60);
  const [topic, setTopic] = useState("");
  const [lecturerId, setLecturerId] = useState("");
  const [materialId, setMaterialId] = useState("");

  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [draftMessage, setDraftMessage] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const messageListRef = useRef<HTMLDivElement | null>(null);

  const [notes, setNotes] = useState<SessionNote[]>([]);
  const [draftNote, setDraftNote] = useState("");
  const [notePrivateClassId, setNotePrivateClassId] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = studentId ? `?studentId=${encodeURIComponent(studentId)}` : "";
      const res = await fetch(`/api/lecturer/private-classes${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Unable to load");

      const data = await res.json();
      setStudents(data.students ?? []);
      setClasses(data.classes ?? []);
      setLecturers(data.lecturers ?? []);
      setMaterials(data.materials ?? []);
      setError("");

      // Land on the first private student so the page is never empty for no reason.
      if (!studentId && data.students?.[0]) setStudentId(data.students[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => { load(); }, [load]);

  const loadThread = useCallback(async (id: string) => {
    if (!id) { setMessages([]); setNotes([]); return; }
    try {
      const [msgRes, noteRes] = await Promise.all([
        fetch(`/api/lecturer/tutor-messages?studentId=${encodeURIComponent(id)}`, { cache: "no-store" }),
        fetch(`/api/lecturer/session-notes?studentId=${encodeURIComponent(id)}`, { cache: "no-store" }),
      ]);
      if (msgRes.ok) setMessages((await msgRes.json()).messages ?? []);
      if (noteRes.ok) setNotes((await noteRes.json()).notes ?? []);
    } catch {
      // Left as-is on a failed poll.
    }
  }, []);

  useEffect(() => {
    loadThread(studentId);
    if (!studentId) return;
    const timer = window.setInterval(() => loadThread(studentId), 20_000);
    return () => window.clearInterval(timer);
  }, [studentId, loadThread]);

  useEffect(() => {
    messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight });
  }, [messages]);

  async function sendMessage() {
    const text = draftMessage.trim();
    if (!text || !studentId || sendingMessage) return;
    setSendingMessage(true);
    setDraftMessage("");
    try {
      const res = await fetch("/api/lecturer/tutor-messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ studentId, body: text }),
      });
      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => [...prev, data.message]);
      } else {
        setDraftMessage(text);
      }
    } catch {
      setDraftMessage(text);
    } finally {
      setSendingMessage(false);
    }
  }

  async function addNote() {
    const text = draftNote.trim();
    if (!text || !studentId || savingNote) return;
    setSavingNote(true);
    try {
      const res = await fetch("/api/lecturer/session-notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ studentId, summary: text, privateClassId: notePrivateClassId || undefined }),
      });
      if (res.ok) {
        setDraftNote("");
        setNotePrivateClassId("");
        await loadThread(studentId);
      }
    } finally {
      setSavingNote(false);
    }
  }

  async function book() {
    if (!studentId || !when) return;
    setBusy(true);
    try {
      const res = await fetch("/api/lecturer/private-classes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          studentId,
          scheduledAt: new Date(when).toISOString(),
          durationMinutes: duration,
          topic,
          lecturerId: lecturerId || undefined,
          materialId: materialId || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not book");

      setTopic("");
      setError("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not book");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/lecturer/private-classes", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not update");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update");
    } finally {
      setBusy(false);
    }
  }

  const selected = students.find((s) => s.id === studentId);

  return (
    <LecturerShell>
      <div className="p-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Private classes</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            One-to-one students follow no group timetable, so what you book here is their whole
            calendar. They see changes straight away.
          </p>
        </div>

        {/* A one-to-one already in progress, with the one student on its guest
            list and whether they have answered. Nothing renders when idle. */}
        <TutorLivePanel className="mb-6" />

        {error && <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-rose-600">{error}</div>}

        {loading ? (
          <div className="py-12 text-center text-[var(--muted)]">Loading…</div>
        ) : students.length === 0 ? (
          <div className="py-12 text-center">
            <PrivateClassIcon className="mx-auto h-9 w-9 text-[var(--muted)]" />
            <p className="mt-2 font-semibold">No private students yet</p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              A student becomes private when their class type is set to private on their record.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <label className="block text-sm font-semibold text-[var(--foreground-soft)]">Student</label>
              <select
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                className="mt-1 rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground)]"
              >
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.level}
                    {s.branchName ? ` · ${s.branchName}` : ""}
                  </option>
                ))}
              </select>
              {selected?.studentCode && (
                <p className="mt-1 font-mono text-xs text-[var(--muted)]">{selected.studentCode}</p>
              )}
            </div>

            <div className="mb-8 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
              <h2 className="font-semibold">Book a class</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <label>
                  <span className="text-xs font-medium text-[var(--foreground-soft)]">Date and time</span>
                  <input
                    type="datetime-local"
                    value={when}
                    onChange={(e) => setWhen(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground)]"
                  />
                </label>
                <label>
                  <span className="text-xs font-medium text-[var(--foreground-soft)]">Minutes</span>
                  <input
                    type="number"
                    min={15}
                    step={15}
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground)]"
                  />
                </label>
                <label>
                  <span className="text-xs font-medium text-[var(--foreground-soft)]">Tutor</span>
                  <select
                    value={lecturerId}
                    onChange={(e) => setLecturerId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground)]"
                  >
                    <option value="">Me</option>
                    {lecturers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </label>
                <label className="sm:col-span-2">
                  <span className="text-xs font-medium text-[var(--foreground-soft)]">Topic</span>
                  <input
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="What this session covers"
                    className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground)]"
                  />
                </label>
                <label>
                  <span className="text-xs font-medium text-[var(--foreground-soft)]">Material</span>
                  <select
                    value={materialId}
                    onChange={(e) => setMaterialId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground)]"
                  >
                    <option value="">None</option>
                    {materials.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                  </select>
                </label>
              </div>
              <button
                onClick={book}
                disabled={busy || !when}
                className="mt-4 rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
              >
                {busy ? "Saving…" : "Book class"}
              </button>
            </div>

            <h2 className="mb-3 text-lg font-semibold">Booked sessions</h2>
            {classes.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--muted)]">
                Nothing booked for this student yet.
              </p>
            ) : (
              <div className="space-y-2">
                {classes.map((c) => {
                  const start = new Date(c.scheduledAt);
                  const end = new Date(start.getTime() + c.durationMinutes * 60_000);
                  return (
                    <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold">{start.toLocaleString()}</span>
                          <span className="text-xs text-[var(--muted)]">
                            to {end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[c.status] ?? STATUS_STYLES.scheduled}`}>
                            {c.status}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-[var(--foreground-soft)]">
                          {c.topic || <span className="italic text-[var(--muted)]">No topic set</span>}
                          {c.lecturerName && <span className="text-[var(--muted)]"> · {c.lecturerName}</span>}
                        </p>
                        {c.materialTitle && <p className="mt-1 flex items-center gap-1.5 text-xs text-blue-600"><AttachmentIcon className="h-3.5 w-3.5" /> {c.materialTitle}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                      {/*
                        START NOW, and only on a session that is still ahead.
                        A one-to-one has no cohort to fall back on: if the tutor
                        does not open the room, the room does not exist, and the
                        student sits in the portal watching nothing happen.
                        Opening it rings that student BY NAME — they are the
                        guest list, so nobody else can get a token for it.

                        Hidden once completed or cancelled, because "start" on a
                        class that already happened is only ever a misclick.
                      */}
                      {(c.status === "scheduled" || c.status === "postponed") && (
                        <a
                          href={`/live?privateClassId=${c.id}`}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-[#0D7C7E] px-3.5 py-1.5 text-sm font-semibold text-white transition hover:brightness-110"
                        >
                          <BroadcastIcon className="h-3.5 w-3.5" />
                          Start &amp; ring
                        </a>
                      )}
                      <select
                        value={c.status}
                        onChange={(e) => setStatus(c.id, e.target.value)}
                        disabled={busy}
                        className="rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-1.5 text-sm text-[var(--foreground)]"
                      >
                        <option value="scheduled">Scheduled</option>
                        <option value="completed">Completed</option>
                        <option value="postponed">Postponed</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-8 grid gap-6 lg:grid-cols-2">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
                <h2 className="font-semibold">Message {selected?.name || "this student"}</h2>
                <p className="mt-1 text-xs text-[var(--muted)]">Goes straight to them, nowhere else.</p>
                <div ref={messageListRef} className="mt-4 max-h-64 space-y-2 overflow-y-auto pr-1">
                  {messages.length === 0 ? (
                    <p className="py-6 text-center text-sm text-[var(--muted)]">No messages yet.</p>
                  ) : (
                    messages.map((m) => (
                      <div key={m.id} className={`flex ${m.isMine ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-5 ${
                            m.isMine ? "bg-[var(--accent)] text-white" : "border border-[var(--border)] bg-[var(--surface-alt)] text-[var(--foreground)]"
                          }`}
                        >
                          {m.body}
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <input
                    value={draftMessage}
                    onChange={(e) => setDraftMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void sendMessage();
                      }
                    }}
                    disabled={!studentId}
                    placeholder="Type a message…"
                    className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground)] disabled:opacity-50"
                  />
                  <button
                    onClick={() => void sendMessage()}
                    disabled={!studentId || !draftMessage.trim() || sendingMessage}
                    className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-[var(--accent)] text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Send"
                  >
                    <SendIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
                <h2 className="font-semibold">Session notes</h2>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  What you write here is what {selected?.name || "the student"} sees as proof of what a session covered.
                </p>
                <div className="mt-4 space-y-3">
                  <textarea
                    value={draftNote}
                    onChange={(e) => setDraftNote(e.target.value)}
                    disabled={!studentId}
                    placeholder="We covered separable verbs and practised ordering food…"
                    rows={3}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground)] disabled:opacity-50"
                  />
                  <div className="flex items-center gap-2">
                    <select
                      value={notePrivateClassId}
                      onChange={(e) => setNotePrivateClassId(e.target.value)}
                      disabled={!studentId}
                      className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground)] disabled:opacity-50"
                    >
                      <option value="">No linked session</option>
                      {classes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {new Date(c.scheduledAt).toLocaleDateString()} — {c.topic || "Untitled"}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => void addNote()}
                      disabled={!studentId || !draftNote.trim() || savingNote}
                      className="shrink-0 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {savingNote ? "Saving…" : "Add note"}
                    </button>
                  </div>
                </div>

                <div className="mt-5 space-y-3">
                  {notes.length === 0 ? (
                    <p className="py-4 text-center text-sm text-[var(--muted)]">No notes written yet.</p>
                  ) : (
                    notes.map((n) => (
                      <div key={n.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] p-3.5">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-[var(--foreground)]">{n.sessionTopic || "Coaching session"}</p>
                          <span className="shrink-0 text-xs text-[var(--muted)]">{new Date(n.sessionDate || n.createdAt).toLocaleDateString()}</span>
                        </div>
                        <p className="mt-1.5 text-sm text-[var(--foreground-soft)]">{n.summary}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </LecturerShell>
  );
}
