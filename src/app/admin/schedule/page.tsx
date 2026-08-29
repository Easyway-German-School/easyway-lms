"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AdminShell from "@/components/AdminShell";

type GroupSession = { date: string; startTime: string; endTime: string; title: string; topic: string | null; status: string; cohort: string; branchName: string | null; deliveryMode: string | null; tutorName: string | null };
type PrivateClass = { id: string; studentId: string; scheduledAt: string; durationMinutes: number; topic: string | null; status: string; studentName: string; branchName: string; deliveryMode: string | null; tutorName: string };
type TutorStat = { tutorId: string; tutorName: string; assignedStudents: number; upcoming: number; next7Days: number; completedThisMonth: number; cancelledThisMonth: number; pending: number };
type PrivateAnalytics = {
  totalPrivateStudents: number;
  unassignedStudents: number;
  noUpcomingSession: number;
  pendingRequests: number;
  upcoming7Days: number;
  completedThisMonth: number;
  cancelledThisMonth: number;
  perTutor: TutorStat[];
};

const PRIVATE_STATUSES = ["requested", "scheduled", "completed", "cancelled", "postponed", "declined", "cancel_requested", "reschedule_requested"];

export default function AdminSchedulePage() {
  const router = useRouter();
  const [groups, setGroups] = useState<GroupSession[]>([]);
  const [privates, setPrivates] = useState<PrivateClass[]>([]);
  const [privateAnalytics, setPrivateAnalytics] = useState<PrivateAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [branchFilter, setBranchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [modeFilter, setModeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  function load() {
    setLoading(true);
    fetch("/api/admin/schedule", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Unable to load school schedule");
        setGroups(data.groupSessions ?? []);
        setPrivates(data.privateClasses ?? []);
        setPrivateAnalytics(data.privateAnalytics ?? null);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load school schedule"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const branches = useMemo(() => {
    const names = new Set<string>();
    groups.forEach((g) => { if (g.branchName) names.add(g.branchName); });
    privates.forEach((p) => { if (p.branchName) names.add(p.branchName); });
    return [...names].sort();
  }, [groups, privates]);

  function inRange(iso: string) {
    const time = new Date(iso).getTime();
    if (fromDate && time < new Date(fromDate).getTime()) return false;
    if (toDate && time > new Date(toDate).getTime() + 24 * 3600 * 1000) return false;
    return true;
  }

  const filteredGroups = useMemo(() => groups.filter((g) =>
    (!branchFilter || g.branchName === branchFilter) &&
    (!statusFilter || g.status === statusFilter) &&
    (!modeFilter || g.deliveryMode === modeFilter) &&
    (!search || g.cohort.toLowerCase().includes(search.toLowerCase())) &&
    inRange(g.date),
  ), [groups, branchFilter, statusFilter, modeFilter, search, fromDate, toDate]);

  const filteredPrivates = useMemo(() => privates.filter((p) =>
    (!branchFilter || p.branchName === branchFilter) &&
    (!statusFilter || p.status === statusFilter) &&
    (!modeFilter || p.deliveryMode === modeFilter) &&
    (!search || p.studentName.toLowerCase().includes(search.toLowerCase())) &&
    inRange(p.scheduledAt),
  ), [privates, branchFilter, statusFilter, modeFilter, search, fromDate, toDate]);

  async function setPrivateStatus(id: string, status: string) {
    setBusyId(id);
    try {
      const response = await fetch("/api/lecturer/private-classes", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (!response.ok) throw new Error((await response.json()).error ?? "Could not update this session");
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update this session");
    } finally {
      setBusyId(null);
    }
  }

  const activeFilterCount = [branchFilter, statusFilter, modeFilter, search, fromDate, toDate].filter(Boolean).length;

  return <AdminShell>
    <main className="p-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-[0.25em] text-[var(--accent)]">School calendar</p><h1 className="mt-2 text-3xl font-bold">All schedules</h1><p className="mt-1 text-sm text-[var(--muted)]">Every active cohort and private booking in one admin view.</p></div>
        <div className="flex gap-2"><Link href="/admin/schedule/holidays" className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold">Holidays</Link><Link href="/lecturer/timetable" className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold">Edit group timetable</Link></div>
      </div>

      <div className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <label>
          <span className="block text-xs font-medium text-[var(--foreground-soft)]">Search</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Student or cohort" className="mt-1 rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm" />
        </label>
        <label>
          <span className="block text-xs font-medium text-[var(--foreground-soft)]">Branch</span>
          <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="mt-1 rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm">
            <option value="">All branches</option>
            {branches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <label>
          <span className="block text-xs font-medium text-[var(--foreground-soft)]">Status</span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="mt-1 rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm">
            <option value="">Any status</option>
            {PRIVATE_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
          </select>
        </label>
        <label>
          <span className="block text-xs font-medium text-[var(--foreground-soft)]">Delivery</span>
          <select value={modeFilter} onChange={(e) => setModeFilter(e.target.value)} className="mt-1 rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm">
            <option value="">Any mode</option>
            <option value="physical">Physical</option>
            <option value="online">Online</option>
            <option value="hybrid">Hybrid</option>
          </select>
        </label>
        <label>
          <span className="block text-xs font-medium text-[var(--foreground-soft)]">From</span>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="mt-1 rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm" />
        </label>
        <label>
          <span className="block text-xs font-medium text-[var(--foreground-soft)]">To</span>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="mt-1 rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm" />
        </label>
        {activeFilterCount > 0 && (
          <button type="button" onClick={() => { setBranchFilter(""); setStatusFilter(""); setModeFilter(""); setSearch(""); setFromDate(""); setToDate(""); }} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--muted)] hover:text-[var(--foreground)]">
            Clear filters ({activeFilterCount})
          </button>
        )}
      </div>

      {error && <p className="mb-4 rounded-lg bg-rose-500/10 p-4 text-rose-600">{error}</p>}
      {loading ? <p className="py-12 text-center text-[var(--muted)]">Loading school schedule...</p> : <div className="grid gap-8 xl:grid-cols-2">
        <section>
          <h2 className="mb-3 text-lg font-semibold">Group and batch timetable ({filteredGroups.length})</h2>
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="w-full text-left text-sm">
              <thead className="bg-[var(--surface-alt)] text-xs uppercase text-[var(--muted)]"><tr><th className="p-3">Date</th><th className="p-3">Cohort</th><th className="p-3">Time</th><th className="p-3">Tutor</th></tr></thead>
              <tbody>{filteredGroups.map((item, index) => <tr key={`${item.date}-${item.cohort}-${index}`} className="border-t border-[var(--border)]"><td className="p-3">{new Date(item.date).toLocaleDateString()}</td><td className="p-3">{item.cohort}</td><td className="p-3">{item.startTime} - {item.endTime}</td><td className="p-3">{item.tutorName ?? "Unassigned"}</td></tr>)}</tbody>
            </table>
            {filteredGroups.length === 0 && <p className="p-6 text-sm text-[var(--muted)]">No group sessions match these filters.</p>}
          </div>
        </section>
        <section>
          <h2 className="mb-3 text-lg font-semibold">Private one-to-one bookings ({filteredPrivates.length})</h2>

          {privateAnalytics && (
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <StatTile label="Private students" value={privateAnalytics.totalPrivateStudents} />
              <StatTile label="No tutor assigned" value={privateAnalytics.unassignedStudents} warn={privateAnalytics.unassignedStudents > 0} />
              <StatTile label="Paired, nothing booked" value={privateAnalytics.noUpcomingSession} warn={privateAnalytics.noUpcomingSession > 0} />
              <StatTile label="Pending requests" value={privateAnalytics.pendingRequests} warn={privateAnalytics.pendingRequests > 0} />
              <StatTile label="Sessions next 7 days" value={privateAnalytics.upcoming7Days} />
              <StatTile label="Cancelled this month" value={privateAnalytics.cancelledThisMonth} warn={privateAnalytics.cancelledThisMonth > 0} />
            </div>
          )}

          {privateAnalytics && privateAnalytics.perTutor.length > 0 && (
            <div className="mb-4 overflow-x-auto rounded-xl border border-[var(--border)]">
              <table className="w-full text-left text-sm">
                <thead className="bg-[var(--surface-alt)] text-xs uppercase text-[var(--muted)]">
                  <tr>
                    <th className="p-3">Tutor</th>
                    <th className="p-3">Students</th>
                    <th className="p-3">Upcoming</th>
                    <th className="p-3">Next 7d</th>
                    <th className="p-3">Completed (mo)</th>
                    <th className="p-3">Cancelled (mo)</th>
                    <th className="p-3">Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {privateAnalytics.perTutor.map((t) => (
                    <tr key={t.tutorId} className="border-t border-[var(--border)]">
                      <td className="p-3 font-medium">{t.tutorName}</td>
                      <td className="p-3">{t.assignedStudents}</td>
                      <td className="p-3">{t.upcoming}</td>
                      <td className="p-3">{t.next7Days}</td>
                      <td className="p-3">{t.completedThisMonth}</td>
                      <td className="p-3">{t.cancelledThisMonth}</td>
                      <td className={`p-3 ${t.pending > 0 ? "font-semibold text-amber-600" : ""}`}>{t.pending}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="w-full text-left text-sm">
              <thead className="bg-[var(--surface-alt)] text-xs uppercase text-[var(--muted)]"><tr><th className="p-3">Date</th><th className="p-3">Student</th><th className="p-3">Tutor</th><th className="p-3">Mode</th><th className="p-3">Status</th></tr></thead>
              <tbody>{filteredPrivates.map((item) => (
                <tr key={item.id} className="border-t border-[var(--border)] hover:bg-[var(--surface-alt)]">
                  <td className="cursor-pointer p-3" onClick={() => router.push(`/admin/schedule/private/${encodeURIComponent(item.studentId)}`)}>{new Date(item.scheduledAt).toLocaleString()}</td>
                  <td className="cursor-pointer p-3" onClick={() => router.push(`/admin/schedule/private/${encodeURIComponent(item.studentId)}`)}>{item.studentName}<span className="block text-xs text-[var(--muted)]">{item.topic ?? "Private session"}</span></td>
                  <td className="cursor-pointer p-3 capitalize" onClick={() => router.push(`/admin/schedule/private/${encodeURIComponent(item.studentId)}`)}>{item.tutorName}</td>
                  <td className="cursor-pointer p-3 capitalize" onClick={() => router.push(`/admin/schedule/private/${encodeURIComponent(item.studentId)}`)}>{item.deliveryMode ?? "Not set"}</td>
                  <td className="p-3" onClick={(e) => e.stopPropagation()}>
                    <select
                      value={item.status}
                      onChange={(e) => void setPrivateStatus(item.id, e.target.value)}
                      disabled={busyId === item.id}
                      className="rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] px-2 py-1 text-xs text-[var(--foreground)]"
                    >
                      {!PRIVATE_STATUSES.includes(item.status) && <option value={item.status}>{item.status}</option>}
                      {PRIVATE_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                    </select>
                  </td>
                </tr>
              ))}</tbody>
            </table>
            {filteredPrivates.length === 0 && <p className="p-6 text-sm text-[var(--muted)]">No private bookings match these filters.</p>}
          </div>
        </section>
      </div>}
    </main>
  </AdminShell>;
}

function StatTile({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${warn ? "border-amber-500/30 bg-amber-500/10" : "border-[var(--border)] bg-[var(--surface)]"}`}>
      <p className={`text-2xl font-bold ${warn ? "text-amber-600" : ""}`}>{value}</p>
      <p className="text-xs text-[var(--muted)]">{label}</p>
    </div>
  );
}
