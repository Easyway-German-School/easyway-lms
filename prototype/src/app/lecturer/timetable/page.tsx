"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useMemo, useState } from "react";
import PortalShell from "@/components/PortalShell";
import ScheduleCalendar, { type DayCell, type Tone } from "@/components/schedule/ScheduleCalendar";
import { ymd } from "@/components/schedule/grid";
import { AttachmentIcon, CalendarIcon, ClockIcon, PlusIcon } from "@/components/icons";

/**
 * Tutor timetable — the calendar the tutor runs their week from.
 *
 * The rotation engine still decides which days a cohort meets; this is where a
 * tutor says what actually happens on those days, and where they can drop in an
 * extra one-off class. Saving writes a ClassSession row that lands on every
 * student's calendar straight away, and — for a postponement, a cancellation, a
 * new material or a time change — notifies them, because a class that quietly
 * moves is a class people turn up for.
 *
 * The month grid is deliberately near-textless: a dot per class, coloured by
 * status. Everything you can change lives in the day rail on the right.
 */

type Material = { id: string; title: string; fileType: string; course: { level: string } | null };
type Branch = { id: string; name: string; mode: string };

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
  postponedTo: string | null;
  edited: boolean;
  material: { id: string; title: string } | null;
};

type Month = { label: string; sessions: Session[] };

type Assignment = {
  branchIds: string[];
  levels: string[];
  sessionSlots: string[];
  groups: Array<{ branchId: string; level: string; sessionSlot: string }>;
  classTypes: string[];
  batches: string[];
};

type ClosedDay = { id: string; date: string; label: string; branchId: string | null };

const STATUS_STYLES: Record<string, string> = {
  scheduled: "bg-[var(--surface-alt)] text-[var(--foreground-soft)]",
  postponed: "bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-200",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200",
  held: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200",
};

/** Dot colour on the grid, one per class, by status. */
const STATUS_TONE: Record<string, Tone> = {
  scheduled: "accent",
  postponed: "pink",
  cancelled: "red",
  held: "emerald",
};

const SLOT_LABELS: Record<string, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  weekend: "Weekend",
};

const LEGEND = [
  { tone: "accent" as Tone, label: "Scheduled" },
  { tone: "pink" as Tone, label: "Postponed" },
  { tone: "red" as Tone, label: "Cancelled" },
  { tone: "emerald" as Tone, label: "Held" },
];

function toDateInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function longDay(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export default function LecturerTimetablePage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [months, setMonths] = useState<Month[]>([]);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [canChooseCohort, setCanChooseCohort] = useState(false);
  const [closedDays, setClosedDays] = useState<ClosedDay[]>([]);

  const [branchId, setBranchId] = useState("");
  const [level, setLevel] = useState("");
  const [slot, setSlot] = useState("");

  const [cursor, setCursor] = useState(() => new Date());
  const [cursorPinned, setCursorPinned] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [editing, setEditing] = useState<Session | null>(null);

  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState({ date: "", startTime: "", endTime: "", topic: "" });
  const [addBusy, setAddBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (branchId) query.set("branchId", branchId);
      if (level) query.set("level", level);
      if (slot) query.set("slot", slot);

      const res = await fetch(`/api/lecturer/sessions?${query.toString()}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Unable to load the timetable");

      setMonths(data.months ?? []);
      setMaterials(data.materials ?? []);
      setBranches(data.branches ?? []);
      setAssignment(data.assignment ?? null);
      setCanChooseCohort(Boolean(data.canChooseCohort));

      if (data.context) {
        setBranchId((current) => current || data.context.branchId || "");
        setLevel((current) => current || data.context.level || "");
        setSlot((current) => current || data.context.slot || "");
      }
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [branchId, level, slot]);

  useEffect(() => {
    load();
  }, [load]);

  // Closed days are refetched when the branch changes so a branch-specific
  // holiday shows on the right calendar.
  useEffect(() => {
    const query = branchId ? `?branchId=${encodeURIComponent(branchId)}` : "";
    fetch(`/api/schedule/closed-days${query}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setClosedDays(data.closedDays ?? []))
      .catch(() => {});
  }, [branchId]);

  const allSessions = useMemo(() => months.flatMap((m) => m.sessions), [months]);

  // Land the tutor on the month their course actually runs in, once.
  useEffect(() => {
    if (cursorPinned || allSessions.length === 0) return;
    const now = new Date();
    const upcoming = allSessions.find((s) => new Date(s.date) >= new Date(now.getFullYear(), now.getMonth(), 1));
    const target = new Date((upcoming ?? allSessions[0]).date);
    setCursor(new Date(target.getFullYear(), target.getMonth(), 1));
  }, [allSessions, cursorPinned]);

  const sessionsByDay = useMemo(() => {
    const map = new Map<string, Session[]>();
    for (const s of allSessions) {
      const key = ymd(new Date(s.date));
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.startTime.localeCompare(b.startTime));
    return map;
  }, [allSessions]);

  const days = useMemo(() => {
    const map = new Map<string, DayCell>();
    for (const [key, list] of sessionsByDay) {
      map.set(key, {
        dots: list.map((s, i) => ({ tone: STATUS_TONE[s.status] ?? "accent", key: `${key}-${i}` })),
      });
    }
    for (const holiday of closedDays) {
      const key = ymd(new Date(holiday.date));
      const existing = map.get(key);
      map.set(key, { dots: existing?.dots ?? [], closed: { label: holiday.label } });
    }
    return map;
  }, [sessionsByDay, closedDays]);

  const selectedSessions = selectedDay ? sessionsByDay.get(selectedDay) ?? [] : [];
  const selectedClosed = selectedDay ? closedDays.find((h) => ymd(new Date(h.date)) === selectedDay) : undefined;

  const levelMaterials = materials.filter((item) => !item.course?.level || item.course.level === level);
  const branchName = branches.find((branch) => branch.id === branchId)?.name ?? "—";
  const hasClass = Boolean(branchId && level);

  const groupsForBranch = (assignment?.groups ?? []).filter((group) => !branchId || group.branchId === branchId);
  const selectableBranches = branches;
  const selectableLevels = canChooseCohort
    ? ["A1", "A2", "B1", "B2", "C1", "C2"]
    : assignment?.groups?.length
      ? [...new Set(groupsForBranch.map((group) => group.level))]
      : (assignment?.levels ?? []);
  const selectableSlots = canChooseCohort
    ? ["morning", "afternoon", "evening", "weekend"]
    : assignment?.groups?.length
      ? [...new Set(groupsForBranch.filter((group) => group.level === level).map((group) => group.sessionSlot))]
      : assignment?.sessionSlots.length
        ? assignment.sessionSlots
        : ["morning", "afternoon", "evening", "weekend"];

  async function save(session: Session, patch: Partial<Session> & { materialId?: string | null }) {
    setSavingKey(session.date);
    setSaved("");
    try {
      const nextStatus = patch.status ?? session.status;
      const res = await fetch("/api/lecturer/sessions", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          branchId,
          level,
          date: session.date,
          timeSlot: slot,
          topic: patch.topic ?? session.topic,
          notes: patch.notes ?? session.notes,
          status: nextStatus,
          startTime: patch.startTime ?? session.startTime,
          endTime: patch.endTime ?? session.endTime,
          materialId: patch.materialId !== undefined ? patch.materialId : (session.material?.id ?? null),
          postponedTo: nextStatus === "postponed" ? (patch.postponedTo ?? session.postponedTo ?? null) : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save");

      setSaved(
        nextStatus === "postponed"
          ? "Saved. Your students have been told the class moved, and their calendar now shows the new date."
          : nextStatus === "cancelled"
            ? "Saved. Your students have been told the class is cancelled."
            : "Saved. Your students' calendars are updated.",
      );
      await load();
      setEditing(null);
      setError("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save");
    } finally {
      setSavingKey(null);
    }
  }

  async function addClass() {
    if (!addDraft.date) return;
    setAddBusy(true);
    setError("");
    setSaved("");
    try {
      const res = await fetch("/api/lecturer/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          branchId,
          level,
          timeSlot: slot,
          date: `${addDraft.date}T00:00:00`,
          topic: addDraft.topic,
          startTime: addDraft.startTime,
          endTime: addDraft.endTime,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not add this class");
      setSaved("Class added. It is on your students' calendars now.");
      setAdding(false);
      setAddDraft({ date: "", startTime: "", endTime: "", topic: "" });
      setSelectedDay(addDraft.date);
      await load();
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Could not add this class");
    } finally {
      setAddBusy(false);
    }
  }

  function openAdd() {
    setEditing(null);
    setAddDraft({
      date: selectedDay ?? ymd(new Date()),
      startTime: "",
      endTime: "",
      topic: "",
    });
    setAdding(true);
  }

  const rail = (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      {!hasClass ? (
        <p className="text-sm text-[var(--muted)]">
          Pick a class above and its month fills in here.
        </p>
      ) : !selectedDay ? (
        <div className="py-8 text-center">
          <CalendarIcon className="mx-auto h-8 w-8 text-[var(--muted)]" />
          <p className="mt-2 text-sm text-[var(--muted)]">Tap a day to see and edit its classes.</p>
          <button
            type="button"
            onClick={openAdd}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--surface-alt)]"
          >
            <PlusIcon className="h-4 w-4" /> Add a class
          </button>
        </div>
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

          {selectedClosed && (
            <p className="mt-2 rounded-lg bg-[var(--surface-alt)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              {selectedClosed.label} · school closed
            </p>
          )}

          <div className="mt-3 space-y-2">
            {selectedSessions.length === 0 && !selectedClosed && (
              <p className="text-sm text-[var(--muted)]">No class timetabled this day.</p>
            )}

            {selectedSessions.map((session) => {
              const isEditing = editing?.date === session.date;
              return (
                <div key={session.date} className="rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] p-3">
                  <button
                    type="button"
                    onClick={() => {
                      setAdding(false);
                      setEditing(isEditing ? null : session);
                    }}
                    className="flex w-full items-start justify-between gap-2 text-left"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-[var(--surface)] px-1.5 py-0.5 text-xs font-bold text-[var(--foreground)]">
                          {level}
                        </span>
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${
                            STATUS_STYLES[session.status] ?? STATUS_STYLES.scheduled
                          }`}
                        >
                          {session.status}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-sm font-medium text-[var(--foreground)]">
                        {session.topic || <span className="italic text-[var(--muted)]">{session.defaultFocus}</span>}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--muted)]">
                        <ClockIcon className="h-3.5 w-3.5" />
                        {session.startTime}–{session.endTime}
                      </p>
                      {session.status === "postponed" && session.postponedTo && (
                        <p className="mt-0.5 text-xs font-semibold text-pink-700 dark:text-pink-300">
                          Moved to {new Date(session.postponedTo).toLocaleDateString()}
                        </p>
                      )}
                      {session.material && (
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--accent)]">
                          <AttachmentIcon className="h-3.5 w-3.5" /> {session.material.title}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-[var(--accent)]">
                      {isEditing ? "Close" : "Edit"}
                    </span>
                  </button>

                  {isEditing && editing && (
                    <div className="mt-3 grid gap-3 border-t border-[var(--border)] pt-3">
                      <label>
                        <span className="text-xs font-medium text-[var(--muted)]">Topic for this class</span>
                        <input
                          defaultValue={session.topic ?? ""}
                          placeholder={session.defaultFocus}
                          onChange={(event) => setEditing({ ...editing, topic: event.target.value })}
                          className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                        />
                      </label>

                      <div className="grid grid-cols-2 gap-3">
                        <label>
                          <span className="text-xs font-medium text-[var(--muted)]">Status</span>
                          <select
                            value={editing.status}
                            onChange={(event) => setEditing({ ...editing, status: event.target.value })}
                            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                          >
                            <option value="scheduled">Scheduled</option>
                            <option value="postponed">Postponed</option>
                            <option value="cancelled">Cancelled</option>
                            <option value="held">Held</option>
                          </select>
                        </label>

                        {editing.status === "postponed" && (
                          <label>
                            <span className="text-xs font-medium text-pink-700 dark:text-pink-300">Moved to</span>
                            <input
                              type="date"
                              value={toDateInput(editing.postponedTo)}
                              onChange={(event) =>
                                setEditing({
                                  ...editing,
                                  postponedTo: event.target.value ? new Date(event.target.value).toISOString() : null,
                                })
                              }
                              className="mt-1 w-full rounded-lg border border-pink-300 bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                            />
                          </label>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <label>
                          <span className="text-xs font-medium text-[var(--muted)]">Starts</span>
                          <input
                            type="time"
                            defaultValue={session.startTime}
                            onChange={(event) => setEditing({ ...editing, startTime: event.target.value })}
                            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                          />
                        </label>
                        <label>
                          <span className="text-xs font-medium text-[var(--muted)]">Ends</span>
                          <input
                            type="time"
                            defaultValue={session.endTime}
                            onChange={(event) => setEditing({ ...editing, endTime: event.target.value })}
                            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                          />
                        </label>
                      </div>

                      <label>
                        <span className="text-xs font-medium text-[var(--muted)]">Note for your students</span>
                        <textarea
                          defaultValue={session.notes ?? ""}
                          rows={2}
                          placeholder="Bring your workbook · we finish early today"
                          onChange={(event) => setEditing({ ...editing, notes: event.target.value })}
                          className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                        />
                      </label>

                      <label>
                        <span className="text-xs font-medium text-[var(--muted)]">Material for this class</span>
                        <select
                          defaultValue={session.material?.id ?? ""}
                          onChange={(event) =>
                            setEditing({
                              ...editing,
                              material: event.target.value ? { id: event.target.value, title: "" } : null,
                            })
                          }
                          className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                        >
                          <option value="">No material</option>
                          {levelMaterials.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.title}
                            </option>
                          ))}
                        </select>
                      </label>

                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => save(session, { ...editing, materialId: editing.material?.id ?? null })}
                          disabled={savingKey === session.date || (editing.status === "postponed" && !editing.postponedTo)}
                          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {savingKey === session.date ? "Saving…" : "Save class"}
                        </button>
                        {editing.status === "postponed" && !editing.postponedTo && (
                          <span className="text-xs text-pink-700 dark:text-pink-300">Pick the new date before saving.</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {adding ? (
              <div className="rounded-xl border border-[var(--accent)]/40 bg-[var(--surface-alt)] p-3">
                <p className="text-sm font-semibold text-[var(--foreground)]">Add a one-off class</p>
                <div className="mt-3 grid gap-3">
                  <label>
                    <span className="text-xs font-medium text-[var(--muted)]">Date</span>
                    <input
                      type="date"
                      value={addDraft.date}
                      onChange={(event) => setAddDraft({ ...addDraft, date: event.target.value })}
                      className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label>
                      <span className="text-xs font-medium text-[var(--muted)]">Starts</span>
                      <input
                        type="time"
                        value={addDraft.startTime}
                        onChange={(event) => setAddDraft({ ...addDraft, startTime: event.target.value })}
                        className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                      />
                    </label>
                    <label>
                      <span className="text-xs font-medium text-[var(--muted)]">Ends</span>
                      <input
                        type="time"
                        value={addDraft.endTime}
                        onChange={(event) => setAddDraft({ ...addDraft, endTime: event.target.value })}
                        className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                      />
                    </label>
                  </div>
                  <label>
                    <span className="text-xs font-medium text-[var(--muted)]">Topic <span className="font-normal">(optional)</span></span>
                    <input
                      value={addDraft.topic}
                      onChange={(event) => setAddDraft({ ...addDraft, topic: event.target.value })}
                      placeholder="Extra revision class"
                      className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                    />
                  </label>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={addClass}
                      disabled={addBusy || !addDraft.date}
                      className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {addBusy ? "Adding…" : "Add class"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdding(false)}
                      className="text-sm font-medium text-[var(--muted)] hover:text-[var(--foreground)]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={openAdd}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--border)] px-3 py-2.5 text-sm font-semibold text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--foreground)]"
              >
                <PlusIcon className="h-4 w-4" /> Add a class
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );

  const toolbar = hasClass ? (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <span className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
        {canChooseCohort ? "Editing" : "Your class"}
      </span>
      <div className="flex flex-wrap gap-2">
        <Segmented
          value={branchId}
          options={selectableBranches.map((b) => ({ value: b.id, label: b.name }))}
          onChange={setBranchId}
          locked={!canChooseCohort && selectableBranches.length <= 1}
          fallbackLabel={branchName}
        />
        <Segmented
          value={level}
          options={selectableLevels.map((l) => ({ value: l, label: l }))}
          onChange={setLevel}
          locked={selectableLevels.length <= 1}
          fallbackLabel={level}
        />
        <Segmented
          value={slot}
          options={selectableSlots.map((s) => ({ value: s, label: SLOT_LABELS[s] ?? s }))}
          onChange={setSlot}
          locked={selectableSlots.length <= 1}
          fallbackLabel={SLOT_LABELS[slot] ?? slot}
        />
      </div>
    </div>
  ) : null;

  return (
    <PortalShell>
      <div className="h-screen overflow-y-auto">
        <div className="border-b border-[var(--border)] bg-gradient-to-r from-[var(--accent)]/20 to-transparent p-6">
          <div className="mx-auto max-w-6xl">
            <h1 className="flex items-center gap-3 text-2xl font-bold text-[var(--foreground)] sm:text-3xl">
              <CalendarIcon className="h-7 w-7 text-[var(--accent)]" />
              Class timetable
            </h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              A dot for every class, coloured by status. Tap a day to set its topic, times and materials, postpone it,
              or add a one-off. What you save is what your students see.
            </p>
          </div>
        </div>

        <div className="mx-auto max-w-6xl space-y-4 p-6">
          {!hasClass && !loading && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
              <p className="font-semibold">You have not been assigned a class yet</p>
              <p className="mt-1">
                The school office decides which branch, level and sitting you take. Ask them to set it and this
                timetable fills in automatically.
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
          )}
          {saved && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{saved}</div>
          )}

          {loading ? (
            <div className="py-12 text-center text-[var(--muted)]">Loading timetable…</div>
          ) : (
            <ScheduleCalendar
              cursor={cursor}
              onCursor={(next) => {
                setCursorPinned(true);
                setCursor(next);
              }}
              days={days}
              selected={selectedDay}
              onSelect={(day) => {
                setSelectedDay(day);
                setEditing(null);
                setAdding(false);
              }}
              legend={LEGEND}
              toolbar={toolbar}
              rail={rail}
            />
          )}
        </div>
      </div>
    </PortalShell>
  );
}

/** A compact pill group; collapses to a single static label when there is no choice. */
function Segmented({
  value,
  options,
  onChange,
  locked,
  fallbackLabel,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (next: string) => void;
  locked: boolean;
  fallbackLabel: string;
}) {
  if (locked || options.length <= 1) {
    return (
      <span className="rounded-lg bg-[var(--surface-alt)] px-3 py-1.5 text-sm font-semibold text-[var(--foreground)]">
        {fallbackLabel}
      </span>
    );
  }
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg bg-[var(--surface-alt)] p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
            value === option.value
              ? "bg-[var(--accent)] text-white"
              : "text-[var(--foreground-soft)] hover:text-[var(--foreground)]"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
