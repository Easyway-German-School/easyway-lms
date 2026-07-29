"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The student's class calendar.
 *
 * Reads the merged timetable from /api/schedule: the generated rotation for
 * which days the cohort meets, overlaid with whatever the tutor has set for
 * each day — real topic, clock times, postponements, and the material to
 * bring. Postponed and cancelled classes are shown in red so a student
 * scanning the month sees them without reading.
 */

type Material = { id: string; title: string; filePath: string; fileType: string };

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
  lecturerName: string | null;
  material: Material | null;
};

type Month = { label: string; patternLabel: string; sessions: Session[] };

type Payload = {
  level: string;
  months: Month[];
  currentLevel?: string;
  nextLevel?: string | null;
  viewingNextLevel?: boolean;
};

const SLOT_LABELS: Record<string, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
};

function isOff(status: string) {
  return status === "postponed" || status === "cancelled";
}

function SessionRow({ session }: { session: Session }) {
  const off = isOff(session.status);
  const date = new Date(session.date);

  return (
    <div
      className={`rounded-2xl border p-3 transition ${
        off
          ? "border-red-200 bg-red-50"
          : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)]/40"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-sm font-semibold ${off ? "text-red-700 line-through" : ""}`}>
            {session.weekday} {date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
          </p>
          <p className={`mt-0.5 text-sm ${off ? "text-red-600" : "text-[var(--muted)]"}`}>
            {session.topic || session.defaultFocus}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className={`text-xs font-semibold ${off ? "text-red-600" : "text-[var(--foreground)]"}`}>
            {session.startTime}–{session.endTime}
          </p>
          <p className="text-[11px] text-[var(--muted)]">
            {SLOT_LABELS[session.timeSlot] ?? session.timeSlot}
          </p>
        </div>
      </div>

      {off && (
        <p className="mt-2 rounded-lg bg-red-100 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-red-700">
          {session.status}
          {session.postponedTo &&
            ` — moved to ${new Date(session.postponedTo).toLocaleDateString()}`}
        </p>
      )}

      {session.material && (
        <a
          href={session.material.filePath}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-soft)] px-2 py-1 text-xs font-semibold text-[var(--accent)] hover:brightness-95"
        >
          📎 {session.material.title}
        </a>
      )}

      {session.lecturerName && (
        <p className="mt-2 text-[11px] text-[var(--muted)]">with {session.lecturerName}</p>
      )}
    </div>
  );
}

export default function SmartCalendarClient() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [previewLevel, setPreviewLevel] = useState<string | null>(null);

  const load = useCallback(async (level?: string | null) => {
    setLoading(true);
    try {
      const url = level ? `/api/schedule?level=${encodeURIComponent(level)}` : "/api/schedule";
      const res = await fetch(url, { cache: "no-store", credentials: "include" });
      if (!res.ok) throw new Error("Unable to load your schedule");
      setData(await res.json());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(previewLevel); }, [load, previewLevel]);

  if (loading) {
    return (
      <div className="rounded-[28px] border border-[var(--border)] bg-[var(--surface-alt)] p-6">
        <p className="text-sm text-[var(--muted)]">Loading schedule…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-[28px] border border-[var(--border)] bg-[var(--surface-alt)] p-6">
        <p className="text-sm text-red-600">{error || "No schedule available."}</p>
      </div>
    );
  }

  const totalSessions = data.months.reduce((n, m) => n + m.sessions.length, 0);

  return (
    <div className="space-y-5">
      {data.nextLevel && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setPreviewLevel(null)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              !data.viewingNextLevel
                ? "bg-[var(--accent)] text-white"
                : "border border-[var(--border)] hover:bg-[var(--surface-alt)]"
            }`}
          >
            {data.currentLevel} · current
          </button>
          <button
            onClick={() => setPreviewLevel(data.nextLevel!)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              data.viewingNextLevel
                ? "bg-[var(--accent)] text-white"
                : "border border-[var(--border)] hover:bg-[var(--surface-alt)]"
            }`}
          >
            {data.nextLevel} · next level
          </button>
          {data.viewingNextLevel && (
            <span className="text-xs text-[var(--muted)]">
              Preview of the timetable you move onto after {data.currentLevel}.
            </span>
          )}
        </div>
      )}

      {totalSessions === 0 ? (
        <div className="rounded-[28px] border border-[var(--border)] bg-[var(--surface-alt)] p-6 text-sm text-[var(--muted)]">
          No classes scheduled for this level yet.
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {data.months.map((month) => (
            <div key={month.label} className="rounded-[28px] border border-[var(--border)] bg-[var(--surface-alt)] p-5">
              <div className="mb-4 flex items-baseline justify-between gap-2">
                <h3 className="text-lg font-bold">{month.label}</h3>
                <span className="text-xs text-[var(--muted)]">{month.patternLabel}</span>
              </div>
              <div className="space-y-2">
                {month.sessions.map((s) => (
                  <SessionRow key={s.date} session={s} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
