"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { AlertIcon, ResultsIcon } from "@/components/icons";

/**
 * The school-wide gradebook — read only.
 *
 * One row per tutor, sorted by how many core-skill marks they still owe, with
 * their class opening up underneath. It is the marking queue's counterpart for
 * hand-keyed scores: the office watches, the tutor writes.
 */

type Student = {
  id: string;
  name: string;
  studentCode: string | null;
  level: string;
  sessionSlot: string;
  average: number | null;
  letter: string | null;
  passing: boolean | null;
  owed: number;
  lastEntryAt: string | null;
};

type Tutor = {
  lecturerId: string;
  name: string;
  email: string;
  status: string;
  studentCount: number;
  gradedCount: number;
  owedTotal: number;
  classAverage: number | null;
  lastEntryAt: string | null;
  students: Student[];
};

type Payload = {
  passMark: number;
  requiredTypes: string[];
  tutors: Tutor[];
  totals: { tutors: number; students: number; owed: number; unmarkedStudents: number };
};

const LETTER_TONE: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-800",
  B: "bg-sky-100 text-sky-800",
  C: "bg-amber-100 text-amber-800",
  D: "bg-orange-100 text-orange-800",
  F: "bg-rose-100 text-rose-800",
};

function ago(iso: string | null): string {
  if (!iso) return "never";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return `${Math.floor(days / 7)} weeks ago`;
}

export default function AdminGradebookPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/gradebook", { cache: "no-store" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Could not load the gradebook");
      setData(payload);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load the gradebook");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totals = data?.totals;
  const behind = useMemo(
    () => (data?.tutors ?? []).filter((tutor) => tutor.owedTotal > 0).length,
    [data],
  );

  return (
    <AdminShell>
      <div className="min-w-0 space-y-5 p-4 sm:p-6">
        <header>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold text-[var(--foreground)] sm:text-3xl">
            <ResultsIcon className="h-6 w-6 shrink-0 text-[var(--accent)]" />
            School gradebook
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Every tutor&apos;s class and the marks they have entered. Read-only — a mark is the
            tutor&apos;s to enter and correct. For handed-in work that still needs marking, see the{" "}
            <a className="underline" href="/admin/marking">
              marking queue
            </a>
            .
          </p>
        </header>

        {error && (
          <p className="flex items-start gap-2 rounded-2xl bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-700">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        )}

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-2xl bg-[var(--surface-alt)]" />
            ))}
          </div>
        ) : !data || data.tutors.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[var(--border)] p-10 text-center text-sm text-[var(--muted)]">
            No tutor has a class with students assigned yet.
          </div>
        ) : (
          <>
            {totals && (
              <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
                <Stat label="Tutors marking" value={totals.tutors} />
                <Stat label="Students" value={totals.students} />
                <Stat
                  label="Core marks owed"
                  value={totals.owed}
                  alert={totals.owed > 0}
                  hint={behind > 0 ? `${behind} tutor${behind === 1 ? "" : "s"} behind` : "all caught up"}
                />
                <Stat
                  label="Students with no marks"
                  value={totals.unmarkedStudents}
                  alert={totals.unmarkedStudents > 0}
                />
              </div>
            )}

            <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
              <table className="w-full text-left text-sm">
                <thead className="bg-[var(--surface-alt)] text-xs uppercase tracking-wide text-[var(--muted)]">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Tutor</th>
                    <th className="px-3 py-3 text-center font-semibold">Students</th>
                    <th className="px-3 py-3 text-center font-semibold">Class avg</th>
                    <th className="px-3 py-3 text-center font-semibold">Core marks owed</th>
                    <th className="px-3 py-3 text-center font-semibold">Last entry</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tutors.map((tutor) => {
                    const expanded = open === tutor.lecturerId;
                    return (
                      <Fragment key={tutor.lecturerId}>
                        <tr
                          onClick={() => setOpen(expanded ? null : tutor.lecturerId)}
                          className="cursor-pointer border-t border-[var(--border)]/60 hover:bg-[var(--surface-alt)]"
                        >
                          <td className="px-4 py-3">
                            <p className="font-semibold text-[var(--foreground)]">
                              {tutor.name}
                              {tutor.status !== "active" && (
                                <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800">
                                  {tutor.status.replace("_", " ")}
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-[var(--muted)]">{tutor.email}</p>
                          </td>
                          <td className="px-3 py-3 text-center tabular-nums">
                            {tutor.gradedCount}/{tutor.studentCount}
                          </td>
                          <td className="px-3 py-3 text-center font-bold tabular-nums">
                            {tutor.classAverage ?? "—"}
                          </td>
                          <td className="px-3 py-3 text-center">
                            <span
                              className={`rounded-full px-2 py-1 text-xs font-bold tabular-nums ${
                                tutor.owedTotal > 0
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-emerald-100 text-emerald-800"
                              }`}
                            >
                              {tutor.owedTotal}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-center text-xs text-[var(--muted)]">
                            {ago(tutor.lastEntryAt)}
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="bg-[var(--surface-alt)]">
                            <td colSpan={5} className="px-4 py-3">
                              <table className="w-full text-left text-xs">
                                <thead className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
                                  <tr>
                                    <th className="py-1.5 font-semibold">Student</th>
                                    <th className="py-1.5 font-semibold">Level</th>
                                    <th className="py-1.5 text-center font-semibold">Average</th>
                                    <th className="py-1.5 text-center font-semibold">Core owed</th>
                                    <th className="py-1.5 text-center font-semibold">Last marked</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {tutor.students.map((student) => (
                                    <tr key={student.id} className="border-t border-[var(--border)]/40">
                                      <td className="py-1.5 text-[var(--foreground)]">
                                        {student.name}
                                        {student.studentCode && (
                                          <span className="ml-2 font-mono text-[var(--muted)]">
                                            {student.studentCode}
                                          </span>
                                        )}
                                      </td>
                                      <td className="py-1.5 text-[var(--muted)]">
                                        {student.level} · {student.sessionSlot}
                                      </td>
                                      <td className="py-1.5 text-center">
                                        {student.average === null ? (
                                          <span className="text-[var(--muted)]">—</span>
                                        ) : (
                                          <span
                                            className={`rounded-full px-2 py-0.5 font-bold tabular-nums ${
                                              LETTER_TONE[student.letter ?? ""] ??
                                              "bg-[var(--surface)] text-[var(--foreground-soft)]"
                                            }`}
                                          >
                                            {student.average} {student.letter}
                                          </span>
                                        )}
                                      </td>
                                      <td className="py-1.5 text-center tabular-nums">
                                        {student.owed > 0 ? (
                                          <span className="font-bold text-amber-700">{student.owed}</span>
                                        ) : (
                                          <span className="text-[var(--muted)]">0</span>
                                        )}
                                      </td>
                                      <td className="py-1.5 text-center text-[var(--muted)]">
                                        {ago(student.lastEntryAt)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </AdminShell>
  );
}

function Stat({
  label,
  value,
  hint,
  alert,
}: {
  label: string;
  value: string | number;
  hint?: string;
  alert?: boolean;
}) {
  return (
    <div
      className={`min-w-0 rounded-2xl border p-3.5 sm:p-4 ${
        alert ? "border-amber-300 bg-amber-50" : "border-[var(--border)] bg-[var(--surface)]"
      }`}
    >
      <p className="truncate text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="mt-1.5 text-2xl font-bold tabular-nums text-[var(--foreground)]">{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{hint}</p>}
    </div>
  );
}
