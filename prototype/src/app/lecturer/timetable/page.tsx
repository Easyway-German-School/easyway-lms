"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useMemo, useState } from "react";
import PortalShell from "@/components/PortalShell";
import { batchRangeLabel } from "@/lib/levels";
import ScheduleCalendar, { type DayCell, type Tone } from "@/components/schedule/ScheduleCalendar";
import UndoToast, { type PendingUndo } from "@/components/schedule/UndoToast";
import { ymd } from "@/components/schedule/grid";
import { effectiveDayKey } from "@/components/schedule/effectiveDay";
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
  groups: Array<{ branchId: string; level: string; sessionSlot: string; batch?: string }>;
  classTypes: string[];
  batches: string[];
};

/** One class the tutor runs — a row in the "Class" picker. */
type TimetableGroup = {
  key: string;
  branchId: string;
  branchName: string;
  level: string;
  sessionSlot: string;
  batch: string | null;
  label: string;
  batchRange: string;
};

/**
 * The distinct classes a tutor runs, from the assignment the office set. A
 * tutor with two classes gets two entries; a single-class tutor gets one and
 * the picker collapses to a static label. Admins do not use this — they choose
 * any cohort freely.
 */
function buildGroups(
  assignment: Assignment | null,
  branches: Array<{ id: string; name: string }>,
): TimetableGroup[] {
  if (!assignment) return [];
  const names = new Map(branches.map((branch) => [branch.id, branch.name]));
  const rows = assignment.groups.length
    ? assignment.groups.map((group) => ({
        branchId: group.branchId,
        level: group.level.toUpperCase(),
        sessionSlot: group.sessionSlot.toLowerCase(),
        batch: group.batch ?? null,
      }))
    : assignment.branchIds.flatMap((branchId) =>
        assignment.levels.flatMap((level) =>
          (assignment.sessionSlots.length ? assignment.sessionSlots : [""]).map((sessionSlot) => ({
            branchId,
            level: level.toUpperCase(),
            sessionSlot: sessionSlot.toLowerCase(),
            batch: assignment.batches[0] ?? null,
          })),
        ),
      );

  const seen = new Set<string>();
  const out: TimetableGroup[] = [];
  for (const row of rows) {
    const key = `${row.branchId}:${row.level}:${row.sessionSlot}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const slotLabel = row.sessionSlot
      ? row.sessionSlot.charAt(0).toUpperCase() + row.sessionSlot.slice(1)
      : "";
    out.push({
      key,
      branchId: row.branchId,
      branchName: names.get(row.branchId) ?? "Your branch",
      level: row.level,
      sessionSlot: row.sessionSlot,
      batch: row.batch,
      label: slotLabel ? `${row.level} · ${slotLabel}` : row.level,
      batchRange: batchRangeLabel(row.batch, row.sessionSlot),
    });
  }
  return out;
}

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

/** Midnight-UTC ISO for a `yyyy-mm-dd` — the shape every date the sessions API stores. */
function isoUTC(dayKey: string): string {
  return `${dayKey}T00:00:00.000Z`;
}

function longDay(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function shortDay(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** The stable id a dot carries so a drag can be mapped back to its session. */
function dotIdFor(branchId: string, level: string, slot: string, originKey: string): string {
  return `g:${branchId}:${level}:${slot}:${originKey}`;
}

/**
 * A deep link from "My classes" (`?branchId=&level=&slot=`) points the page at
 * one class. Read straight off the URL rather than through `useSearchParams`,
 * which would need a Suspense boundary and pull the whole route into CSR — the
 * same trade `/lecturer/messages` makes.
 */
function linkedClass(): { branchId: string; level: string; slot: string } {
  if (typeof window === "undefined") return { branchId: "", level: "", slot: "" };
  const params = new URLSearchParams(window.location.search);
  return {
    branchId: params.get("branchId") ?? "",
    level: (params.get("level") ?? "").toUpperCase(),
    slot: (params.get("slot") ?? "").toLowerCase(),
  };
}

export default function LecturerTimetablePage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [months, setMonths] = useState<Month[]>([]);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [canChooseCohort, setCanChooseCohort] = useState(false);
  const [closedDays, setClosedDays] = useState<ClosedDay[]>([]);

  // Seeded once from the deep link; after that the picker owns it.
  const [branchId, setBranchId] = useState(() => linkedClass().branchId);
  const [level, setLevel] = useState(() => linkedClass().level);
  const [slot, setSlot] = useState(() => linkedClass().slot);

  const [cursor, setCursor] = useState(() => new Date());
  const [cursorPinned, setCursorPinned] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [editing, setEditing] = useState<Session | null>(null);
  /** The day the open editor's class should run — starts at its effective day. */
  const [editDate, setEditDate] = useState("");
  const [undo, setUndo] = useState<PendingUndo | null>(null);

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

      // The server pins the schedule window to the class's pinned intake month
      // on its own — it has the assignment — so no `batch` is sent from here.
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

  // Sessions bucketed by the day they ACTUALLY run — a postponed class sits on
  // its new date, not the day it was first timetabled for.
  const sessionsByDay = useMemo(() => {
    const map = new Map<string, Session[]>();
    for (const s of allSessions) {
      const key = effectiveDayKey(s);
      if (!key) continue;
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
        dots: list.map((s) => ({
          tone: STATUS_TONE[s.status] ?? "accent",
          key: dotIdFor(branchId, level, s.timeSlot, ymd(new Date(s.date))),
        })),
      });
    }
    // A moved class leaves a hollow marker on the day it came from.
    for (const s of allSessions) {
      if (s.status !== "postponed" || !s.postponedTo) continue;
      const originKey = ymd(new Date(s.date));
      const cell = map.get(originKey) ?? { dots: [] };
      cell.ghosts = [...(cell.ghosts ?? []), { toLabel: shortDay(ymd(new Date(s.postponedTo))) }];
      map.set(originKey, cell);
    }
    for (const holiday of closedDays) {
      const key = ymd(new Date(holiday.date));
      const existing = map.get(key);
      map.set(key, { dots: existing?.dots ?? [], ghosts: existing?.ghosts, closed: { label: holiday.label } });
    }
    return map;
  }, [sessionsByDay, allSessions, closedDays, branchId, level]);

  const selectedSessions = selectedDay ? sessionsByDay.get(selectedDay) ?? [] : [];
  // Classes that were originally on the selected day but have since moved away.
  const movedFromSelected = selectedDay
    ? allSessions.filter((s) => s.status === "postponed" && s.postponedTo && ymd(new Date(s.date)) === selectedDay)
    : [];
  const selectedClosed = selectedDay ? closedDays.find((h) => ymd(new Date(h.date)) === selectedDay) : undefined;

  const levelMaterials = materials.filter((item) => !item.course?.level || item.course.level === level);
  const branchName = branches.find((branch) => branch.id === branchId)?.name ?? "—";
  const hasClass = Boolean(branchId && level);

  // A tutor picks one of THEIR classes as a single unit — branch, level and
  // sitting move together, so the old three independent pills can no longer be
  // left in a combination that is not a real class of theirs.
  const myGroups = useMemo(() => buildGroups(assignment, branches), [assignment, branches]);
  const activeGroupKey = `${branchId}:${level.toUpperCase()}:${slot.toLowerCase()}`;
  const activeGroup = myGroups.find((group) => group.key === activeGroupKey) ?? null;
  const activeBatchRange =
    activeGroup?.batchRange ||
    (level && slot ? batchRangeLabel((assignment?.batches ?? [])[0], slot) : "");

  function selectGroup(next: TimetableGroup) {
    setBranchId(next.branchId);
    setLevel(next.level);
    setSlot(next.sessionSlot);
    setSelectedDay(null);
    setEditing(null);
    setAdding(false);
    // Re-land on the month the newly chosen class actually runs in.
    setCursorPinned(false);
  }

  // Admin keeps the free cohort pickers — the office can fix any branch's
  // timetable, so it is not bounded by an assignment.
  const selectableBranches = branches;
  const selectableLevels = ["A1", "A2", "B1", "B2", "C1", "C2"];
  const selectableSlots = ["morning", "afternoon", "evening", "weekend"];

  /** One raw write to a single day's override. `session` is identified by its own date. */
  async function putSession(
    session: Session,
    fields: { status: string; postponedTo: string | null; startTime?: string; endTime?: string; topic?: string | null; notes?: string | null; materialId?: string | null },
  ) {
    const res = await fetch("/api/lecturer/sessions", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        branchId,
        level,
        date: session.date,
        timeSlot: session.timeSlot,
        topic: fields.topic !== undefined ? fields.topic : session.topic,
        notes: fields.notes !== undefined ? fields.notes : session.notes,
        status: fields.status,
        startTime: fields.startTime ?? session.startTime,
        endTime: fields.endTime ?? session.endTime,
        materialId: fields.materialId !== undefined ? fields.materialId : (session.material?.id ?? null),
        postponedTo: fields.status === "postponed" ? fields.postponedTo : null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Could not save");
  }

  /** Turn the editor's chosen day + status into the row's status/postponedTo. */
  function resolveMove(session: Session, dayKey: string, chosenStatus: string) {
    const naturalDay = ymd(new Date(session.date));
    if (chosenStatus === "cancelled" || chosenStatus === "held") {
      return { status: chosenStatus, postponedTo: null as string | null };
    }
    if (dayKey && dayKey !== naturalDay) {
      return { status: "postponed", postponedTo: isoUTC(dayKey) };
    }
    return { status: "scheduled", postponedTo: null as string | null };
  }

  async function save(session: Session, patch: Partial<Session> & { materialId?: string | null }) {
    setSavingKey(session.date);
    setSaved("");
    try {
      const move = resolveMove(session, editDate, patch.status ?? session.status);
      const before = { status: session.status, postponedTo: session.postponedTo, startTime: session.startTime, endTime: session.endTime };
      await putSession(session, {
        ...move,
        startTime: patch.startTime ?? session.startTime,
        endTime: patch.endTime ?? session.endTime,
        topic: patch.topic ?? session.topic,
        notes: patch.notes ?? session.notes,
        materialId: patch.materialId !== undefined ? patch.materialId : (session.material?.id ?? null),
      });

      setSaved(
        move.status === "postponed"
          ? "Saved. Your students have been told the class moved, and their calendar now shows the new date."
          : move.status === "cancelled"
            ? "Saved. Your students have been told the class is cancelled."
            : "Saved. Your students' calendars are updated.",
      );
      if (move.status !== before.status || move.postponedTo !== before.postponedTo) {
        setUndo({
          label:
            move.status === "postponed"
              ? `Moved to ${shortDay(editDate)}`
              : move.status === "cancelled"
                ? "Class cancelled"
                : "Class updated",
          run: async () => {
            await putSession(session, before);
            await load();
          },
        });
      }
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

          {movedFromSelected.map((s) => (
            <p key={`moved-${s.date}`} className="mt-2 rounded-lg bg-[var(--surface-alt)] px-3 py-2 text-xs text-[var(--muted)]">
              {level} class originally here — moved to{" "}
              <button
                type="button"
                onClick={() => s.postponedTo && setSelectedDay(ymd(new Date(s.postponedTo)))}
                className="font-semibold text-[var(--accent)] hover:underline"
              >
                {s.postponedTo ? shortDay(ymd(new Date(s.postponedTo))) : "—"}
              </button>
            </p>
          ))}

          <div className="mt-3 space-y-2">
            {selectedSessions.length === 0 && !selectedClosed && movedFromSelected.length === 0 && (
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
                      if (isEditing) {
                        setEditing(null);
                      } else {
                        setEditing(session);
                        setEditDate(effectiveDayKey(session));
                      }
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
                        {session.topic || session.defaultFocus}
                        {!session.topic && (
                          <span className="ml-1.5 text-xs font-normal text-[var(--muted)]">· suggested</span>
                        )}
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
                          defaultValue={session.topic || session.defaultFocus}
                          placeholder={session.defaultFocus}
                          onChange={(event) => setEditing({ ...editing, topic: event.target.value })}
                          className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                        />
                      </label>

                      <div className="grid grid-cols-2 gap-3">
                        <label>
                          <span className="text-xs font-medium text-[var(--muted)]">Day</span>
                          <input
                            type="date"
                            value={editDate}
                            onChange={(event) => setEditDate(event.target.value)}
                            className={`mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] ${
                              editDate && editDate !== ymd(new Date(session.date))
                                ? "border-pink-400"
                                : "border-[var(--border)]"
                            }`}
                          />
                          {editDate && editDate !== ymd(new Date(session.date)) && (
                            <span className="mt-1 block text-[11px] text-pink-700 dark:text-pink-300">
                              Moved from {shortDay(ymd(new Date(session.date)))} — students are told.
                            </span>
                          )}
                        </label>
                        <label>
                          <span className="text-xs font-medium text-[var(--muted)]">Status</span>
                          <select
                            value={editing.status === "postponed" ? "scheduled" : editing.status}
                            onChange={(event) => setEditing({ ...editing, status: event.target.value })}
                            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                          >
                            <option value="scheduled">Scheduled</option>
                            <option value="cancelled">Cancelled</option>
                            <option value="held">Held</option>
                          </select>
                        </label>
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
                          disabled={savingKey === session.date || !editDate}
                          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {savingKey === session.date ? "Saving…" : "Save class"}
                        </button>
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
        {canChooseCohort ? "Editing" : myGroups.length > 1 ? "Which class" : "Your class"}
      </span>

      {canChooseCohort ? (
        <div className="flex flex-wrap gap-2">
          <Segmented
            value={branchId}
            options={selectableBranches.map((b) => ({ value: b.id, label: b.name }))}
            onChange={setBranchId}
            locked={selectableBranches.length <= 1}
            fallbackLabel={branchName}
          />
          <Segmented
            value={level}
            options={selectableLevels.map((l) => ({ value: l, label: l }))}
            onChange={setLevel}
            locked={false}
            fallbackLabel={level}
          />
          <Segmented
            value={slot}
            options={selectableSlots.map((s) => ({ value: s, label: SLOT_LABELS[s] ?? s }))}
            onChange={setSlot}
            locked={false}
            fallbackLabel={SLOT_LABELS[slot] ?? slot}
          />
        </div>
      ) : myGroups.length > 1 ? (
        <div className="inline-flex flex-wrap gap-1 rounded-lg bg-[var(--surface-alt)] p-1">
          {myGroups.map((group) => (
            <button
              key={group.key}
              type="button"
              onClick={() => selectGroup(group)}
              className={`rounded-md px-3 py-1.5 text-left text-sm font-semibold transition ${
                group.key === activeGroupKey
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--foreground-soft)] hover:text-[var(--foreground)]"
              }`}
            >
              {group.label}
              {group.batchRange ? (
                <span
                  className={`ml-1.5 text-xs font-medium ${
                    group.key === activeGroupKey ? "text-white/80" : "text-[var(--muted)]"
                  }`}
                >
                  {group.batchRange}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : (
        <span className="rounded-lg bg-[var(--surface-alt)] px-3 py-1.5 text-sm font-semibold text-[var(--foreground)]">
          {activeGroup?.label ?? [branchName, level, SLOT_LABELS[slot] ?? slot].filter(Boolean).join(" · ")}
          {activeBatchRange ? (
            <span className="ml-1.5 text-xs font-medium text-[var(--muted)]">{activeBatchRange} batch</span>
          ) : null}
        </span>
      )}
    </div>
  ) : null;

  return (
    <PortalShell>
      <div className="h-screen overflow-y-auto">
        <div className="border-b border-[var(--border)] bg-gradient-to-r from-[var(--accent)]/20 to-transparent p-6">
          <div className="mx-auto max-w-6xl">
            <h1 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xl font-bold text-[var(--foreground)] sm:text-3xl">
              <CalendarIcon className="h-7 w-7 text-[var(--accent)]" />
              Class timetable
              {hasClass && !canChooseCohort && (activeGroup?.label || level) ? (
                <span className="text-base font-semibold text-[var(--muted)]">
                  · {activeGroup?.label ?? level}
                  {activeBatchRange ? ` · ${activeBatchRange} batch` : ""}
                </span>
              ) : null}
            </h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              A dot for every class, coloured by status. Tap a day to set its topic, times and materials, postpone it,
              or add a one-off. What you save is what your students see.
              {myGroups.length > 1 ? " Use the class picker to switch between your classes." : ""}
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
      <UndoToast undo={undo} onClose={() => setUndo(null)} />
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
