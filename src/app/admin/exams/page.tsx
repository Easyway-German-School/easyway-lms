"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { type StudentWithUser } from "@/types/admin";

type ExamWithStudent = {
  id: string;
  studentId: string;
  student: StudentWithUser;
  examName: string;
  examDate: string;
  status: string;
  notes?: string | null;
  createdAt: string;
};

export default function AdminExamsPage() {
  const [exams, setExams] = useState<ExamWithStudent[]>([]);
  const [students, setStudents] = useState<StudentWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingExamId, setEditingExamId] = useState<string | null>(null);
  const [studentId, setStudentId] = useState("");
  const [examName, setExamName] = useState("");
  const [examDate, setExamDate] = useState("");
  const [status, setStatus] = useState("registered");
  const [notes, setNotes] = useState("");
  const [examError, setExamError] = useState("");

  async function loadStudents() {
    const res = await fetch("/api/admin/students");
    if (res.ok) {
      const data = await res.json();
      setStudents(data.students || []);
    }
  }

  async function loadExams() {
    setLoading(true);
    const res = await fetch("/api/admin/exams");
    if (res.ok) {
      const data = await res.json();
      setExams(data.exams || []);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadStudents();
    loadExams();
  }, []);

  async function handleSaveExam() {
    setExamError("");
    if (!studentId.trim() || !examName.trim() || !examDate.trim()) {
      setExamError("Student, exam name, and date are required.");
      return;
    }

    const payload = {
      studentId: studentId.trim(),
      examName: examName.trim(),
      examDate: examDate.trim(),
      status,
      notes: notes.trim() || null,
    } as const;

    const res = await fetch("/api/admin/exams", {
      method: editingExamId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editingExamId ? { examId: editingExamId, ...payload } : payload),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setExamError(data?.error || "Unable to save exam registration.");
      return;
    }

    setEditingExamId(null);
    setStudentId("");
    setExamName("");
    setExamDate("");
    setStatus("registered");
    setNotes("");
    setShowForm(false);
    loadExams();
  }

  function startEditingExam(exam: ExamWithStudent) {
    setEditingExamId(exam.id);
    setStudentId(exam.studentId);
    setExamName(exam.examName);
    setExamDate(exam.examDate.split("T")[0]);
    setStatus(exam.status || "registered");
    setNotes(exam.notes || "");
    setExamError("");
    setShowForm(true);
  }

  function cancelEditingExam() {
    setEditingExamId(null);
    setStudentId("");
    setExamName("");
    setExamDate("");
    setStatus("registered");
    setNotes("");
    setExamError("");
    setShowForm(false);
  }

  async function handleDeleteExam(examId: string) {
    if (!confirm("Delete this exam registration? This cannot be undone.")) {
      return;
    }

    const res = await fetch("/api/admin/exams", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ examId }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setExamError(data?.error || "Unable to delete exam registration.");
      return;
    }

    if (editingExamId === examId) {
      cancelEditingExam();
    }

    loadExams();
  }

  return (
    <AdminShell>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Admin</p>
            <h1 className="text-3xl font-bold">Exam Registrations</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">Register and manage student exams.</p>
          </div>
          <button
            type="button"
            className="rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white"
            onClick={() => setShowForm((current) => !current)}
          >
            {showForm ? "Close form" : "Register exam"}
          </button>
        </div>

        {showForm ? (
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-[var(--muted)]">Student</span>
                <select
                  value={studentId}
                  onChange={(event) => setStudentId(event.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                >
                  <option value="">Select a student</option>
                  {students.map((student) => (
                    <option key={student.id} value={student.id}>
                      {student.user.name} ({student.user.email})
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-[var(--muted)]">Exam name</span>
                <input
                  value={examName}
                  onChange={(event) => setExamName(event.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                  placeholder="e.g., B2 End-of-Level Exam"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-[var(--muted)]">Exam date</span>
                <input
                  type="date"
                  value={examDate}
                  onChange={(event) => setExamDate(event.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-[var(--muted)]">Status</span>
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                >
                  <option value="registered">Registered</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>
              <label className="space-y-2 text-sm md:col-span-2">
                <span className="font-semibold text-[var(--muted)]">Notes</span>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                  placeholder="Optional notes about this exam"
                  rows={3}
                />
              </label>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={handleSaveExam}
                className="rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white"
              >
                {editingExamId ? "Update exam" : "Register exam"}
              </button>
              {editingExamId ? (
                <button
                  type="button"
                  onClick={cancelEditingExam}
                  className="rounded-lg border border-[var(--border)] bg-white px-4 py-3 text-sm font-semibold text-slate-700"
                >
                  Cancel
                </button>
              ) : null}
              {examError ? <p className="text-sm text-red-500">{examError}</p> : null}
            </div>
          </div>
        ) : null}

        <div className="overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--background)] shadow-sm">
          <table className="min-w-full divide-y divide-[var(--border)]">
            <thead className="bg-[var(--surface)] text-left text-sm uppercase tracking-[0.16em] text-[var(--muted)]">
              <tr>
                <th className="px-6 py-4">Student</th>
                <th className="px-6 py-4">Exam</th>
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)] bg-[var(--background)]">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-sm text-[var(--muted)]">Loading exams…</td>
                </tr>
              ) : exams.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-sm text-[var(--muted)]">No exam registrations yet.</td>
                </tr>
              ) : (
                exams.map((exam) => (
                  <tr key={exam.id}>
                    <td className="px-6 py-4">{exam.student.user.name}</td>
                    <td className="px-6 py-4">{exam.examName}</td>
                    <td className="px-6 py-4">{new Date(exam.examDate).toLocaleDateString()}</td>
                    <td className="px-6 py-4">{exam.status}</td>
                    <td className="px-6 py-4 flex gap-2">
                      <button
                        type="button"
                        className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                        onClick={() => startEditingExam(exam)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-red-500 text-red-600 px-3 py-2 text-sm"
                        onClick={() => handleDeleteExam(exam.id)}
                      >
                        Delete
                      </button>
                    </td>
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
