"use client";

import { useEffect, useState } from "react";
import ParentShell, { useParentChildren } from "@/components/ParentShell";
import { CalendarIcon } from "@/components/icons";

type MergedSession = {
  date: string;
  startTime: string;
  endTime: string;
  title: string;
  topic: string | null;
  lecturerName: string | null;
  status: string;
};
type MergedMonth = { sessions: MergedSession[] };
type SchedulePayload = { months: MergedMonth[]; classType?: string };

function sessionDateTime(session: MergedSession): Date {
  const datePart = session.date.slice(0, 10);
  const [h, m] = (session.startTime || "00:00").split(":").map(Number);
  const d = new Date(`${datePart}T00:00:00`);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

function dayLabel(date: Date): string {
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Today";
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (date.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

const STATUS_LABEL: Record<string, string> = {
  cancelled: "Cancelled",
  postponed: "Postponed",
  held: "Completed",
};

function TimetableBody() {
  const { children: kids, selectedId, loading: loadingKids } = useParentChildren();
  const [schedule, setSchedule] = useState<SchedulePayload | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    fetch(`/api/parent/timetable?studentId=${selectedId}`)
      .then((r) => r.json())
      .then(setSchedule)
      .catch(() => setSchedule(null))
      .finally(() => setLoading(false));
  }, [selectedId]);

  const child = kids.find((k) => k.id === selectedId);
  const now = new Date();
  const upcoming = (schedule?.months.flatMap((m) => m.sessions) || [])
    .map((s) => ({ s, when: sessionDateTime(s) }))
    .filter((x) => x.when.getTime() >= now.getTime() - 6 * 60 * 60_000)
    .sort((a, b) => a.when.getTime() - b.when.getTime())
    .slice(0, 20);

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Timetable</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {child ? `${child.name.split(" ")[0]}'s upcoming classes` : "Upcoming classes"}
          </p>
        </div>

        {loadingKids || loading ? (
          <p className="text-sm text-[var(--muted)]">Loading…</p>
        ) : !kids.length ? (
          <p className="text-sm text-[var(--muted)]">No child linked to this account yet.</p>
        ) : upcoming.length === 0 ? (
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
            <CalendarIcon className="mx-auto h-8 w-8 text-[var(--muted)]" />
            <p className="mt-3 text-sm text-[var(--muted)]">No upcoming classes scheduled right now.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {upcoming.map(({ s, when }, i) => (
              <div key={i} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--foreground)]">
                      {dayLabel(when)}, {s.startTime}
                    </p>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {s.topic || s.title}
                      {s.lecturerName ? ` · ${s.lecturerName}` : ""}
                    </p>
                  </div>
                  {STATUS_LABEL[s.status] ? (
                    <span className="shrink-0 rounded-full bg-[var(--surface-alt)] px-3 py-1 text-xs font-semibold text-[var(--muted)]">
                      {STATUS_LABEL[s.status]}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ParentTimetablePage() {
  return (
    <ParentShell>
      <TimetableBody />
    </ParentShell>
  );
}
