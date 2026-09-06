"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ScheduleCalendar, { type DayCell, type Tone } from "@/components/schedule/ScheduleCalendar";
import { ymd } from "@/components/schedule/grid";
import { ClockIcon } from "@/components/icons";
import type { GroupSession, PrivateClass, PrivateAnalytics } from "@/components/admin/AdminScheduleList";

/**
 * The admin schedule as a calendar — every group cohort and every private
 * booking across branches on one month grid, a dot per class. The "Calendar"
 * half of /admin/schedule (the default); the tables live behind the toggle.
 *
 * A group day can be fixed inline here (topic, times, postpone, cancel) via the
 * same endpoint the tutor timetable uses. A private booking opens its own admin
 * console — the message thread and approvals don't belong in a popover.
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
  const [draft, setDraft] = useState<GroupSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

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
      const key = ymd(new Date(g.date));
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

  const days = useMemo(() => {
    const map = new Map<string, DayCell>();
    const push = (key: string, tone: Tone, id: string) => {
      const cell = map.get(key) ?? { dots: [] };
      cell.dots.push({ tone, key: id });
      map.set(key, cell);
    };
    for (const [key, list] of groupsByDay) list.forEach((g, i) => push(key, toneForStatus("group", g.status), `g-${key}-${i}`));
    for (const [key, list] of privatesByDay)
      list.forEach((p) => push(key, toneForStatus("private", p.status), `p-${p.id}`));
    for (const holiday of closedDays) {
      const key = ymd(new Date(holiday.date));
      const cell = map.get(key) ?? { dots: [] };
      cell.closed = { label: holiday.label };
      map.set(key, cell);
    }
    return map;
  }, [groupsByDay, privatesByDay, closedDays]);

  const dayGroups = selectedDay ? groupsByDay.get(selectedDay) ?? [] : [];
  const dayPrivates = selectedDay ? privatesByDay.get(selectedDay) ?? [] : [];
  const dayClosed = selectedDay ? closedDays.find((h) => ymd(new Date(h.date)) === selectedDay) : undefined;

  async function saveGroup(session: GroupSession) {
    if (!draft) return;
    if (!session.branchId) {
      setError("This cohort has no branch on file — fix it from the tutor timetable.");
      return;
    }
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const res = await fetch("/api/lecturer/sessions", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          branchId: session.branchId,
          level: session.level,
          date: session.date,
          timeSlot: session.timeSlot,
          topic: draft.topic,
          status: draft.status,
          startTime: draft.startTime,
          endTime: draft.endTime,
          postponedTo: draft.status === "postponed" ? draft.postponedTo ?? null : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save");
      setSaved("Saved. Students' calendars are updated.");
      setEditingKey(null);
      setDraft(null);
      onReload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

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
          {error && <p className="mt-2 rounded-lg bg-rose-500/10 p-2 text-xs text-rose-600">{error}</p>}
          {saved && <p className="mt-2 rounded-lg bg-emerald-500/10 p-2 text-xs text-emerald-600">{saved}</p>}

          {dayGroups.length === 0 && dayPrivates.length === 0 && !dayClosed && (
            <p className="mt-3 text-sm text-[var(--muted)]">No classes this day.</p>
          )}

          {dayGroups.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Group</p>
              <div className="mt-1.5 space-y-2">
                {dayGroups.map((g, i) => {
                  const key = `${g.date}-${g.cohort}-${i}`;
                  const isEditing = editingKey === key;
                  return (
                    <div key={key} className="rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] p-3">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingKey(isEditing ? null : key);
                          setDraft(isEditing ? null : g);
                          setError("");
                          setSaved("");
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

                      {isEditing && draft && (
                        <div className="mt-3 grid gap-3 border-t border-[var(--border)] pt-3">
                          <label>
                            <span className="text-xs font-medium text-[var(--muted)]">Topic</span>
                            <input
                              defaultValue={g.topic ?? ""}
                              placeholder={g.title}
                              onChange={(e) => setDraft({ ...draft, topic: e.target.value })}
                              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                            />
                          </label>
                          <div className="grid grid-cols-2 gap-3">
                            <label>
                              <span className="text-xs font-medium text-[var(--muted)]">Status</span>
                              <select
                                value={draft.status}
                                onChange={(e) => setDraft({ ...draft, status: e.target.value })}
                                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                              >
                                <option value="scheduled">Scheduled</option>
                                <option value="postponed">Postponed</option>
                                <option value="cancelled">Cancelled</option>
                                <option value="held">Held</option>
                              </select>
                            </label>
                            {draft.status === "postponed" && (
                              <label>
                                <span className="text-xs font-medium text-pink-700 dark:text-pink-300">Moved to</span>
                                <input
                                  type="date"
                                  onChange={(e) =>
                                    setDraft({
                                      ...draft,
                                      postponedTo: e.target.value ? new Date(e.target.value).toISOString() : null,
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
                                defaultValue={g.startTime}
                                onChange={(e) => setDraft({ ...draft, startTime: e.target.value })}
                                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                              />
                            </label>
                            <label>
                              <span className="text-xs font-medium text-[var(--muted)]">Ends</span>
                              <input
                                type="time"
                                defaultValue={g.endTime}
                                onChange={(e) => setDraft({ ...draft, endTime: e.target.value })}
                                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                              />
                            </label>
                          </div>
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => saveGroup(g)}
                              disabled={busy}
                              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                            >
                              {busy ? "Saving…" : "Save"}
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

          {dayPrivates.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Private</p>
              <div className="mt-1.5 space-y-2">
                {dayPrivates.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => router.push(`/admin/schedule/private/${encodeURIComponent(p.studentId)}`)}
                    className="flex w-full items-start justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] p-3 text-left hover:border-[#D4AF37]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--foreground)]">{p.studentName}</p>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--muted)]">
                        <ClockIcon className="h-3.5 w-3.5" />
                        {new Date(p.scheduledAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} ·{" "}
                        {p.tutorName}
                      </p>
                      <span
                        className={`mt-1 inline-block rounded px-2 py-0.5 text-xs font-medium capitalize ${
                          STATUS_STYLES[p.status] ?? STATUS_STYLES.scheduled
                        }`}
                      >
                        {p.status.replace("_", " ")}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-[#B28A22]">Open</span>
                  </button>
                ))}
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
          setDraft(null);
        }}
        legend={GROUP_LEGEND}
        toolbar={toolbar}
        rail={rail}
      />
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
