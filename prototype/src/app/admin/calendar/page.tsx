"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, CrossIcon, LinkIcon, PlusIcon } from "@/components/icons";

type Occ = {
  id: string;
  occurrenceStart: string;
  occurrenceEnd: string | null;
  title: string;
  kind: string;
  location: string | null;
  allDay: boolean;
  recurring: boolean;
  status: string;
  workspaceName: string | null;
  attendeeCount: number;
};

const KIND_TONE: Record<string, string> = {
  meeting: "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200",
  deadline: "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200",
  holiday: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200",
  training: "bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-200",
  event: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200",
  webinar: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200",
};

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export default function CalendarPage() {
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [events, setEvents] = useState<Occ[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [feedUrl, setFeedUrl] = useState<string | null>(null);

  const monthStart = cursor;
  const monthEnd = useMemo(() => new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59), [cursor]);

  const load = useCallback(async () => {
    setLoading(true);
    const from = new Date(monthStart);
    from.setDate(from.getDate() - 7);
    const to = new Date(monthEnd);
    to.setDate(to.getDate() + 7);
    const res = await fetch(
      `/api/admin/work-drive/events?from=${from.toISOString()}&to=${to.toISOString()}`,
      { cache: "no-store" },
    );
    const json = await res.json();
    setEvents(res.ok ? json.events ?? [] : []);
    setLoading(false);
  }, [monthStart, monthEnd]);

  useEffect(() => {
    load();
  }, [load]);

  const byDay = useMemo(() => {
    const m = new Map<string, Occ[]>();
    for (const e of events) {
      const key = ymd(new Date(e.occurrenceStart));
      (m.get(key) ?? m.set(key, []).get(key)!).push(e);
    }
    for (const list of m.values()) list.sort((a, b) => +new Date(a.occurrenceStart) - +new Date(b.occurrenceStart));
    return m;
  }, [events]);

  // Grid: weeks from the Sunday before the 1st to the Saturday after month end.
  const weeks = useMemo(() => {
    const first = new Date(monthStart);
    first.setDate(first.getDate() - first.getDay());
    const cells: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(first);
      d.setDate(first.getDate() + i);
      cells.push(d);
      if (i >= 34 && d >= monthEnd) break;
    }
    const rows: Date[][] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }, [monthStart, monthEnd]);

  const dayList = selectedDay ? byDay.get(selectedDay) ?? [] : [];

  async function showFeed() {
    const res = await fetch("/api/admin/work-drive/events/subscribe", { cache: "no-store" });
    const json = await res.json();
    if (res.ok) setFeedUrl(json.url);
  }

  return (
    <AdminShell>
      <div className="space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
              <CalendarIcon className="h-6 w-6" />
            </span>
            <div>
              <h1 className="text-xl font-bold text-[var(--foreground)]">Staff calendar</h1>
              <p className="text-sm text-[var(--muted)]">Meetings, deadlines, training, events.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={showFeed}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3.5 py-2 text-sm font-semibold text-[var(--foreground-soft)] transition hover:bg-[var(--surface-alt)]"
            >
              <LinkIcon className="h-4 w-4" />
              Subscribe
            </button>
            <button
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white transition hover:brightness-110"
            >
              <PlusIcon className="h-4 w-4" />
              New event
            </button>
          </div>
        </header>

        {feedUrl && (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
            <p className="font-semibold text-[var(--foreground)]">Your calendar feed</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Paste this into Google Calendar (Add → From URL) or Outlook. Keep it private — it is a link to your view.
            </p>
            <code className="mt-2 block overflow-x-auto rounded-lg bg-[var(--surface-alt)] px-2 py-1.5 text-xs text-[var(--foreground)]">
              {feedUrl}
            </code>
          </div>
        )}

        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">
            {cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </h2>
          <div className="flex gap-1">
            <button
              onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
              className="rounded-lg border border-[var(--border)] p-2 text-[var(--muted)] transition hover:bg-[var(--surface-alt)]"
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </button>
            <button
              onClick={() => setCursor(new Date())}
              className="rounded-lg border border-[var(--border)] px-3 text-sm font-medium text-[var(--foreground-soft)] transition hover:bg-[var(--surface-alt)]"
            >
              Today
            </button>
            <button
              onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
              className="rounded-lg border border-[var(--border)] p-2 text-[var(--muted)] transition hover:bg-[var(--surface-alt)]"
            >
              <ChevronRightIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[720px] overflow-hidden rounded-2xl border border-[var(--border)]">
            <div className="grid grid-cols-7 bg-[var(--surface-alt)] text-center text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d} className="py-2">
                  {d}
                </div>
              ))}
            </div>
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7">
                {week.map((day) => {
                  const key = ymd(day);
                  const inMonth = day.getMonth() === cursor.getMonth();
                  const list = byDay.get(key) ?? [];
                  const isToday = key === ymd(new Date());
                  return (
                    <button
                      key={key}
                      onClick={() => setSelectedDay(key)}
                      className={`min-h-[92px] border-b border-r border-[var(--border)] p-1.5 text-left align-top transition hover:bg-[var(--surface-alt)] ${
                        inMonth ? "" : "opacity-40"
                      } ${selectedDay === key ? "ring-2 ring-inset ring-[var(--accent)]" : ""}`}
                    >
                      <span
                        className={`inline-grid h-6 w-6 place-items-center rounded-full text-xs font-semibold ${
                          isToday ? "bg-[var(--accent)] text-white" : "text-[var(--foreground-soft)]"
                        }`}
                      >
                        {day.getDate()}
                      </span>
                      <div className="mt-1 space-y-0.5">
                        {list.slice(0, 3).map((e, i) => (
                          <div
                            key={`${e.id}-${i}`}
                            className={`truncate rounded px-1 py-0.5 text-[10px] font-medium ${KIND_TONE[e.kind] ?? KIND_TONE.meeting}`}
                          >
                            {e.allDay ? "" : `${timeOf(e.occurrenceStart)} `}
                            {e.title}
                          </div>
                        ))}
                        {list.length > 3 && (
                          <div className="px-1 text-[10px] text-[var(--muted)]">+{list.length - 3} more</div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {loading && <p className="text-sm text-[var(--muted)]">Loading…</p>}

        {selectedDay && (
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <h3 className="text-sm font-bold text-[var(--foreground)]">
              {new Date(selectedDay).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
            </h3>
            {dayList.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--muted)]">Nothing scheduled.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {dayList.map((e, i) => (
                  <li key={`${e.id}-${i}`}>
                    <button
                      onClick={() => setOpenEventId(e.id)}
                      className="flex w-full items-center gap-3 rounded-xl border border-[var(--border)] px-3 py-2 text-left transition hover:bg-[var(--surface-alt)]"
                    >
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize ${KIND_TONE[e.kind] ?? KIND_TONE.meeting}`}>
                        {e.kind}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-[var(--foreground)]">{e.title}</p>
                        <p className="text-xs text-[var(--muted)]">
                          {e.allDay ? "All day" : `${timeOf(e.occurrenceStart)}${e.occurrenceEnd ? `–${timeOf(e.occurrenceEnd)}` : ""}`}
                          {e.location ? ` · ${e.location}` : ""}
                          {e.workspaceName ? ` · ${e.workspaceName}` : ""}
                        </p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      {creating && (
        <EventModal
          defaultDate={selectedDay}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            load();
          }}
        />
      )}
      {openEventId && (
        <EventDrawer
          eventId={openEventId}
          onClose={() => setOpenEventId(null)}
          onChanged={() => load()}
        />
      )}
    </AdminShell>
  );
}

function EventModal({
  defaultDate,
  onClose,
  onCreated,
}: {
  defaultDate: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const base = defaultDate ?? ymd(new Date());
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("meeting");
  const [date, setDate] = useState(base);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [allDay, setAllDay] = useState(false);
  const [location, setLocation] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!title.trim()) return;
    setBusy(true);
    setErr(null);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const startAt = allDay ? `${date}T00:00` : `${date}T${start}`;
    const endAt = allDay ? null : `${date}T${end}`;
    const rrule =
      repeat === "daily"
        ? "FREQ=DAILY;INTERVAL=1"
        : repeat === "weekly"
          ? "FREQ=WEEKLY;INTERVAL=1"
          : repeat === "monthly"
            ? "FREQ=MONTHLY;INTERVAL=1"
            : null;
    const res = await fetch("/api/admin/work-drive/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, kind, startAt, endAt, allDay, location, rrule, timezone: tz, visibility: "staff" }),
    });
    if (!res.ok) {
      setErr((await res.json())?.error || "Could not create the event.");
      setBusy(false);
    } else onCreated();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-[var(--foreground)]">New event</h2>
        <div className="mt-4 space-y-3">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Staff meeting"
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
          />
          <div className="flex gap-2">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-2 py-2 text-sm text-[var(--foreground)]"
            >
              {["meeting", "deadline", "holiday", "training", "event"].map((k) => (
                <option key={k} value={k}>
                  {k[0].toUpperCase() + k.slice(1)}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground)]"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--foreground-soft)]">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
            All day
          </label>
          {!allDay && (
            <div className="flex gap-2">
              <input
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground)]"
              />
              <input
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground)]"
              />
            </div>
          )}
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Location (or “Online”)"
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
          />
          <select
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground)]"
          >
            <option value="">Does not repeat</option>
            <option value="daily">Every day</option>
            <option value="weekly">Every week</option>
            <option value="monthly">Every month</option>
          </select>
          {err && <p className="text-sm text-rose-600 dark:text-rose-400">{err}</p>}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-full px-4 py-2 text-sm font-medium text-[var(--muted)] transition hover:bg-[var(--surface-alt)]">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || !title.trim()}
            className="rounded-full bg-[var(--accent)] px-5 py-2 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EventDrawer({
  eventId,
  onClose,
  onChanged,
}: {
  eventId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<any>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/work-drive/events/${eventId}`, { cache: "no-store" });
    setData(res.ok ? await res.json() : null);
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  async function addTask() {
    if (!taskTitle.trim()) return;
    await fetch(`/api/admin/work-drive/events/${eventId}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: taskTitle }),
    });
    setTaskTitle("");
    load();
  }
  async function toggleTask(id: string, done: boolean) {
    await fetch(`/api/admin/work-drive/events/${eventId}/tasks`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: id, done }),
    });
    load();
  }
  async function invite() {
    if (!inviteEmail.trim()) return;
    await fetch(`/api/admin/work-drive/events/${eventId}/attendees`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail }),
    });
    setInviteEmail("");
    load();
  }
  async function del() {
    if (!window.confirm("Delete this event?")) return;
    await fetch(`/api/admin/work-drive/events/${eventId}`, { method: "DELETE" });
    onChanged();
    onClose();
  }

  const e = data?.event;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-2xl"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] p-4">
          <div className="min-w-0">
            <p className="font-semibold text-[var(--foreground)]">{e?.title ?? "Loading…"}</p>
            {e && (
              <p className="text-xs text-[var(--muted)]">
                {new Date(e.startAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                {e.location ? ` · ${e.location}` : ""} · {e.timezone}
              </p>
            )}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--surface-alt)]">
            <CrossIcon className="h-5 w-5" />
          </button>
        </div>

        {e && (
          <div className="flex-1 space-y-5 overflow-y-auto p-4">
            {e.description && <p className="whitespace-pre-wrap text-sm text-[var(--foreground-soft)]">{e.description}</p>}

            <section>
              <h4 className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">People ({data.attendees.length})</h4>
              <ul className="mt-2 space-y-1">
                {data.attendees.map((a: any) => (
                  <li key={a.id} className="flex items-center justify-between text-sm">
                    <span className="text-[var(--foreground)]">{a.name ?? a.externalEmail}</span>
                    <span className="text-xs capitalize text-[var(--muted)]">{a.role} · {a.response}</span>
                  </li>
                ))}
              </ul>
              {e.canEdit && (
                <div className="mt-2 flex gap-2">
                  <input
                    value={inviteEmail}
                    onChange={(ev) => setInviteEmail(ev.target.value)}
                    placeholder="invite by email"
                    className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] px-2 py-1.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
                  />
                  <button onClick={invite} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-bold text-white">
                    Add
                  </button>
                </div>
              )}
            </section>

            <section>
              <h4 className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Checklist</h4>
              <ul className="mt-2 space-y-1">
                {data.tasks.map((t: any) => (
                  <li key={t.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={t.done} onChange={() => toggleTask(t.id, !t.done)} disabled={!e.canEdit} />
                    <span className={t.done ? "text-[var(--muted)] line-through" : "text-[var(--foreground)]"}>{t.title}</span>
                  </li>
                ))}
              </ul>
              {e.canEdit && (
                <div className="mt-2 flex gap-2">
                  <input
                    value={taskTitle}
                    onChange={(ev) => setTaskTitle(ev.target.value)}
                    onKeyDown={(ev) => ev.key === "Enter" && addTask()}
                    placeholder="add a task"
                    className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] px-2 py-1.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
                  />
                  <button onClick={addTask} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-semibold text-[var(--foreground-soft)]">
                    Add
                  </button>
                </div>
              )}
            </section>

            {data.resources.length > 0 && (
              <section>
                <h4 className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Files</h4>
                <ul className="mt-2 space-y-1">
                  {data.resources.map((r: any) => (
                    <li key={r.id} className="flex items-center justify-between text-sm">
                      <span className="truncate text-[var(--foreground)]">{r.label || r.name}</span>
                      <a
                        href={`/api/admin/work-drive/files/${r.fileId}/download`}
                        className="text-xs font-semibold text-[var(--accent)]"
                      >
                        Download
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {e.canEdit && (
              <button onClick={del} className="text-sm font-semibold text-rose-600 hover:underline dark:text-rose-400">
                Delete event
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
