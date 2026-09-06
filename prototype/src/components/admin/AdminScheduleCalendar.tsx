"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ScheduleCalendar, { type DayCell, type Tone } from "@/components/schedule/ScheduleCalendar";
import UndoToast, { type PendingUndo } from "@/components/schedule/UndoToast";
import { ymd } from "@/components/schedule/grid";
import { effectiveDayKey } from "@/components/schedule/effectiveDay";
import { ClockIcon } from "@/components/icons";
import type { GroupSession, PrivateClass, PrivateAnalytics } from "@/components/admin/AdminScheduleList";

/**
 * The admin schedule as a calendar — every group cohort and every private
 * booking across branches on one month grid, a dot per class. The "Calendar"
 * half of /admin/schedule (the default); the tables live behind the toggle.
 *
 * A group or private day can be rescheduled here — drag its dot to another day,
 * or open the rail and pick a date. The full message thread and approvals for a
 * private booking still live on its own admin page.
 */

type ClosedDay = { id: string; date: string; label: string; branchId: string | null };

const GROUP_LEGEND: { tone: Tone; label: string }[] = [
  { tone: "accent", label: "Group class" },
  { tone: "gold", label: "Private class" },
  { tone: "pink", label: "Postponed" },
  { tone: "red", label: "Cancelled" },
];

const STATUS_STYLES: Record<string, string> = {
  scheduled: "bg-[var(--surface-alt)] text-[var(--foreground-soft)]",
  requested: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200",
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200",
  held: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200",
  postponed: "bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-200",
  reschedule_requested: "bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-200",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200",
  cancel_requested: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200",
  declined: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200",
};

function toneForStatus(track: "group" | "private", status: string): Tone {
  if (status === "cancelled" || status === "declined" || status === "cancel_requested") return "red";
  if (status === "postponed" || status === "reschedule_requested") return "pink";
  return track === "private" ? "gold" : "accent";
}

function longDay(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}
function shortDay(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
function isoUTC(dayKey: string): string {
  return `${dayKey}T00:00:00.000Z`;
}
function clockOf(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
/** A local `yyyy-mm-dd` + `HH:mm` turned into an exact instant (client tz aware). */
function instant(dayKey: string, clock: string): string {
  return new Date(`${dayKey}T${clock}:00`).toISOString();
}

function groupDotId(g: GroupSession): string {
  return `g:${g.branchId ?? "?"}:${g.level}:${g.timeSlot}:${ymd(new Date(g.date))}`;
}

const TRACKS = [
  { value: "", label: "All classes" },
  { value: "group", label: "Group" },
  { value: "private", label: "Private" },
];
const MODES = [
  { value: "", label: "Any mode" },
  { value: "physical", label: "Physical" },
  { value: "online", label: "Online" },
  { value: "hybrid", label: "Hybrid" },
];

type GroupDraft = { topic: string | null; status: string; startTime: string; endTime: string; day: string };
type PrivateDraft = { day: string; start: string; durationMinutes: number; status: string; topic: string | null };

export default function AdminScheduleCalendar({
  groups,
  privates,
  closedDays,
  privateAnalytics,
  loading,
  onReload,
}: {
  groups: GroupSession[];
  privates: PrivateClass[];
  closedDays: ClosedDay[];
  privateAnalytics: PrivateAnalytics | null;
  loading: boolean;
  onReload: () => void;
}) {
  const router = useRouter();
  const [cursor, setCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const [branch, setBranch] = useState("");
  const [tutor, setTutor] = useState("");
  const [mode, setMode] = useState("");
  const [track, setTrack] = useState("");

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState<GroupDraft | null>(null);
  const [privateDraft, setPrivateDraft] = useState<PrivateDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [undo, setUndo] = useState<PendingUndo | null>(null);

  const branchNames = useMemo(() => {
    const set = new Set<string>();
    groups.forEach((g) => g.branchName && set.add(g.branchName));
    privates.forEach((p) => p.branchName && set.add(p.branchName));
    return [...set].sort();
  }, [groups, privates]);

  const tutorNames = useMemo(() => {
    const set = new Set<string>();
    groups.forEach((g) => g.tutorName && set.add(g.tutorName));
    privates.forEach((p) => p.tutorName && set.add(p.tutorName));
    return [...set].sort();
  }, [groups, privates]);

  const groupMatches = (g: GroupSession) =>
    (!branch || g.branchName === branch) &&
    (!tutor || g.tutorName === tutor) &&
    (!mode || g.deliveryMode === mode) &&
    track !== "private";

  const privateMatches = (p: PrivateClass) =>
    (!branch || p.branchName === branch) &&
    (!tutor || p.tutorName === tutor) &&
    (!mode || p.deliveryMode === mode) &&
    track !== "group";

  const groupsByDay = useMemo(() => {
    const map = new Map<string, GroupSession[]>();
    for (const g of groups) {
      if (!groupMatches(g)) continue;
      const key = effectiveDayKey(g);
      (map.get(key) ?? map.set(key, []).get(key)!).push(g);
    }
    for (const list of map.values()) list.sort((a, b) => a.startTime.localeCompare(b.startTime));
    return map;
  }, [groups, branch, tutor, mode, track]);

  const privatesByDay = useMemo(() => {
    const map = new Map<string, PrivateClass[]>();
    for (const p of privates) {
      if (!privateMatches(p)) continue;
      const key = ymd(new Date(p.scheduledAt));
      (map.get(key) ?? map.set(key, []).get(key)!).push(p);
    }
    for (const list of map.values())
      list.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
    return map;
  }, [privates, branch, tutor, mode, track]);

  const dotIndex = useMemo(() => {
    const map = new Map<string, { kind: "group"; g: GroupSession } | { kind: "private"; p: PrivateClass }>();
    for (const g of groups) if (groupMatches(g)) map.set(groupDotId(g), { kind: "group", g });
    for (const p of privates) if (privateMatches(p)) map.set(`p:${p.id}`, { kind: "private", p });
    return map;
  }, [groups, privates, branch, tutor, mode, track]);

  const days = useMemo(() => {
    const map = new Map<string, DayCell>();
    const cellAt = (key: string) => map.get(key) ?? map.set(key, { dots: [] }).get(key)!;
    for (const [key, list] of groupsByDay)
      list.forEach((g) => cellAt(key).dots.push({ tone: toneForStatus("group", g.status), key: groupDotId(g) }));
    for (const [key, list] of privatesByDay)
      list.forEach((p) => cellAt(key).dots.push({ tone: toneForStatus("private", p.status), key: `p:${p.id}` }));
    // Ghost on the day a moved group class came from.
    for (const g of groups) {
      if (!groupMatches(g) || g.status !== "postponed" || !g.postponedTo) continue;
      const cell = cellAt(ymd(new Date(g.date)));
      cell.ghosts = [...(cell.ghosts ?? []), { toLabel: shortDay(ymd(new Date(g.postponedTo))) }];
    }
    for (const holiday of closedDays) {
      cellAt(ymd(new Date(holiday.date))).closed = { label: holiday.label };
    }
    return map;
  }, [groupsByDay, privatesByDay, groups, closedDays, branch, tutor, mode, track]);

  const dayGroups = selectedDay ? groupsByDay.get(selectedDay) ?? [] : [];
  const dayPrivates = selectedDay ? privatesByDay.get(selectedDay) ?? [] : [];
  const dayClosed = selectedDay ? closedDays.find((h) => ymd(new Date(h.date)) === selectedDay) : undefined;
  const movedFromSelected = selectedDay
    ? groups.filter((g) => g.status === "postponed" && g.postponedTo && ymd(new Date(g.date)) === selectedDay)
    : [];

  /* ------------------------------------------------------------- group write */

  async function putGroup(
    g: GroupSession,
    fields: { status: string; postponedTo: string | null; startTime?: string; endTime?: string; topic?: string | null },
  ) {
    if (!g.branchId) throw new Error("This cohort has no branch on file — fix it from the tutor timetable.");
    const res = await fetch("/api/lecturer/sessions", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        branchId: g.branchId,
        level: g.level,
        date: g.date,
        timeSlot: g.timeSlot,
        topic: fields.topic !== undefined ? fields.topic : g.topic,
        status: fields.status,
        startTime: fields.startTime ?? g.startTime,
        endTime: fields.endTime ?? g.endTime,
        postponedTo: fields.status === "postponed" ? fields.postponedTo : null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Could not save");
  }

  function resolveGroupMove(g: GroupSession, dayKey: string, chosenStatus: string) {
    const natural = ymd(new Date(g.date));
    if (chosenStatus === "cancelled" || chosenStatus === "held") return { status: chosenStatus, postponedTo: null as string | null };
    if (dayKey && dayKey !== natural) return { status: "postponed", postponedTo: isoUTC(dayKey) };
    return { status: "scheduled", postponedTo: null as string | null };
  }

  async function saveGroup(g: GroupSession) {
    if (!groupDraft) return;
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const before = { status: g.status, postponedTo: g.postponedTo, startTime: g.startTime, endTime: g.endTime };
      const move = resolveGroupMove(g, groupDraft.day, groupDraft.status);
      await putGroup(g, { ...move, startTime: groupDraft.startTime, endTime: groupDraft.endTime, topic: groupDraft.topic });
      setSaved("Saved. Students' calendars are updated.");
      if (move.status !== before.status || move.postponedTo !== before.postponedTo) {
        setUndo({
          label: move.status === "postponed" ? `Moved to ${shortDay(groupDraft.day)}` : "Class updated",
          run: async () => {
            await putGroup(g, before);
            onReload();
          },
        });
      }
      setEditingKey(null);
      setGroupDraft(null);
      onReload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  /* ----------------------------------------------------------- private write */

  async function putPrivate(id: string, body: Record<string, unknown>) {
    const res = await fetch("/api/lecturer/private-classes", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Could not save");
  }

  async function savePrivate(p: PrivateClass) {
    if (!privateDraft) return;
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const before = {
        scheduledAt: p.scheduledAt,
        durationMinutes: p.durationMinutes,
        status: p.status,
        topic: p.topic,
      };
      await putPrivate(p.id, {
        scheduledAt: instant(privateDraft.day, privateDraft.start),
        durationMinutes: privateDraft.durationMinutes,
        status: privateDraft.status,
        topic: privateDraft.topic,
      });
      setSaved("Saved. The student has been told.");
      setUndo({
        label: `Moved ${p.studentName}'s session`,
        run: async () => {
          await putPrivate(p.id, before);
          onReload();
        },
      });
      setEditingKey(null);
      setPrivateDraft(null);
      onReload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  /* --------------------------------------------------------------- drag move */

  async function rescheduleDot(dotId: string, _fromDay: string, toDay: string) {
    const entry = dotIndex.get(dotId);
    if (!entry) return;
    if (closedDays.some((h) => ymd(new Date(h.date)) === toDay)) {
      if (!window.confirm(`${shortDay(toDay)} is a school holiday. Move the class there anyway?`)) return;
    }
    setError("");
    setSaved("");
    try {
      if (entry.kind === "group") {
        const g = entry.g;
        const before = { status: g.status, postponedTo: g.postponedTo };
        const move = resolveGroupMove(g, toDay, "scheduled");
        await putGroup(g, { ...move, startTime: g.startTime, endTime: g.endTime });
        setUndo({
          label: move.status === "postponed" ? `Moved to ${shortDay(toDay)}` : "Move undone",
          run: async () => {
            await putGroup(g, before);
            onReload();
          },
        });
      } else {
        const p = entry.p;
        const fromMs = new Date(p.scheduledAt).getTime();
        const dayShift =
          new Date(`${toDay}T00:00:00`).getTime() - new Date(`${_fromDay || ymd(new Date(p.scheduledAt))}T00:00:00`).getTime();
        const nextIso = new Date(fromMs + dayShift).toISOString();
        const before = { scheduledAt: p.scheduledAt };
        await putPrivate(p.id, { scheduledAt: nextIso });
        setUndo({
          label: `Moved ${p.studentName}'s session to ${shortDay(toDay)}`,
          run: async () => {
            await putPrivate(p.id, before);
            onReload();
          },
        });
      }
      onReload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not move this class");
      onReload();
    }
  }

  /* ----------------------------------------------------------------- render */

  const rail = (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      {!selectedDay ? (
        <p className="py-8 text-center text-sm text-[var(--muted)]">Tap a day to see its classes.</p>
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

          {dayClosed && (
            <p className="mt-2 rounded-lg bg-[var(--surface-alt)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              {dayClosed.label} · school closed
            </p>
          )}
          {movedFromSelected.map((g) => (
            <p key={`moved-${groupDotId(g)}`} className="mt-2 rounded-lg bg-[var(--surface-alt)] px-3 py-2 text-xs text-[var(--muted)]">
              {g.cohort} originally here — moved to{" "}
              <button
                type="button"
                onClick={() => g.postponedTo && setSelectedDay(ymd(new Date(g.postponedTo)))}
                className="font-semibold text-[var(--accent)] hover:underline"
              >
                {g.postponedTo ? shortDay(ymd(new Date(g.postponedTo))) : "—"}
              </button>
            </p>
          ))}
          {error && <p className="mt-2 rounded-lg bg-rose-500/10 p-2 text-xs text-rose-600">{error}</p>}
          {saved && <p className="mt-2 rounded-lg bg-emerald-500/10 p-2 text-xs text-emerald-600">{saved}</p>}

          {dayGroups.length === 0 && dayPrivates.length === 0 && !dayClosed && movedFromSelected.length === 0 && (
            <p className="mt-3 text-sm text-[var(--muted)]">No classes this day.</p>
          )}

          {dayGroups.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Group</p>
              <div className="mt-1.5 space-y-2">
                {dayGroups.map((g) => {
                  const key = groupDotId(g);
                  const isEditing = editingKey === key;
                  const natural = ymd(new Date(g.date));
                  return (
                    <div key={key} className="rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] p-3">
                      <button
                        type="button"
                        onClick={() => {
                          setPrivateDraft(null);
                          if (isEditing) {
                            setEditingKey(null);
                            setGroupDraft(null);
                          } else {
                            setEditingKey(key);
                            setGroupDraft({
                              topic: g.topic,
                              status: g.status === "postponed" ? "scheduled" : g.status,
                              startTime: g.startTime,
                              endTime: g.endTime,
                              day: effectiveDayKey(g),
                            });
                            setError("");
                            setSaved("");
                          }
                        }}
                        className="flex w-full items-start justify-between gap-2 text-left"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-[var(--foreground)]">{g.cohort}</p>
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--muted)]">
                            <ClockIcon className="h-3.5 w-3.5" />
                            {g.startTime}–{g.endTime} · {g.tutorName ?? "Unassigned"}
                          </p>
                          <span
                            className={`mt-1 inline-block rounded px-2 py-0.5 text-xs font-medium capitalize ${
                              STATUS_STYLES[g.status] ?? STATUS_STYLES.scheduled
                            }`}
                          >
                            {g.status}
                          </span>
                        </div>
                        <span className="shrink-0 text-xs font-semibold text-[var(--accent)]">
                          {isEditing ? "Close" : "Edit"}
                        </span>
                      </button>

                      {isEditing && groupDraft && (
                        <div className="mt-3 grid gap-3 border-t border-[var(--border)] pt-3">
                          <label>
                            <span className="text-xs font-medium text-[var(--muted)]">Topic</span>
                            <input
                              defaultValue={g.topic ?? ""}
                              placeholder={g.title}
                              onChange={(e) => setGroupDraft({ ...groupDraft, topic: e.target.value })}
                              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                            />
                          </label>
                          <div className="grid grid-cols-2 gap-3">
                            <label>
                              <span className="text-xs font-medium text-[var(--muted)]">Day</span>
                              <input
                                type="date"
                                value={groupDraft.day}
                                onChange={(e) => setGroupDraft({ ...groupDraft, day: e.target.value })}
                                className={`mt-1 w-full rounded-lg border bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] ${
                                  groupDraft.day && groupDraft.day !== natural ? "border-pink-400" : "border-[var(--border)]"
                                }`}
                              />
                            </label>
                            <label>
                              <span className="text-xs font-medium text-[var(--muted)]">Status</span>
                              <select
                                value={groupDraft.status}
                                onChange={(e) => setGroupDraft({ ...groupDraft, status: e.target.value })}
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
                                defaultValue={g.startTime}
                                onChange={(e) => setGroupDraft({ ...groupDraft, startTime: e.target.value })}
                                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                              />
                            </label>
                            <label>
                              <span className="text-xs font-medium text-[var(--muted)]">Ends</span>
                              <input
                                type="time"
                                defaultValue={g.endTime}
                                onChange={(e) => setGroupDraft({ ...groupDraft, endTime: e.target.value })}
                                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                              />
                            </label>
                          </div>
                          <button
                            type="button"
                            onClick={() => saveGroup(g)}
                            disabled={busy || !groupDraft.day}
                            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                          >
                            {busy ? "Saving…" : "Save"}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {dayPrivates.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Private</p>
              <div className="mt-1.5 space-y-2">
                {dayPrivates.map((p) => {
                  const key = `p:${p.id}`;
                  const isEditing = editingKey === key;
                  return (
                    <div key={key} className="rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] p-3">
                      <button
                        type="button"
                        onClick={() => {
                          setGroupDraft(null);
                          if (isEditing) {
                            setEditingKey(null);
                            setPrivateDraft(null);
                          } else {
                            setEditingKey(key);
                            setPrivateDraft({
                              day: ymd(new Date(p.scheduledAt)),
                              start: clockOf(p.scheduledAt),
                              durationMinutes: p.durationMinutes,
                              status: ["scheduled", "completed", "cancelled"].includes(p.status) ? p.status : "scheduled",
                              topic: p.topic,
                            });
                            setError("");
                            setSaved("");
                          }
                        }}
                        className="flex w-full items-start justify-between gap-2 text-left"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-[var(--foreground)]">{p.studentName}</p>
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--muted)]">
                            <ClockIcon className="h-3.5 w-3.5" />
                            {clockOf(p.scheduledAt)} · {p.tutorName}
                          </p>
                          <span
                            className={`mt-1 inline-block rounded px-2 py-0.5 text-xs font-medium capitalize ${
                              STATUS_STYLES[p.status] ?? STATUS_STYLES.scheduled
                            }`}
                          >
                            {p.status.replace("_", " ")}
                          </span>
                        </div>
                        <span className="shrink-0 text-xs font-semibold text-[#B28A22]">{isEditing ? "Close" : "Edit"}</span>
                      </button>

                      {isEditing && privateDraft && (
                        <div className="mt-3 grid gap-3 border-t border-[var(--border)] pt-3">
                          <div className="grid grid-cols-2 gap-3">
                            <label>
                              <span className="text-xs font-medium text-[var(--muted)]">Day</span>
                              <input
                                type="date"
                                value={privateDraft.day}
                                onChange={(e) => setPrivateDraft({ ...privateDraft, day: e.target.value })}
                                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                              />
                            </label>
                            <label>
                              <span className="text-xs font-medium text-[var(--muted)]">Starts</span>
                              <input
                                type="time"
                                value={privateDraft.start}
                                onChange={(e) => setPrivateDraft({ ...privateDraft, start: e.target.value })}
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
                                value={privateDraft.durationMinutes}
                                onChange={(e) =>
                                  setPrivateDraft({ ...privateDraft, durationMinutes: Number(e.target.value) || 60 })
                                }
                                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                              />
                            </label>
                            <label>
                              <span className="text-xs font-medium text-[var(--muted)]">Status</span>
                              <select
                                value={privateDraft.status}
                                onChange={(e) => setPrivateDraft({ ...privateDraft, status: e.target.value })}
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
                              defaultValue={p.topic ?? ""}
                              onChange={(e) => setPrivateDraft({ ...privateDraft, topic: e.target.value })}
                              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                            />
                          </label>
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => savePrivate(p)}
                              disabled={busy || !privateDraft.day}
                              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                            >
                              {busy ? "Saving…" : "Save"}
                            </button>
                            <button
                              type="button"
                              onClick={() => router.push(`/admin/schedule/private/${encodeURIComponent(p.studentId)}`)}
                              className="text-xs font-semibold text-[#B28A22] hover:underline"
                            >
                              Open full view
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );

  const toolbar = (
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      {privateAnalytics && (
        <div className="flex flex-wrap gap-2 text-xs">
          <Pill label="No tutor" value={privateAnalytics.unassignedStudents} warn />
          <Pill label="Nothing booked" value={privateAnalytics.noUpcomingSession} warn />
          <Pill label="Pending" value={privateAnalytics.pendingRequests} warn />
          <Pill label="Private next 7d" value={privateAnalytics.upcoming7Days} />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <ChipSelect value={track} onChange={setTrack} options={TRACKS} />
        <ChipSelect
          value={branch}
          onChange={setBranch}
          options={[{ value: "", label: "All branches" }, ...branchNames.map((b) => ({ value: b, label: b }))]}
        />
        <ChipSelect
          value={tutor}
          onChange={setTutor}
          options={[{ value: "", label: "All tutors" }, ...tutorNames.map((t) => ({ value: t, label: t }))]}
        />
        <ChipSelect value={mode} onChange={setMode} options={MODES} />
      </div>
    </div>
  );

  return (
    <>
      {loading && <p className="mb-3 text-sm text-[var(--muted)]">Loading school schedule…</p>}
      <ScheduleCalendar
        cursor={cursor}
        onCursor={setCursor}
        days={days}
        selected={selectedDay}
        onSelect={(day) => {
          setSelectedDay(day);
          setEditingKey(null);
          setGroupDraft(null);
          setPrivateDraft(null);
        }}
        legend={GROUP_LEGEND}
        toolbar={toolbar}
        rail={rail}
        onMoveDot={rescheduleDot}
        dotLabel={(dotId) => {
          const e = dotIndex.get(dotId);
          if (!e) return "Move";
          return e.kind === "group" ? `${e.g.level} · ${e.g.startTime}` : e.p.studentName;
        }}
      />
      <UndoToast undo={undo} onClose={() => setUndo(null)} />
    </>
  );
}

function Pill({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  const hot = warn && value > 0;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold ${
        hot ? "border-amber-500/30 bg-amber-500/10 text-amber-600" : "border-[var(--border)] text-[var(--muted)]"
      }`}
    >
      {label}
      <span className="text-[var(--foreground)]">{value}</span>
    </span>
  );
}

function ChipSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (next: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${
        value
          ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--foreground)]"
          : "border-[var(--border)] bg-[var(--surface-alt)] text-[var(--foreground-soft)]"
      }`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
