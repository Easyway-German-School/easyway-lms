"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import AdminShell from "@/components/AdminShell";

const STATUSES = ["pending", "registered", "completed", "cancelled"] as const;

type ExamRegistration = {
  id: string;
  examName: string;
  examDate: string;
  status: string;
  notes?: string | null;
  student: {
    id: string;
    user: { name?: string | null; email: string };
    branch?: { name: string } | null;
  };
};

function ExamRegistrations() {
  const params = useSearchParams();
  const [registrations, setRegistrations] = useState<ExamRegistration[]>([]);
  /**
   * The dashboard counts registrations awaiting confirmation and links here.
   * The page had no filter at all, so it arrived showing every registration
   * ever taken and the reader had to pick the pending ones out by eye.
   */
  const [statusFilter, setStatusFilter] = useState<string>(() => {
    const requested = params.get("status");
    return requested && (STATUSES as readonly string[]).includes(requested) ? requested : "";
  });
  const [loading, setLoading] = useState(true);
  const [studentId, setStudentId] = useState("");
  const [examName, setExamName] = useState("");
  const [examDate, setExamDate] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  async function loadRegistrations() {
    setLoading(true);
    const res = await fetch("/api/admin/exam-registrations");
    if (res.ok) {
      const data = await res.json();
      setRegistrations(data.registrations || []);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadRegistrations();
  }, []);

  const visible = useMemo(
    () => (statusFilter ? registrations.filter((row) => row.status === statusFilter) : registrations),
    [registrations, statusFilter],
  );

  async function handleSave() {
    setError("");

    if (!studentId.trim() || !examName.trim() || !examDate.trim()) {
      setError("Student ID, exam name, and exam date are required.");
      return;
    }

    const res = await fetch("/api/admin/exam-registrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId: studentId.trim(), examName: examName.trim(), examDate, notes: notes.trim() || null }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.error || "Unable to save exam registration.");
      return;
    }

    setStudentId("");
    setExamName("");
    setExamDate("");
    setNotes("");
    loadRegistrations();
  }

  return (
    <AdminShell>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Admin</p>
            <h1 className="text-3xl font-bold">Exam registrations</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">Register students for upcoming exams and review registrations.</p>
          </div>
        </div>

        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <label className="space-y-2 text-sm">
              <span className="font-semibold text-[var(--muted)]">Student ID</span>
              <input value={studentId} onChange={(event) => setStudentId(event.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm" />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-semibold text-[var(--muted)]">Exam name</span>
              <input value={examName} onChange={(event) => setExamName(event.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm" />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-semibold text-[var(--muted)]">Exam date</span>
              <input type="date" value={examDate} onChange={(event) => setExamDate(event.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm" />
            </label>
          </div>

          <label className="mt-4 block text-sm">
            <span className="font-semibold text-[var(--muted)]">Notes</span>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm" rows={3} />
          </label>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button type="button" onClick={handleSave} className="rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white">Save registration</button>
            {error ? <p className="text-sm text-red-500">{error}</p> : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setStatusFilter("")}
            className={`rounded-full border px-4 py-2 text-sm font-semibold capitalize transition ${
              statusFilter === ""
                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                : "border-[var(--border)] bg-white hover:bg-slate-50"
            }`}
          >
            All ({registrations.length})
          </button>
          {STATUSES.map((option) => {
            const count = registrations.filter((registration) => registration.status === option).length;
            return (
              <button
                key={option}
                type="button"
                onClick={() => setStatusFilter(option)}
                className={`rounded-full border px-4 py-2 text-sm font-semibold capitalize transition ${
                  statusFilter === option
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border-[var(--border)] bg-white hover:bg-slate-50"
                }`}
              >
                {option} ({count})
              </button>
            );
          })}
        </div>

        <div className="overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--background)] shadow-sm">
          <table className="min-w-full divide-y divide-[var(--border)]">
            <thead className="bg-[var(--surface)] text-left text-sm uppercase tracking-[0.16em] text-[var(--muted)]">
              <tr>
                <th className="px-6 py-4">Student</th>
                <th className="px-6 py-4">Exam</th>
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)] bg-[var(--background)]">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-sm text-[var(--muted)]">Loading exam registrations…</td>
                </tr>
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-sm text-[var(--muted)]">
                    {statusFilter ? `No ${statusFilter} registrations.` : "No registrations yet."}
                  </td>
                </tr>
              ) : (
                visible.map((registration) => (
                  <tr key={registration.id} className={statusFilter ? "bg-[var(--accent)]/5" : undefined}>
                    <td className="px-6 py-4">
                      {registration.student.user.name || registration.student.user.email}
                      <div className="text-xs text-[var(--muted)]">{registration.student.user.email}</div>
                    </td>
                    <td className="px-6 py-4">{registration.examName}</td>
                    <td className="px-6 py-4">{new Date(registration.examDate).toLocaleDateString()}</td>
                    <td className="px-6 py-4 capitalize">{registration.status}</td>
                    <td className="px-6 py-4">{registration.notes || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  );
}

export default function AdminExamRegistrationsPage() {
  // useSearchParams needs a Suspense boundary above it.
  return (
    <Suspense
      fallback={
        <AdminShell>
          <p className="p-6 text-sm text-[var(--muted)]">Loading registrations…</p>
        </AdminShell>
      }
    >
      <ExamRegistrations />
    </Suspense>
  );
}
