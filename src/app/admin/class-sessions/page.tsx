"use client";

import AdminShell from "@/components/AdminShell";

export default function AdminClassSessionsPage() {
  return (
    <AdminShell>
      <div className="space-y-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Admin</p>
          <h1 className="text-3xl font-bold">Class sessions</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">Manage class session overrides, timetables and postponements. This page is a placeholder; the schedule editor lives under the sessions APIs and tutor private-classes tooling.</p>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
          <p className="text-sm text-[var(--muted)]">No interactive editor here yet. Use the tutor private-classes page or the schedule APIs for detailed session edits.</p>
        </div>
      </div>
    </AdminShell>
  );
}
