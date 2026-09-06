"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ScheduleCalendar, { type DayCell, type Tone } from "@/components/schedule/ScheduleCalendar";
import UndoToast, { type PendingUndo } from "@/components/schedule/UndoToast";
import { ymd, monthStart, monthEnd } from "@/components/schedule/grid";
import { SCHOOL_TIMEZONE, zonedClock, zonedDateKey, zonedTimeToInstant } from "@/lib/school-time";
import { ClockIcon } from "@/components/icons";

/**
 * The private tutor's month view — every one-to-one session across all of
 * their students, one gold dot per class. Drag a dot to reschedule, or open a
 * day and change its date/time inline. The full message thread and session
 * notes stay on the List view (Open messaging jumps there).
 */

type Cls = {
  id: string;
  studentId: string;
  studentName: string;
  scheduledAt: string;
  durationMinutes: number;
  topic: string | null;
  status: string;
  deliveryMode: string | null;
};

const STATUS_STYLES: Record<string, string> = {
  scheduled: "bg-[var(--surface-alt)] text-[var(--foreground-soft)]",
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200",
  postponed: "bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-200",
  reschedule_requested: "bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-200",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200",
  cancel_requested: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200",
  skipped: "bg-slate-200 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300",
};

const LEGEND = [
  { tone: "gold" as Tone, label: "One-to-one" },
  { tone: "pink" as Tone, label: "Reschedule pending" },
  { tone: "red" as Tone, label: "Cancelled" },
  { tone: "emerald" as Tone, label: "Completed" },
];

function tone(status: string): Tone {
  if (status === "cancelled" || status === "declined" || status === "cancel_requested" || status === "skipped") return "red";
  if (status === "postponed" || status === "reschedule_requested") return "pink";
  if (status === "completed") return "emerald";
  return "gold";
}
function longDay(k: string): string {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}
function shortDay(k: string): string {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
function clockOf(iso: string): string {
  return zonedClock(new Date(iso), SCHOOL_TIMEZONE);
}
function instant(day: string, clock: string): string {
  return zonedTimeToInstant(day, clock, SCHOOL_TIMEZONE).toISOString();
}

type Draft = { day: string; start: string; durationMinutes: number; status: string; topic: string | null };

export default function PrivateClassCalendar({ onOpenStudent }: { onOpenStudent: (studentId: string) => void }) {
  const [cursor, setCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [classes, setClasses] = useState<Cls[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<PendingUndo | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const from = new Date(monthStart(cursor));
    from.setDate(from.getDate() - 7);
    const to = new Date(monthEnd(cursor));
    to.setDate(to.getDate() + 7);
    try {
      const res = await fetch(
        `/api/lecturer/private-classes?from=${from.toISOString()}&to=${to.toISOString()}`,
        { cache: "no-store" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not load your private classes");
      setClasses(data.calendarClasses ?? []);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load your private classes");
    } finally {
      setLoading(false);
    }
  }, [cursor]);

  useEffect(() => {
    load();
  }, [load]);

  const byDay = useMemo(() => {
    const map = new Map<string, Cls[]>();
    for (const c of classes) {
      const key = zonedDateKey(new Date(c.scheduledAt), SCHOOL_TIMEZONE);
      (map.get(key) ?? map.set(key, []).get(key)!).push(c);
    }
    for (const list of map.values()) list.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
    return map;
  }, [classes]);

  const days = useMemo(() => {
    const map = new Map<string, DayCell>();
    for (const [key, list] of byDay) {
      map.set(key, { dots: list.map((c) => ({ tone: tone(c.status), key: `p:${c.id}` })) });
    }
    return map;
  }, [byDay]);

  const dayClasses = selectedDay ? byDay.get(selectedDay) ?? [] : [];

  async function put(id: string, body: Record<string, unknown>) {
    const res = await fetch("/api/lecturer/private-classes", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Could not save");
  }

  async function save(c: Cls) {
    if (!draft) return;
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const before = { scheduledAt: c.scheduledAt, durationMinutes: c.durationMinutes, status: c.status, topic: c.topic };
      await put(c.id, {
        scheduledAt: instant(draft.day, draft.start),
        durationMinutes: draft.durationMinutes,
        status: draft.status,
        topic: draft.topic,
      });
      setSaved("Saved. The student has been told.");
      setUndo({
        label: `Moved ${c.studentName}'s session`,
        run: async () => {
          await put(c.id, before);
          await load();
        },
      });
      setEditingId(null);
      setDraft(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function rescheduleDot(dotId: string, fromDay: string, toDay: string) {
    const c = classes.find((x) => `p:${x.id}` === dotId);
    if (!c) return;
    const shift =
      new Date(`${toDay}T00:00:00`).getTime() - new Date(`${fromDay || ymd(new Date(c.scheduledAt))}T00:00:00`).getTime();
    const nextIso = new Date(new Date(c.scheduledAt).getTime() + shift).toISOString();
    const before = { scheduledAt: c.scheduledAt };
    setError("");
    try {
      await put(c.id, { scheduledAt: nextIso });
      setUndo({
        label: `Moved ${c.studentName}'s session to ${shortDay(toDay)}`,
        run: async () => {
          await put(c.id, before);
          await load();
        },
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not move this class");
      await load();
    }
  }

  const rail = (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      {!selectedDay ? (
        <p className="py-8 text-center text-sm text-[var(--muted)]">Tap a day to see its sessions.</p>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-bold text-[var(--foreground)]">{longDay(selectedDay)}</h3>
            <button
              type="button"
              onClick={() => setSelectedDay(null)}
              className="text-xs font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              Close
            </button>
          </div>
          {error && <p className="mt-2 rounded-lg bg-rose-500/10 p-2 text-xs text-rose-600">{error}</p>}
          {saved && <p className="mt-2 rounded-lg bg-emerald-500/10 p-2 text-xs text-emerald-600">{saved}</p>}

          {dayClasses.length === 0 && <p className="mt-3 text-sm text-[var(--muted)]">Nothing booked this day.</p>}

          <div className="mt-3 space-y-2">
            {dayClasses.map((c) => {
              const isEditing = editingId === c.id;
              return (
                <div key={c.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] p-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (isEditing) {
                        setEditingId(null);
                        setDraft(null);
                      } else {
                        setEditingId(c.id);
                        setDraft({
                          day: zonedDateKey(new Date(c.scheduledAt), SCHOOL_TIMEZONE),
                          start: clockOf(c.scheduledAt),
                          durationMinutes: c.durationMinutes,
                          status: ["scheduled", "completed", "cancelled"].includes(c.status) ? c.status : "scheduled",
                          topic: c.topic,
                        });
                        setError("");
                        setSaved("");
                      }
                    }}
                    className="flex w-full items-start justify-between gap-2 text-left"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--foreground)]">{c.studentName}</p>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--muted)]">
                        <ClockIcon className="h-3.5 w-3.5" />
                        {clockOf(c.scheduledAt)} · {c.durationMinutes} min
                        {c.deliveryMode ? ` · ${c.deliveryMode}` : ""}
                      </p>
                      <span
                        className={`mt-1 inline-block rounded px-2 py-0.5 text-xs font-medium capitalize ${
                          STATUS_STYLES[c.status] ?? STATUS_STYLES.scheduled
                        }`}
                      >
                        {c.status.replace("_", " ")}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-[#B28A22]">{isEditing ? "Close" : "Edit"}</span>
                  </button>

                  {isEditing && draft && (
                    <div className="mt-3 grid gap-3 border-t border-[var(--border)] pt-3">
                      <div className="grid grid-cols-2 gap-3">
                        <label>
                          <span className="text-xs font-medium text-[var(--muted)]">Day</span>
                          <input
                            type="date"
                            value={draft.day}
                            onChange={(e) => setDraft({ ...draft, day: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                          />
                        </label>
                        <label>
                          <span className="text-xs font-medium text-[var(--muted)]">Starts</span>
                          <input
                            type="time"
                            value={draft.start}
                            onChange={(e) => setDraft({ ...draft, start: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                          />
                        </label>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <label>
                          <span className="text-xs font-medium text-[var(--muted)]">Minutes</span>
                          <input
                            type="number"
                            min={15}
                            max={240}
                            step={15}
                            value={draft.durationMinutes}
                            onChange={(e) => setDraft({ ...draft, durationMinutes: Number(e.target.value) || 60 })}
                            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                          />
                        </label>
                        <label>
                          <span className="text-xs font-medium text-[var(--muted)]">Status</span>
                          <select
                            value={draft.status}
                            onChange={(e) => setDraft({ ...draft, status: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                          >
                            <option value="scheduled">Scheduled</option>
                            <option value="completed">Completed</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                        </label>
                      </div>
                      <label>
                        <span className="text-xs font-medium text-[var(--muted)]">Topic</span>
                        <input
                          defaultValue={c.topic ?? ""}
                          onChange={(e) => setDraft({ ...draft, topic: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                        />
                      </label>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => save(c)}
                          disabled={busy || !draft.day}
                          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                        >
                          {busy ? "Saving…" : "Save"}
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenStudent(c.studentId)}
                          className="text-xs font-semibold text-[#B28A22] hover:underline"
                        >
                          Messaging & notes
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );

  return (
    <>
      {loading && <p className="mb-3 text-sm text-[var(--muted)]">Loading…</p>}
      <ScheduleCalendar
        cursor={cursor}
        onCursor={setCursor}
        days={days}
        selected={selectedDay}
        onSelect={(day) => {
          setSelectedDay(day);
          setEditingId(null);
          setDraft(null);
        }}
        legend={LEGEND}
        rail={rail}
        onMoveDot={rescheduleDot}
        dotLabel={(dotId) => {
          const c = classes.find((x) => `p:${x.id}` === dotId);
          return c ? c.studentName : "Move";
        }}
      />
      <UndoToast undo={undo} onClose={() => setUndo(null)} />
    </>
  );
}
