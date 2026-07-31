"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

export type LecturerStudent = {
  id: string;
  name: string;
  email: string;
  studentCode: string | null;
  level: string;
  sessionSlot: string;
  classType: string;
  status: string;
  pathway: string;
  joinedAt: string;
  phone: string | null;
  city: string | null;
  country: string | null;
  batch: string | null;
  photoUrl: string | null;
  totalPaid: number;
  tuitionFee: number;
  outstanding: number;
  hasAccess: boolean;
  attendanceRate: number | null;
  sessionsRecorded: number;
  submissions: number;
  certificates: number;
};

/**
 * The tutor's class list, with the picker the attendance page was missing.
 *
 * Shared between /lecturer/students and the attendance tab so a tutor sees the
 * same names and the same details in both places — two roster views that
 * disagreed would be worse than one.
 */

function naira(amount: number) {
  return `₦${Math.max(0, Math.round(amount)).toLocaleString()}`;
}

function Avatar({ student }: { student: LecturerStudent }) {
  if (student.photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={student.photoUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />;
  }
  return (
    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-sm font-bold text-[var(--accent)]">
      {student.name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function DetailPanel({ student }: { student: LecturerStudent }) {
  // `capitalize` is opt-in per row. Applied to the whole list it title-cased
  // email addresses into things like "Jasonoamen@Gmail.Com".
  const facts: Array<[string, string, boolean?]> = [
    ["Student code", student.studentCode || "—"],
    ["Email", student.email],
    ["Phone", student.phone || "—"],
    ["Location", [student.city, student.country].filter(Boolean).join(", ") || "—"],
    ["Batch", student.batch || "—"],
    ["Session", student.sessionSlot, true],
    ["Class type", student.classType, true],
    ["Pathway", student.pathway],
    ["Joined", new Date(student.joinedAt).toLocaleDateString()],
    ["Attendance", student.attendanceRate === null ? "No sessions recorded yet" : `${student.attendanceRate}% of ${student.sessionsRecorded}`],
    ["Assignments handed in", String(student.submissions)],
    ["Certificates", String(student.certificates)],
  ];

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar student={student} />
        <div className="min-w-0">
          <p className="font-bold text-[var(--foreground)]">{student.name}</p>
          <p className="text-xs text-[var(--muted)]">{student.studentCode || student.email}</p>
        </div>
        <span
          className={`ml-auto rounded-full px-3 py-1 text-xs font-semibold ${
            student.hasAccess ? "bg-emerald-500/10 text-emerald-700" : "bg-amber-500/15 text-amber-800"
          }`}
        >
          {student.hasAccess ? "Tuition cleared to attend" : `${naira(student.outstanding)} outstanding`}
        </span>
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
        {facts.map(([label, value, capitalise]) => (
          <div key={label} className="flex justify-between gap-3 border-b border-[var(--border)]/50 pb-1.5 last:border-0">
            <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</dt>
            <dd className={`break-all text-right text-sm font-medium text-[var(--foreground)] ${capitalise ? "capitalize" : ""}`}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function LecturerStudentRoster({ compact = false }: { compact?: boolean }) {
  const [students, setStudents] = useState<LecturerStudent[]>([]);
  const [cohortLabel, setCohortLabel] = useState<string | null>(null);
  const [assigned, setAssigned] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/lecturer/students", { cache: "no-store" });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(payload.error || "Could not load your students");
          return;
        }
        setStudents(payload.students || []);
        setCohortLabel(payload.cohortLabel ?? null);
        setAssigned(Boolean(payload.assigned));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Could not load your students");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return students;
    return students.filter((student) =>
      [student.name, student.email, student.studentCode, student.phone]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term)),
    );
  }, [students, query]);

  const selected = students.find((student) => student.id === selectedId) ?? null;

  if (loading) return <p className="text-sm text-[var(--muted)]">Loading your students…</p>;
  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>;

  if (!assigned) {
    return (
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
        <p className="font-semibold">You have no class assigned yet</p>
        <p className="mt-1">Set your branch, level and session and your students appear here automatically.</p>
        <Link href="/lecturer/classes" className="mt-3 inline-flex rounded-full bg-[var(--accent)] px-5 py-2 text-xs font-semibold text-white">
          Customise my classes
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Your class</p>
          <p className="font-semibold text-[var(--foreground)]">{cohortLabel}</p>
        </div>
        <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--accent)]">
          {students.length} student{students.length === 1 ? "" : "s"}
        </span>

        {/* The picker the attendance tab was missing. */}
        <select
          value={selectedId}
          onChange={(event) => setSelectedId(event.target.value)}
          className="ml-auto rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm text-[var(--foreground)]"
        >
          <option value="">Pick a student to see their details…</option>
          {students.map((student) => (
            <option key={student.id} value={student.id}>
              {student.name}
              {student.studentCode ? ` · ${student.studentCode}` : ""}
            </option>
          ))}
        </select>
      </div>

      {selected ? <DetailPanel student={selected} /> : null}

      {students.length === 0 ? (
        <p className="rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-6 text-sm text-[var(--muted)]">
          Nobody has enrolled in this class yet. New students appear here the moment they register for your branch, level
          and session — you do not have to add them.
        </p>
      ) : compact ? null : (
        <>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, email, phone or student code…"
            className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm text-[var(--foreground)] placeholder-[var(--muted)]"
          />

          <div className="overflow-x-auto rounded-2xl border border-[var(--border)]">
            <table className="w-full text-left text-sm">
              <thead className="bg-[var(--surface-alt)] text-xs uppercase tracking-wide text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Attendance</th>
                  <th className="px-4 py-3">Tuition</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((student) => (
                  <tr key={student.id} className="border-t border-[var(--border)]/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar student={student} />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-[var(--foreground)]">{student.name}</p>
                          <p className="truncate text-xs text-[var(--muted)]">{student.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[var(--muted)]">{student.studentCode || "—"}</td>
                    <td className="px-4 py-3 text-[var(--muted)]">{student.phone || "—"}</td>
                    <td className="px-4 py-3 text-[var(--muted)]">
                      {student.attendanceRate === null ? "—" : `${student.attendanceRate}%`}
                    </td>
                    <td className="px-4 py-3">
                      {student.hasAccess ? (
                        <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700">Cleared</span>
                      ) : (
                        <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-800">
                          {naira(student.outstanding)} owing
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setSelectedId(student.id)}
                        className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--foreground)]"
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
