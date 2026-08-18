"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { StudentWithUser } from "@/types/admin";
import BrandLoader from "@/components/BrandLoader";
import AttendanceRegister from "@/components/admin/AttendanceRegister";

interface AttendanceRecord {
  id: string;
  studentId: string;
  student: StudentWithUser;
  date: string;
  status: string;
  notes?: string;
  createdAt: string;
}

export default function AttendancePage() {
  const [attendances, setAttendances] = useState<AttendanceRecord[]>([]);
  const [students, setStudents] = useState<StudentWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    studentId: "",
    date: new Date().toISOString().split("T")[0],
    status: "present",
    notes: "",
  });

  useEffect(() => {
    Promise.all([loadAttendances(), loadStudents()]);
  }, []);

  async function loadAttendances() {
    try {
      const res = await fetch("/api/admin/attendance");
      if (!res.ok) throw new Error("Failed to fetch attendances");
      const data = await res.json();
      setAttendances(data);
    } catch (err) {
      setError("Failed to load attendances");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function loadStudents() {
    try {
      const res = await fetch("/api/admin/students");
      if (!res.ok) throw new Error("Failed to fetch students");
      const data = await res.json();
      setStudents(Array.isArray(data) ? data : data.students ?? []);
    } catch (err) {
      console.error("Failed to load students:", err);
    }
  }

  async function handleSaveAttendance(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.studentId || !formData.date) {
      setError("Please fill in all required fields");
      return;
    }

    try {
      const url = editingId
        ? "/api/admin/attendance"
        : "/api/admin/attendance";
      const method = editingId ? "PATCH" : "POST";
      const payload = editingId
        ? { id: editingId, ...formData }
        : formData;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error("Failed to save attendance");

      setError("");
      setFormData({
        studentId: "",
        date: new Date().toISOString().split("T")[0],
        status: "present",
        notes: "",
      });
      setEditingId(null);
      await loadAttendances();
    } catch (err) {
      setError("Failed to save attendance");
      console.error(err);
    }
  }

  function startEditingAttendance(record: AttendanceRecord) {
    setFormData({
      studentId: record.studentId,
      date: new Date(record.date).toISOString().split("T")[0],
      status: record.status,
      notes: record.notes || "",
    });
    setEditingId(record.id);
  }

  function cancelEditingAttendance() {
    setFormData({
      studentId: "",
      date: new Date().toISOString().split("T")[0],
      status: "present",
      notes: "",
    });
    setEditingId(null);
  }

  async function handleDeleteAttendance(id: string) {
    if (!confirm("Are you sure you want to delete this attendance record?"))
      return;

    try {
      const res = await fetch("/api/admin/attendance", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      if (!res.ok) throw new Error("Failed to delete attendance");

      setError("");
      await loadAttendances();
    } catch (err) {
      setError("Failed to delete attendance");
      console.error(err);
    }
  }

  if (loading) {
    return (
      <AdminShell>
        <BrandLoader fill size="lg" message="Loading attendance." />
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <div className="p-8">
        <h1 className="text-3xl font-bold mb-8">Attendance Tracking</h1>

        {error && (
          <div className="mb-4 p-4 bg-red-100 text-red-700 rounded">
            {error}
          </div>
        )}

        {/* The register goes first, because it answers the question whoever
            monitors attendance actually has: who is missing from this class
            today. Everything below it is a log of marks already made, which
            by definition cannot show you an absent student nobody recorded. */}
        <div className="mb-8">
          <AttendanceRegister />
        </div>

        {/* Form */}
        <div className="bg-[var(--surface)] rounded-lg border p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">
            {editingId ? "Edit Attendance" : "Record Attendance"}
          </h2>
          <form onSubmit={handleSaveAttendance} className="grid gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Student *
                </label>
                <select
                  value={formData.studentId}
                  onChange={(e) =>
                    setFormData({ ...formData, studentId: e.target.value })
                  }
                  className="w-full px-3 py-2 border rounded"
                  required
                >
                  <option value="">Select a student</option>
                  {students.map((student) => (
                    <option key={student.id} value={student.id}>
                      {student.user.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Date *
                </label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={(e) =>
                    setFormData({ ...formData, date: e.target.value })
                  }
                  className="w-full px-3 py-2 border rounded"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Status
                </label>
                <select
                  value={formData.status}
                  onChange={(e) =>
                    setFormData({ ...formData, status: e.target.value })
                  }
                  className="w-full px-3 py-2 border rounded"
                >
                  <option value="present">Present</option>
                  <option value="absent">Absent</option>
                  <option value="late">Late</option>
                  <option value="excused">Excused</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Notes</label>
                <input
                  type="text"
                  value={formData.notes}
                  onChange={(e) =>
                    setFormData({ ...formData, notes: e.target.value })
                  }
                  placeholder="Optional notes"
                  className="w-full px-3 py-2 border rounded"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                {editingId ? "Update" : "Record"} Attendance
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={cancelEditingAttendance}
                  className="px-4 py-2 bg-[var(--surface-alt)] text-[var(--foreground-soft)] rounded hover:bg-[var(--border)]"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Table */}
        <div className="bg-[var(--surface)] rounded-lg border overflow-hidden">
          <table className="w-full">
            <thead className="bg-[var(--surface-alt)] border-b">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-medium">
                  Student
                </th>
                <th className="px-6 py-3 text-left text-sm font-medium">
                  Date
                </th>
                <th className="px-6 py-3 text-left text-sm font-medium">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-sm font-medium">
                  Notes
                </th>
                <th className="px-6 py-3 text-left text-sm font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {attendances.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-4 text-center text-[var(--muted)]">
                    No attendance records
                  </td>
                </tr>
              ) : (
                attendances.map((record) => (
                  <tr key={record.id} className="border-b hover:bg-[var(--surface-alt)]">
                    <td className="px-6 py-3">{record.student.user.name}</td>
                    <td className="px-6 py-3">
                      {new Date(record.date).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={`px-3 py-1 rounded text-sm font-medium ${
                          record.status === "present"
                            ? "bg-green-100 text-green-700"
                            : record.status === "absent"
                            ? "bg-red-100 text-red-700"
                            : record.status === "late"
                            ? "bg-yellow-100 text-yellow-700"
                            : "bg-blue-100 text-blue-700"
                        }`}
                      >
                        {record.status}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-sm">{record.notes || "-"}</td>
                    <td className="px-6 py-3">
                      <button
                        onClick={() => startEditingAttendance(record)}
                        className="text-blue-600 hover:text-blue-800 mr-4"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteAttendance(record.id)}
                        className="text-red-600 hover:text-red-800"
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
