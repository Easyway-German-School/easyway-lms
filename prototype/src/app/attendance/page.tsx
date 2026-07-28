"use client";

export const dynamic = "force-dynamic";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

type AttendanceRecord = {
  id: string;
  date: string;
  status: "present" | "absent" | "late" | "excused";
  course?: { title: string };
  notes?: string;
};

import StudentShell from "@/components/StudentShell";
import StudentAccessGate from "@/components/StudentAccessGate";

export default function AttendancePage() {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paymentReady, setPaymentReady] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(true);
  const [stats, setStats] = useState({
    total: 0,
    present: 0,
    absent: 0,
    late: 0,
    excused: 0,
  });

  useEffect(() => {
    async function loadAttendance() {
      try {
        const res = await fetch("/api/student/attendance");
        if (res.status === 401) {
          setError("Please log in to view your attendance");
          setLoading(false);
          return;
        }
        if (!res.ok) throw new Error("Failed to load attendance");
        const data = await res.json();
        setRecords(data.records || []);
        setStats((prev) => data.stats || prev);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load attendance");
      } finally {
        setLoading(false);
      }
    }

    loadAttendance();
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await fetch("/api/student", { credentials: "include" });
        if (!active) return;
        if (res.ok) {
          const data = await res.json();
          const hasAccess = Boolean(data?.paymentSummary?.depositPaid || data?.paymentSummary?.fullPaid);
          setPaymentReady(hasAccess);
        }
      } catch {
        // ignore
      } finally {
        if (active) setPaymentLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const statusColor = (status: string) => {
    switch (status) {
      case "present":
        return "bg-emerald-500/10 text-emerald-700 border-emerald-500/20";
      case "absent":
        return "bg-red-500/10 text-red-700 border-red-500/20";
      case "late":
        return "bg-yellow-500/10 text-yellow-700 border-yellow-500/20";
      case "excused":
        return "bg-orange-500/10 text-orange-700 border-orange-500/20";
      default:
        return "bg-gray-500/10 text-gray-700 border-gray-500/20";
    }
  };

  const attendancePercentage = stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0;

  return (
    <StudentShell>
      <StudentAccessGate hasAccess={paymentReady} loading={paymentLoading}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="min-h-screen bg-[var(--background)] px-6 py-10 text-[var(--foreground)]"
        >
          <div className="mx-auto max-w-6xl space-y-8">
            <div className="rounded-3xl bg-[var(--surface)] p-8 shadow-xl ring-1 ring-white/10">
              <p className="text-sm uppercase tracking-[0.24em] text-[var(--accent)]">Your record</p>
              <h1 className="mt-3 text-4xl font-bold">Attendance</h1>
              <p className="mt-2 text-[var(--muted)]">Track your attendance across all courses</p>
            </div>

            {error && (
              <div className="rounded-xl bg-red-500/10 p-4 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-5">
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6">
                <p className="text-sm text-[var(--muted)]">Total sessions</p>
                <p className="mt-2 text-3xl font-bold">{stats.total}</p>
              </div>
              <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/5 p-6">
                <p className="text-sm text-emerald-700">Present</p>
                <p className="mt-2 text-3xl font-bold text-emerald-600">{stats.present}</p>
              </div>
              <div className="rounded-3xl border border-red-500/20 bg-red-500/5 p-6">
                <p className="text-sm text-red-700">Absent</p>
                <p className="mt-2 text-3xl font-bold text-red-600">{stats.absent}</p>
              </div>
              <div className="rounded-3xl border border-yellow-500/20 bg-yellow-500/5 p-6">
                <p className="text-sm text-yellow-700">Late</p>
                <p className="mt-2 text-3xl font-bold text-yellow-600">{stats.late}</p>
              </div>
              <div className="rounded-3xl border border-orange-500/20 bg-orange-500/5 p-6">
                <p className="text-sm text-orange-700">Excused</p>
                <p className="mt-2 text-3xl font-bold text-orange-600">{stats.excused}</p>
              </div>
            </div>

            <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-8">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[var(--muted)]">Attendance rate</p>
                  <p className="mt-2 text-4xl font-bold">{attendancePercentage}%</p>
                </div>
                <div className="h-32 w-32 rounded-full border-8 border-[var(--accent)] flex items-center justify-center bg-[var(--accent)]/5">
                  <span className="text-3xl font-bold text-[var(--accent)]">{attendancePercentage}%</span>
                </div>
              </div>
              <div className="mt-6 h-2 overflow-hidden rounded-full bg-[var(--surface-alt)]">
                <div
                  className="h-full bg-[var(--accent)]"
                  style={{ width: `${attendancePercentage}%` }}
                />
              </div>
            </div>

            {loading ? (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-12 text-center">
                <p className="text-[var(--muted)]">Loading records…</p>
              </div>
            ) : records.length === 0 ? (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-12 text-center">
                <p className="text-lg font-semibold">No attendance records yet</p>
                <p className="mt-2 text-[var(--muted)]">Your attendance will appear here once sessions begin</p>
              </div>
            ) : (
              <div className="space-y-3">
                <h2 className="text-xl font-semibold">Recent attendance</h2>
                {records.slice(0, 20).map((record) => (
                  <motion.div
                    key={record.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`flex items-center justify-between rounded-xl border p-4 ${statusColor(record.status)}`}
                  >
                    <div>
                      <p className="font-semibold">{record.course?.title || "Course"}</p>
                      <p className="text-sm">{new Date(record.date).toLocaleDateString()}</p>
                      {record.notes && <p className="mt-1 text-xs opacity-75">{record.notes}</p>}
                    </div>
                    <span className="rounded-full px-3 py-1 text-sm font-semibold uppercase">
                      {record.status}
                    </span>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      </StudentAccessGate>
    </StudentShell>
  );
}
