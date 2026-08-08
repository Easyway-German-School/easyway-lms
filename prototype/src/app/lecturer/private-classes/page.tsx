"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import LecturerShell from "@/components/LecturerShell";
import TutorLivePanel from "@/components/live/TutorLivePanel";
import { AttachmentIcon, BroadcastIcon, PrivateClassIcon } from "@/components/icons";

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

const STATUS_STYLES: Record<string, string> = {
  scheduled: "bg-slate-100 text-slate-700",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-700",
  postponed: "bg-red-100 text-red-700",
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
          <p className="mt-1 text-sm text-slate-500">
            One-to-one students follow no group timetable, so what you book here is their whole
            calendar. They see changes straight away.
          </p>
        </div>

        {/* A one-to-one already in progress, with the one student on its guest
            list and whether they have answered. Nothing renders when idle. */}
        <TutorLivePanel className="mb-6" />

        {error && <div className="mb-4 rounded bg-red-100 p-4 text-red-700">{error}</div>}

        {loading ? (
          <div className="py-12 text-center text-slate-500">Loading…</div>
        ) : students.length === 0 ? (
          <div className="py-12 text-center">
            <PrivateClassIcon className="mx-auto h-9 w-9 text-[var(--muted)]" />
            <p className="mt-2 font-semibold">No private students yet</p>
            <p className="mt-1 text-sm text-slate-500">
              A student becomes private when their class type is set to private on their record.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <label className="block text-sm font-semibold text-slate-600">Student</label>
              <select
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                className="mt-1 rounded-lg border px-3 py-2 text-sm"
              >
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.level}
                    {s.branchName ? ` · ${s.branchName}` : ""}
                  </option>
                ))}
              </select>
              {selected?.studentCode && (
                <p className="mt-1 font-mono text-xs text-slate-500">{selected.studentCode}</p>
              )}
            </div>

            <div className="mb-8 rounded-xl border bg-white p-6">
              <h2 className="font-semibold">Book a class</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <label>
                  <span className="text-xs font-medium text-slate-600">Date and time</span>
                  <input
                    type="datetime-local"
                    value={when}
                    onChange={(e) => setWhen(e.target.value)}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </label>
                <label>
                  <span className="text-xs font-medium text-slate-600">Minutes</span>
                  <input
                    type="number"
                    min={15}
                    step={15}
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </label>
                <label>
                  <span className="text-xs font-medium text-slate-600">Tutor</span>
                  <select
                    value={lecturerId}
                    onChange={(e) => setLecturerId(e.target.value)}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  >
                    <option value="">Me</option>
                    {lecturers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </label>
                <label className="sm:col-span-2">
                  <span className="text-xs font-medium text-slate-600">Topic</span>
                  <input
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="What this session covers"
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </label>
                <label>
                  <span className="text-xs font-medium text-slate-600">Material</span>
                  <select
                    value={materialId}
                    onChange={(e) => setMaterialId(e.target.value)}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  >
                    <option value="">None</option>
                    {materials.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                  </select>
                </label>
              </div>
              <button
                onClick={book}
                disabled={busy || !when}
                className="mt-4 rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {busy ? "Saving…" : "Book class"}
              </button>
            </div>

            <h2 className="mb-3 text-lg font-semibold">Booked sessions</h2>
            {classes.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">
                Nothing booked for this student yet.
              </p>
            ) : (
              <div className="space-y-2">
                {classes.map((c) => {
                  const start = new Date(c.scheduledAt);
                  const end = new Date(start.getTime() + c.durationMinutes * 60_000);
                  return (
                    <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold">{start.toLocaleString()}</span>
                          <span className="text-xs text-slate-500">
                            to {end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[c.status] ?? STATUS_STYLES.scheduled}`}>
                            {c.status}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-slate-600">
                          {c.topic || <span className="italic text-slate-400">No topic set</span>}
                          {c.lecturerName && <span className="text-slate-400"> · {c.lecturerName}</span>}
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
                        className="rounded-lg border px-3 py-1.5 text-sm"
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
          </>
        )}
      </div>
    </LecturerShell>
  );
}
