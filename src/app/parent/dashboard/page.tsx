"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ParentShell, { useParentChildren } from "@/components/ParentShell";
import BrandLoader from "@/components/BrandLoader";
import { AttendanceIcon, CalendarIcon, FamilyIcon } from "@/components/icons";

type MergedSession = {
  date: string;
  startTime: string;
  endTime: string;
  title: string;
  lecturerName: string | null;
  status: string;
};
type MergedMonth = { sessions: MergedSession[] };
type SchedulePayload = { months: MergedMonth[] };
type AttendanceSummary = { present: number; total: number; basis: string };

function nextUpcoming(payload: SchedulePayload | null): MergedSession | null {
  if (!payload) return null;
  const now = new Date();
  const all = payload.months.flatMap((m) => m.sessions);
  const upcoming = all
    .filter((s) => s.status !== "cancelled")
    .map((s) => ({ s, when: sessionDateTime(s) }))
    .filter((x) => x.when.getTime() >= now.getTime() - 60 * 60_000) // include one still-running
    .sort((a, b) => a.when.getTime() - b.when.getTime());
  return upcoming[0]?.s ?? null;
}

function sessionDateTime(session: MergedSession): Date {
  const datePart = session.date.slice(0, 10);
  const [h, m] = (session.startTime || "00:00").split(":").map(Number);
  const d = new Date(`${datePart}T00:00:00`);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

function formatWhen(session: MergedSession): string {
  const when = sessionDateTime(session);
  const today = new Date();
  const isToday = when.toDateString() === today.toDateString();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = when.toDateString() === tomorrow.toDateString();
  const dayLabel = isToday ? "Today" : isTomorrow ? "Tomorrow" : when.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const time = when.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" });
  return `${dayLabel}, ${time}`;
}

function DashboardBody() {
  const { children: kids, selectedId, loading: loadingKids } = useParentChildren();
  const [schedule, setSchedule] = useState<SchedulePayload | null>(null);
  const [attendance, setAttendance] = useState<AttendanceSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/parent/timetable?studentId=${selectedId}`).then((r) => r.json()).catch(() => null),
      fetch(`/api/parent/attendance?studentId=${selectedId}`).then((r) => r.json()).catch(() => null),
    ])
      .then(([sched, att]) => {
        setSchedule(sched);
        setAttendance(att);
      })
      .finally(() => setLoading(false));
  }, [selectedId]);

  const child = kids.find((k) => k.id === selectedId);
  const next = nextUpcoming(schedule);

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-3xl space-y-6">
        {!loadingKids && kids.length === 0 ? (
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
              <FamilyIcon className="h-6 w-6" />
            </span>
            <h1 className="mt-4 text-2xl font-bold text-[var(--foreground)]">Your account is set up</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              The school is confirming the link to your child's record. Once linked, their timetable and attendance
              will show up here — contact your branch office if this takes longer than expected.
            </p>
          </div>
        ) : (
          <>
            <div>
              <h1 className="text-2xl font-bold text-[var(--foreground)]">
                {child ? `${child.name.split(" ")[0]}'s week` : "Welcome"}
              </h1>
              {child ? (
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Level {child.level}
                  {child.branchName ? ` · ${child.branchName}` : ""}
                </p>
              ) : null}
            </div>

            <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                  <CalendarIcon className="h-5 w-5" />
                </span>
                <p className="text-sm font-semibold text-[var(--foreground)]">Next class</p>
              </div>
              {loading ? (
                <p className="mt-3 text-sm text-[var(--muted)]">Checking the timetable…</p>
              ) : next ? (
                <p className="mt-3 text-lg text-[var(--foreground)]">
                  {formatWhen(next)}
                  {next.lecturerName ? `, with ${next.lecturerName}` : ""}
                </p>
              ) : (
                <p className="mt-3 text-sm text-[var(--muted)]">No upcoming class scheduled right now.</p>
              )}
              <Link href="/parent/timetable" className="mt-4 inline-block text-sm font-semibold text-[var(--accent)] hover:underline">
                See the full timetable →
              </Link>
            </div>

            <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                  <AttendanceIcon className="h-5 w-5" />
                </span>
                <p className="text-sm font-semibold text-[var(--foreground)]">This month</p>
              </div>
              {loading ? (
                <p className="mt-3 text-sm text-[var(--muted)]">Checking attendance…</p>
              ) : attendance && attendance.total > 0 ? (
                <p className="mt-3 text-lg text-[var(--foreground)]">
                  {child?.name.split(" ")[0] || "Your child"} attended {attendance.present} of {attendance.total} classes so far.
                </p>
              ) : (
                <p className="mt-3 text-sm text-[var(--muted)]">No classes recorded yet this month.</p>
              )}
              <Link href="/parent/attendance" className="mt-4 inline-block text-sm font-semibold text-[var(--accent)] hover:underline">
                See attendance details →
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function ParentDashboardPage() {
  return (
    <ParentShell>
      <DashboardBody />
    </ParentShell>
  );
}
