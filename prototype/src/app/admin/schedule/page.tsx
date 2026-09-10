"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/AdminShell";
import AdminScheduleCalendar from "@/components/admin/AdminScheduleCalendar";
import AdminScheduleList, {
  type GroupSession,
  type PrivateClass,
  type PrivateAnalytics,
} from "@/components/admin/AdminScheduleList";
import TutorCoveragePanel, { type TutorCoverage } from "@/components/admin/TutorCoveragePanel";

type ClosedDay = { id: string; date: string; label: string; branchId: string | null };

const VIEW_KEY = "easyway:admin-schedule-view";
type View = "calendar" | "list";

export default function AdminSchedulePage() {
  const [view, setView] = useState<View>("calendar");
  const [groups, setGroups] = useState<GroupSession[]>([]);
  const [privates, setPrivates] = useState<PrivateClass[]>([]);
  const [privateAnalytics, setPrivateAnalytics] = useState<PrivateAnalytics | null>(null);
  const [coverage, setCoverage] = useState<TutorCoverage | null>(null);
  const [closedDays, setClosedDays] = useState<ClosedDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const saved = window.localStorage.getItem(VIEW_KEY);
    if (saved === "calendar" || saved === "list") setView(saved);
  }, []);

  function chooseView(next: View) {
    setView(next);
    window.localStorage.setItem(VIEW_KEY, next);
  }

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/admin/schedule", { cache: "no-store" }).then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Unable to load school schedule");
        return data;
      }),
      fetch("/api/schedule/closed-days", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { closedDays: [] }))
        .catch(() => ({ closedDays: [] })),
      fetch("/api/admin/tutor-coverage", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([schedule, closed, cover]) => {
        setGroups(schedule.groupSessions ?? []);
        setPrivates(schedule.privateClasses ?? []);
        setPrivateAnalytics(schedule.privateAnalytics ?? null);
        setClosedDays(closed.closedDays ?? []);
        setCoverage(cover ?? null);
        setError("");
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load school schedule"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AdminShell>
      <main className="p-8">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-[var(--accent)]">School calendar</p>
            <h1 className="mt-2 text-3xl font-bold">All schedules</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">Every active cohort and private booking in one admin view.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1">
              {(["calendar", "list"] as View[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => chooseView(option)}
                  aria-pressed={view === option}
                  className={`rounded-md px-3 py-1.5 text-sm font-semibold capitalize transition ${
                    view === option
                      ? "bg-[var(--accent)] text-white"
                      : "text-[var(--foreground-soft)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
            <Link
              href="/admin/schedule/holidays"
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold"
            >
              Holidays
            </Link>
            <Link
              href="/lecturer/timetable"
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold"
            >
              Edit group timetable
            </Link>
          </div>
        </div>

        {error && <p className="mb-4 rounded-lg bg-rose-500/10 p-4 text-rose-600">{error}</p>}

        {view === "calendar" ? (
          <AdminScheduleCalendar
            groups={groups}
            privates={privates}
            closedDays={closedDays}
            privateAnalytics={privateAnalytics}
            coverage={coverage}
            loading={loading}
            onReload={load}
          />
        ) : (
          <AdminScheduleList
            groups={groups}
            privates={privates}
            privateAnalytics={privateAnalytics}
            loading={loading}
            onReload={load}
          />
        )}

        <TutorCoveragePanel coverage={coverage} loading={loading} onReload={load} />
      </main>
    </AdminShell>
  );
}
