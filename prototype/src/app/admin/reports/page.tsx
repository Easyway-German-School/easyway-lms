"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";

export default function AdminReportsPage() {
  const [reports, setReports] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadReports();
  }, []);

  async function loadReports() {
    try {
      const res = await fetch("/api/admin/reports");
      if (!res.ok) throw new Error("Failed to load reports");
      const data = await res.json();
      setReports(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return (
    <AdminShell>
      <div className="p-8">Loading reports...</div>
    </AdminShell>
  );

  const examsByStatus = (reports?.examsByStatus as Record<string, number>) || {};
  const totalExams: number = Object.values(examsByStatus).reduce((a:any,b:any)=>Number(a||0)+Number(b||0),0);
  const attendanceSummary = (reports?.attendanceSummary as Record<string, number>) || { total: 0 };
  const coursesTracked: number = (reports?.avgProgressByCourse?.length as number) || 0;

  return (
    <AdminShell>
      <div className="p-8">
        <h1 className="text-3xl font-bold mb-6">Admin Reports</h1>

        <div className="grid gap-4 md:grid-cols-3 mb-6">
          <div className="rounded-lg border p-4">
            <p className="text-sm text-gray-500">Total exam registrations</p>
            <p className="mt-2 text-2xl font-bold">{totalExams}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-sm text-gray-500">Total attendance records</p>
            <p className="mt-2 text-2xl font-bold">{attendanceSummary.total}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-sm text-gray-500">Courses tracked</p>
            <p className="mt-2 text-2xl font-bold">{coursesTracked}</p>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <section className="rounded-lg border p-4">
            <h2 className="text-lg font-semibold mb-3">Exams by status</h2>
            <ul className="space-y-2">
              {Object.entries(examsByStatus).map(([status, count]: any) => (
                <li key={status} className="flex justify-between">
                  <span className="capitalize">{status}</span>
                  <span className="font-medium">{count}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-lg border p-4">
            <h2 className="text-lg font-semibold mb-3">Attendance summary</h2>
            <ul className="space-y-2">
              {Object.entries(attendanceSummary).map(([k,v]: any) => (
                <li key={k} className="flex justify-between">
                  <span className="capitalize">{k}</span>
                  <span className="font-medium">{v}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="mt-6 rounded-lg border p-4">
          <h2 className="text-lg font-semibold mb-3">Average progress by course</h2>
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-gray-500">
              <tr>
                <th className="py-2">Course</th>
                <th className="py-2">Avg %</th>
              </tr>
            </thead>
            <tbody>
              {reports.avgProgressByCourse.map((c: any) => (
                <tr key={c.courseId} className="border-t">
                  <td className="py-2">{c.title}</td>
                  <td className="py-2">{Math.round(c.avgPercent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 rounded-lg border p-4">
          <h2 className="text-lg font-semibold mb-3">Students by branch</h2>
          <div className="grid md:grid-cols-2 gap-2">
            {reports.studentsByBranch.map((b: any) => (
              <div key={b.branchId} className="p-3 bg-[var(--surface-alt)] rounded flex justify-between">
                <div>
                  <div className="font-medium">{b.name}</div>
                  <div className="text-xs text-[var(--muted)]">Branch ID: {b.branchId}</div>
                </div>
                <div className="text-sm font-semibold">{b.count}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
