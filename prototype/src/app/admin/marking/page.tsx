"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import { PencilIcon } from "@/components/icons";

type Row = {
  id: string;
  studentId: string | null;
  studentName: string;
  studentEmail: string;
  branchId: string | null;
  branch: string;
  level: string;
  assignment: string;
  type: string;
  dueAt: string | null;
  lecturerId: string | null;
  lecturer: string;
  handedInAt: string;
  waitingDays: number;
  needsReview: boolean;
  mode: string;
  hasWriting: boolean;
  fileName: string | null;
};

type Payload = {
  totalCount: number;
  rows: Row[];
  byTutor: Array<{ id: string | null; name: string; waiting: number; oldestDays: number }>;
  canOpenStudentFiles: boolean;
};

/** Anything sitting this long is the reason the tile on the dashboard is red. */
const STALE_DAYS = 7;

function MarkingQueue() {
  const params = useSearchParams();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tutorFilter, setTutorFilter] = useState<string>(params.get("lecturerId") ?? "");

  const level = params.get("level");
  const branchId = params.get("branchId");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL("/api/admin/marking", window.location.origin);
      if (level) url.searchParams.set("level", level);
      if (branchId) url.searchParams.set("branchId", branchId);
      if (tutorFilter) url.searchParams.set("lecturerId", tutorFilter);
      const response = await fetch(url.toString(), { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load the marking queue");
      setData(await response.json());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load the marking queue");
    } finally {
      setLoading(false);
    }
  }, [level, branchId, tutorFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const oldest = useMemo(
    () => (data?.rows.length ? Math.max(...data.rows.map((row) => row.waitingDays)) : 0),
    [data],
  );

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Admin</p>
        <h1 className="text-3xl font-black tracking-tight">Marking queue</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Work students have handed in that carries no mark yet, oldest first.
          {level ? ` Filtered to ${level}.` : ""}
        </p>
      </div>

      {error && (
        <div className="rounded-3xl border border-red-300 bg-red-50 p-5 text-sm text-red-700">
          {error}
          <button type="button" onClick={() => void load()} className="ml-3 font-bold underline">
            Retry
          </button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-3xl border border-[var(--border)] bg-white/80 p-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">Waiting</p>
          <p className="mt-2 text-3xl font-black">{data?.totalCount ?? "—"}</p>
        </div>
        <div className="rounded-3xl border border-[var(--border)] bg-white/80 p-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">Longest wait</p>
          <p className={`mt-2 text-3xl font-black ${oldest >= STALE_DAYS ? "text-red-600" : ""}`}>
            {data ? `${oldest}d` : "—"}
          </p>
        </div>
        <div className="rounded-3xl border border-[var(--border)] bg-white/80 p-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">Tutors involved</p>
          <p className="mt-2 text-3xl font-black">{data?.byTutor.length ?? "—"}</p>
        </div>
      </div>

      {data && data.byTutor.length > 0 && (
        <div className="rounded-3xl border border-[var(--border)] bg-white/80 p-6">
          <h2 className="text-sm font-bold uppercase tracking-[0.18em]">Whose desk it is on</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setTutorFilter("")}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                tutorFilter === "" ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-[var(--border)] hover:bg-white"
              }`}
            >
              Everyone
            </button>
            {data.byTutor.map((tutor) => (
              <button
                key={tutor.id ?? "unassigned"}
                type="button"
                onClick={() => setTutorFilter(tutor.id ?? "")}
                disabled={!tutor.id}
                className={`rounded-full border px-4 py-2 text-sm font-semibold transition disabled:opacity-60 ${
                  tutorFilter && tutorFilter === tutor.id
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border-[var(--border)] hover:bg-white"
                }`}
              >
                {tutor.name}
                <span className="ml-2 text-xs text-[var(--muted)]">
                  {tutor.waiting} · oldest {tutor.oldestDays}d
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-3xl border border-[var(--border)] bg-white/80">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-[var(--border)] text-sm">
            <thead className="bg-[var(--surface)] text-left text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
              <tr>
                <th className="px-5 py-3">Student</th>
                <th className="px-5 py-3">Work</th>
                <th className="px-5 py-3">Level</th>
                <th className="px-5 py-3">Branch</th>
                <th className="px-5 py-3">Tutor</th>
                <th className="px-5 py-3 text-right">Waiting</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-[var(--muted)]">
                    Loading the queue…
                  </td>
                </tr>
              ) : !data || data.rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-[var(--muted)]">
                    Nothing is waiting to be marked.
                  </td>
                </tr>
              ) : (
                data.rows.map((row) => (
                  <tr key={row.id} className={row.waitingDays >= STALE_DAYS ? "bg-red-50/60" : undefined}>
                    <td className="px-5 py-3">
                      {data.canOpenStudentFiles && row.studentId ? (
                        <Link
                          href={`/admin/students/${row.studentId}`}
                          className="font-semibold underline-offset-4 hover:text-[var(--accent)] hover:underline"
                        >
                          {row.studentName}
                        </Link>
                      ) : (
                        <span className="font-semibold">{row.studentName}</span>
                      )}
                      <p className="text-xs text-[var(--muted)]">{row.studentEmail}</p>
                    </td>
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center gap-2 font-medium">
                        <PencilIcon className="h-3.5 w-3.5 text-[var(--accent)]" />
                        {row.assignment}
                      </span>
                      <p className="text-xs text-[var(--muted)]">
                        {row.type === "quiz" ? "Quiz" : "Document"}
                        {row.needsReview ? " · written answers need a tutor" : ""}
                        {row.mode === "physical" ? " · paper" : ""}
                      </p>
                    </td>
                    <td className="px-5 py-3 text-[var(--muted)]">{row.level}</td>
                    <td className="px-5 py-3 text-[var(--muted)]">{row.branch}</td>
                    <td className="px-5 py-3 text-[var(--muted)]">{row.lecturer}</td>
                    <td
                      className={`px-5 py-3 text-right font-bold ${
                        row.waitingDays >= STALE_DAYS ? "text-red-600" : "text-[var(--muted)]"
                      }`}
                    >
                      {row.waitingDays}d
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function AdminMarkingPage() {
  return (
    <AdminShell>
      {/* useSearchParams needs a Suspense boundary above it or the whole route
          opts out of static rendering and Next fails the build. */}
      <Suspense fallback={<div className="p-6 text-sm text-[var(--muted)]">Loading…</div>}>
        <MarkingQueue />
      </Suspense>
    </AdminShell>
  );
}
