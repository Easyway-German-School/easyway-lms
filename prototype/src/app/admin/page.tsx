"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { useRouter } from "next/navigation";

export default function AdminHomePage() {
  const router = useRouter();
  const [stats, setStats] = useState<{ branches: number; students: number; enrollments: number; cachedPlans: number; exams: number; attendances: number; materials: number; discussions: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadStats = async () => {
      try {
        const res = await fetch("/api/admin/dashboard");
        if (!res.ok) throw new Error("Failed to load admin dashboard stats");
        const data = await res.json();
        setStats(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    loadStats();
  }, []);

  return (
    <AdminShell>
      <div className="flex flex-col gap-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Administrator</p>
            <h1 className="text-3xl font-bold">Easyway LMS Admin</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">Manage branches, students, exams, and reports from one place.</p>
          </div>
          <button type="button" onClick={() => router.push("/dashboard")} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold">View student portal</button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--background)] p-6">
            <p className="text-sm text-[var(--muted)]">Registered students</p>
            <p className="mt-3 text-3xl font-bold">{stats?.students ?? 0}</p>
          </div>
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--background)] p-6">
            <p className="text-sm text-[var(--muted)]">Exam registrations</p>
            <p className="mt-3 text-3xl font-bold">{stats?.exams ?? 0}</p>
          </div>
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--background)] p-6">
            <p className="text-sm text-[var(--muted)]">Course materials</p>
            <p className="mt-3 text-3xl font-bold">{stats?.materials ?? 0}</p>
          </div>
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--background)] p-6">
            <p className="text-sm text-[var(--muted)]">Forum discussions</p>
            <p className="mt-3 text-3xl font-bold">{stats?.discussions ?? 0}</p>
          </div>
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--background)] p-6">
            <p className="text-sm text-[var(--muted)]">Attendance records</p>
            <p className="mt-3 text-3xl font-bold">{stats?.attendances ?? 0}</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <button type="button" onClick={() => router.push("/admin/students")} className="rounded-3xl border border-[var(--border)] bg-[var(--accent)]/5 p-6 text-left transition hover:bg-[var(--accent)]/10">
            <p className="text-lg font-semibold">Student management</p>
            <p className="mt-2 text-sm text-[var(--muted)]">Add, edit, and filter students by branch.</p>
          </button>
          <button type="button" onClick={() => router.push("/admin/exams")} className="rounded-3xl border border-[var(--border)] bg-[var(--accent)]/5 p-6 text-left transition hover:bg-[var(--accent)]/10">
            <p className="text-lg font-semibold">Exam registrations</p>
            <p className="mt-2 text-sm text-[var(--muted)]">Register and manage student exams.</p>
          </button>
          <button type="button" onClick={() => router.push("/admin/payments")} className="rounded-3xl border border-[var(--border)] bg-[var(--accent)]/5 p-6 text-left transition hover:bg-[var(--accent)]/10">
            <p className="text-lg font-semibold">Payments</p>
            <p className="mt-2 text-sm text-[var(--muted)]">View and manage student payments.</p>
          </button>
          <button type="button" onClick={() => router.push("/admin/finance")} className="rounded-3xl border border-[var(--border)] bg-[var(--accent)]/5 p-6 text-left transition hover:bg-[var(--accent)]/10">
            <p className="text-lg font-semibold">Finance overview</p>
            <p className="mt-2 text-sm text-[var(--muted)]">View revenue, invoices, and outstanding balances.</p>
          </button>
          <button type="button" onClick={() => router.push("/admin/emails")} className="rounded-3xl border border-[var(--border)] bg-[var(--accent)]/5 p-6 text-left transition hover:bg-[var(--accent)]/10">
            <p className="text-lg font-semibold">Email & Notifications</p>
            <p className="mt-2 text-sm text-[var(--muted)]">Send emails and manage notification reminders.</p>
          </button>
          <button type="button" onClick={() => router.push("/admin/integrations")} className="rounded-3xl border border-[var(--border)] bg-[var(--accent)]/5 p-6 text-left transition hover:bg-[var(--accent)]/10">
            <p className="text-lg font-semibold">External integrations</p>
            <p className="mt-2 text-sm text-[var(--muted)]">Connect Moodle, Canvas, Discourse, or Open edX.</p>
          </button>
        </div>
      </div>
    </AdminShell>
  );
}
