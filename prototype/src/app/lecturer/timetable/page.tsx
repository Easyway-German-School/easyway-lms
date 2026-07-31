"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import LecturerShell from "@/components/LecturerShell";
import { AttachmentIcon } from "@/components/icons";
import { LEVELS } from "@/lib/levels";

/**
 * Tutor timetable editor.
 *
 * The rotation engine decides which days a cohort meets; this is where a tutor
 * says what actually happens on those days. Saving writes a ClassSession row
 * that students see on their own calendar straight away.
 */

type Material = { id: string; title: string; fileType: string; course: { level: string } | null };
type Branch = { id: string; name: string };

type Session = {
  date: string;
  weekday: string;
  title: string;
  defaultFocus: string;
  timeSlot: string;
  startTime: string;
  endTime: string;
  topic: string | null;
  notes: string | null;
  status: string;
  edited: boolean;
  material: { id: string; title: string } | null;
};

type Month = { label: string; sessions: Session[] };

const STATUS_STYLES: Record<string, string> = {
  scheduled: "bg-slate-100 text-slate-700",
  postponed: "bg-red-100 text-red-700",
  cancelled: "bg-red-100 text-red-700",
  held: "bg-emerald-100 text-emerald-700",
};

export default function LecturerTimetablePage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [months, setMonths] = useState<Month[]>([]);
  const [branchId, setBranchId] = useState("");
  const [level, setLevel] = useState("A1");
  const [slot, setSlot] = useState("morning");
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Session | null>(null);

  // Load the branch list once, then the timetable whenever the filters change.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/branches", { cache: "no-store" });
        const data = await res.json();
        const list: Branch[] = data.branches ?? [];
        setBranches(list);
        if (list[0]) setBranchId(list[0].id);
      } catch {
        setError("Unable to load branches");
      }
    })();
  }, []);

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/lecturer/sessions?branchId=${encodeURIComponent(branchId)}&level=${encodeURIComponent(level)}&slot=${encodeURIComponent(slot)}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("Unable to load the timetable");
      const data = await res.json();
      setMonths(data.months ?? []);
      setMaterials(data.materials ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [branchId, level, slot]);

  useEffect(() => { load(); }, [load]);

  async function save(session: Session, patch: Partial<Session> & { materialId?: string | null }) {
    setSavingKey(session.date);
    try {
      const res = await fetch("/api/lecturer/sessions", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          branchId,
          level,
          date: session.date,
          // The sitting comes from the page filter, never from the row: it is
          // part of the row's identity, so editing it here would silently move
          // the day into a different class.
          timeSlot: slot,
          topic: patch.topic ?? session.topic,
          notes: patch.notes ?? session.notes,
          status: patch.status ?? session.status,
          startTime: patch.startTime ?? session.startTime,
          endTime: patch.endTime ?? session.endTime,
          materialId: patch.materialId !== undefined ? patch.materialId : session.material?.id ?? null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not save");
      await load();
      setEditing(null);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSavingKey(null);
    }
  }

  const levelMaterials = materials.filter((m) => !m.course?.level || m.course.level === level);

  return (
    <LecturerShell>
      <div className="p-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Class timetable</h1>
          <p className="mt-1 text-sm text-slate-500">
            Set the day&apos;s topic, times and materials. Students see your changes on their calendar straight away.
          </p>
        </div>

        <div className="mb-6 flex flex-wrap gap-3">
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="rounded-lg border px-3 py-2 text-sm">
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select value={level} onChange={(e) => setLevel(e.target.value)} className="rounded-lg border px-3 py-2 text-sm">
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <select value={slot} onChange={(e) => setSlot(e.target.value)} className="rounded-lg border px-3 py-2 text-sm">
            <option value="morning">Morning session</option>
            <option value="afternoon">Afternoon session</option>
            <option value="evening">Evening session</option>
          </select>
        </div>

        <p className="mb-4 text-xs text-slate-500">
          You are editing the <strong className="capitalize">{slot}</strong> sitting. The same level at a
          different sitting is a separate class with its own topics — switch above to edit it.
        </p>

        {error && <div className="mb-4 rounded bg-red-100 p-4 text-red-700">{error}</div>}

        {loading ? (
          <div className="py-12 text-center text-slate-500">Loading timetable…</div>
        ) : months.length === 0 ? (
          <div className="py-12 text-center text-slate-500">No classes generated for this cohort.</div>
        ) : (
          <div className="space-y-8">
            {months.map((month) => (
              <div key={month.label}>
                <h2 className="mb-3 text-lg font-semibold">{month.label}</h2>
                <div className="space-y-2">
                  {month.sessions.map((s) => {
                    const isEditing = editing?.date === s.date;
                    return (
                      <div key={s.date} className="rounded-xl border bg-white p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold">
                                {s.weekday} {new Date(s.date).toLocaleDateString()}
                              </span>
                              <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[s.status] ?? STATUS_STYLES.scheduled}`}>
                                {s.status}
                              </span>
                              <span className="text-xs text-slate-500">{s.startTime}–{s.endTime}</span>
                              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs capitalize text-slate-600">{s.timeSlot}</span>
                            </div>
                            <p className="mt-1 truncate text-sm text-slate-600">
                              {s.topic || <span className="italic text-slate-400">{s.defaultFocus}</span>}
                            </p>
                            {s.material && (
                              <p className="mt-1 flex items-center gap-1.5 text-xs text-blue-600"><AttachmentIcon className="h-3.5 w-3.5" /> {s.material.title}</p>
                            )}
                          </div>
                          <button
                            onClick={() => setEditing(isEditing ? null : s)}
                            className="shrink-0 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
                          >
                            {isEditing ? "Close" : "Edit"}
                          </button>
                        </div>

                        {isEditing && (
                          <div className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2">
                            <label className="sm:col-span-2">
                              <span className="text-xs font-medium text-slate-600">Topic for this class</span>
                              <input
                                defaultValue={s.topic ?? ""}
                                placeholder={s.defaultFocus}
                                onChange={(e) => setEditing({ ...editing!, topic: e.target.value })}
                                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                              />
                            </label>

                            <label>
                              <span className="text-xs font-medium text-slate-600">Status</span>
                              <select
                                defaultValue={s.status}
                                onChange={(e) => setEditing({ ...editing!, status: e.target.value })}
                                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                              >
                                <option value="scheduled">Scheduled</option>
                                <option value="postponed">Postponed</option>
                                <option value="cancelled">Cancelled</option>
                                <option value="held">Held</option>
                              </select>
                            </label>

                            <label>
                              <span className="text-xs font-medium text-slate-600">Starts</span>
                              <input
                                type="time"
                                defaultValue={s.startTime}
                                onChange={(e) => setEditing({ ...editing!, startTime: e.target.value })}
                                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                              />
                            </label>

                            <label>
                              <span className="text-xs font-medium text-slate-600">Ends</span>
                              <input
                                type="time"
                                defaultValue={s.endTime}
                                onChange={(e) => setEditing({ ...editing!, endTime: e.target.value })}
                                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                              />
                            </label>

                            <label className="sm:col-span-2">
                              <span className="text-xs font-medium text-slate-600">Material for this class</span>
                              <select
                                defaultValue={s.material?.id ?? ""}
                                onChange={(e) => setEditing({ ...editing!, material: e.target.value ? { id: e.target.value, title: "" } : null })}
                                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                              >
                                <option value="">No material</option>
                                {levelMaterials.map((m) => (
                                  <option key={m.id} value={m.id}>{m.title}</option>
                                ))}
                              </select>
                            </label>

                            <div className="sm:col-span-2">
                              <button
                                onClick={() => save(s, { ...editing!, materialId: editing?.material?.id ?? null })}
                                disabled={savingKey === s.date}
                                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                              >
                                {savingKey === s.date ? "Saving…" : "Save class"}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </LecturerShell>
  );
}
