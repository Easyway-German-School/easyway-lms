"use client";

import { useCallback, useEffect, useState } from "react";
import { AttendanceIcon } from "@/components/icons";

/**
 * The office's class register: branch → class → sitting → everybody in it.
 *
 * The page this sits on already had an attendance table, but it was a LOG —
 * every Attendance row in the school, newest first. A log can only show you
 * students somebody already marked, which makes it useless for the one
 * question the attendance monitor actually asks: who is missing from this
 * class today. That question is answered from the roster, not the marks.
 */

type Option = { id: string; name: string; mode: string };

type Row = {
  id: string;
  name: string;
  email: string;
  studentCode: string | null;
  level: string;
  sessionSlot: string;
  phone: string | null;
  batch: string | null;
  mark: "present" | "absent" | "unmarked";
  notes: string | null;
  termRate: number | null;
  sessionsRecorded: number;
};

type Payload = {
  branches: Option[];
  levels: readonly string[];
  slots: readonly string[];
  chosen: boolean;
  date?: string;
  classSession: {
    status: string;
    postponedTo: string | null;
    topic: string | null;
    startTime: string | null;
    endTime: string | null;
    tutorName: string | null;
  } | null;
  summary: { total: number; present: number; absent: number; unmarked: number } | null;
  students: Row[];
};

const MARK_STYLES: Record<string, string> = {
  present: "bg-emerald-500/10 text-emerald-700",
  absent: "bg-red-500/10 text-red-700",
  // Deliberately amber rather than red: nobody took the register is a
  // different problem from the student not turning up, and the office needs to
  // chase a tutor for one and a student for the other.
  unmarked: "bg-amber-500/15 text-amber-800",
};

const MARK_LABELS: Record<string, string> = {
  present: "Present",
  absent: "Absent",
  unmarked: "Not marked",
};

export default function AttendanceRegister() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [branchId, setBranchId] = useState("");
  const [level, setLevel] = useState("");
  const [slot, setSlot] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ date });
      if (branchId) query.set("branchId", branchId);
      if (level) query.set("level", level);
      if (slot) query.set("slot", slot);

      const res = await fetch(`/api/admin/attendance/register?${query.toString()}`, { cache: "no-store" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Could not load the register");
      setData(payload);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load the register");
    } finally {
      setLoading(false);
    }
  }, [branchId, level, slot, date]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = data?.summary;
  const session = data?.classSession;

  return (
    <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold">
            <AttendanceIcon className="h-6 w-6 text-[var(--accent)]" />
            Class register
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Pick a branch, a class and a sitting to see everybody in it and who was marked.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Branch
          <select
            value={branchId}
            onChange={(event) => setBranchId(event.target.value)}
            className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm font-normal normal-case tracking-normal text-[var(--foreground)]"
          >
            <option value="">Select a branch…</option>
            {data?.branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
                {branch.mode === "online" ? " (online)" : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Class
          <select
            value={level}
            onChange={(event) => setLevel(event.target.value)}
            className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm font-normal normal-case tracking-normal text-[var(--foreground)]"
          >
            <option value="">Select a class…</option>
            {data?.levels.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Session
          <select
            value={slot}
            onChange={(event) => setSlot(event.target.value)}
            className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm font-normal normal-case tracking-normal capitalize text-[var(--foreground)]"
          >
            <option value="">All sittings</option>
            {data?.slots.map((item) => (
              <option key={item} value={item}>
                {item.charAt(0).toUpperCase() + item.slice(1)}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Date
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm font-normal normal-case tracking-normal text-[var(--foreground)]"
          />
        </label>
      </div>

      {error ? (
        <p className="mt-4 rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-700">{error}</p>
      ) : null}

      {!data?.chosen ? (
        <p className="mt-5 rounded-2xl border border-dashed border-[var(--border)] p-5 text-sm text-[var(--muted)]">
          Choose a branch and a class above to load the register.
        </p>
      ) : loading ? (
        <p className="mt-5 text-sm text-[var(--muted)]">Loading the register…</p>
      ) : (
        <>
          {session ? (
            <div
              className={`mt-5 rounded-2xl px-4 py-3 text-sm ${
                session.status === "postponed"
                  ? "bg-pink-100 text-pink-900"
                  : session.status === "cancelled"
                    ? "bg-red-100 text-red-800"
                    : "bg-[var(--surface-alt)] text-[var(--foreground-soft)]"
              }`}
            >
              <p className="font-semibold capitalize">
                {session.status === "scheduled" ? "Class running" : session.status}
                {session.startTime ? ` · ${session.startTime}–${session.endTime}` : ""}
              </p>
              {session.topic ? <p className="mt-0.5">{session.topic}</p> : null}
              {session.tutorName ? <p className="mt-0.5 text-xs">Tutor: {session.tutorName}</p> : null}
              {session.postponedTo ? (
                <p className="mt-0.5 text-xs font-semibold">
                  Moved to {new Date(session.postponedTo).toLocaleDateString()}
                </p>
              ) : null}
            </div>
          ) : null}

          {summary ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-4">
              {[
                ["In this class", summary.total, "text-[var(--foreground)]"],
                ["Present", summary.present, "text-emerald-700"],
                ["Absent", summary.absent, "text-red-700"],
                ["Not marked", summary.unmarked, "text-amber-700"],
              ].map(([label, value, tone]) => (
                <div key={String(label)} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-4">
                  <p className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</p>
                  <p className={`mt-1 text-2xl font-bold ${tone}`}>{value}</p>
                </div>
              ))}
            </div>
          ) : null}

          {data.students.length === 0 ? (
            <p className="mt-5 rounded-2xl border border-dashed border-[var(--border)] p-5 text-sm text-[var(--muted)]">
              Nobody is registered for this class yet.
            </p>
          ) : (
            <div className="mt-5 overflow-x-auto rounded-2xl border border-[var(--border)]">
              <table className="w-full text-left text-sm">
                <thead className="bg-[var(--surface-alt)] text-xs uppercase tracking-wide text-[var(--muted)]">
                  <tr>
                    <th className="px-4 py-3">Student</th>
                    <th className="px-4 py-3">Code</th>
                    <th className="px-4 py-3">Session</th>
                    <th className="px-4 py-3">Batch</th>
                    <th className="px-4 py-3">This day</th>
                    <th className="px-4 py-3">Term rate</th>
                  </tr>
                </thead>
                <tbody>
                  {data.students.map((student) => (
                    <tr key={student.id} className="border-t border-[var(--border)]/60">
                      <td className="px-4 py-3">
                        <p className="font-medium text-[var(--foreground)]">{student.name}</p>
                        <p className="text-xs text-[var(--muted)]">{student.phone || student.email}</p>
                      </td>
                      <td className="px-4 py-3 text-[var(--muted)]">{student.studentCode || "—"}</td>
                      <td className="px-4 py-3 capitalize text-[var(--muted)]">{student.sessionSlot}</td>
                      <td className="px-4 py-3 text-[var(--muted)]">{student.batch || "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${MARK_STYLES[student.mark]}`}>
                          {MARK_LABELS[student.mark]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[var(--muted)]">
                        {student.termRate === null ? "—" : `${student.termRate}% of ${student.sessionsRecorded}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
