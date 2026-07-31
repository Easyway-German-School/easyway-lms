"use client";

import { LecturerIcon, PencilIcon, TrendingDownIcon, TrendingUpIcon, WalletIcon } from "@/components/icons";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";

import AdminShell from "@/components/AdminShell";

type Overview = {
  adminRole: string;
  generatedAt: string;
  school: {
    students: number;
    activeStudents: number;
    newStudentsThisMonth: number;
    privateStudents: number;
    branches: number;
    lecturers: number;
    materials: number;
    threads: number;
    comments: number;
    examRegistrations: number;
    byLevel: Record<string, number>;
  };
  branchPerformance: Array<{
    name: string;
    students: number;
    collected: number | null;
    expected: number | null;
    collectionRate: number | null;
  }>;
  cohorts: { unpaid: number; registeredOnly: number; depositPaid: number; fullPaid: number };
  lockedOut: number;
  attendance: { rate: number | null; recordsLast30Days: number };
  leads: { total: number; new: number; invited: number; converted: number; dropped: number };
  finance: {
    expectedRevenue: number;
    collectedRevenue: number;
    outstanding: number;
    collectionRate: number;
    revenueThisMonth: number;
    revenueLastMonth: number;
    monthOnMonthPercent: number | null;
    revenueTrend: Array<{ month: string; amount: number }>;
  } | null;
  actionQueue: {
    atRiskCount: number;
    atRisk: Array<{ name: string; email: string; level: string; branch: string; paid: number; owed: number; daysEnrolled: number }>;
    pendingExamRegistrations: number;
    ungradedSubmissions: number;
    leadsAwaitingInvite: number;
  };
  health: {
    emailProvider: { name: string; configured: boolean };
    integrations: Array<{
      id: string;
      name: string;
      enabled: boolean;
      status: string;
      lastSyncAt: string | null;
      lastError: string | null;
      itemsSynced: number;
    }>;
  };
  activity: Array<{ kind: "signup" | "payment" | "submission"; at: string; text: string }>;
};

function naira(value: number) {
  if (value >= 1_000_000) return `₦${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `₦${(value / 1_000).toFixed(0)}k`;
  return `₦${value.toLocaleString("en-NG")}`;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function Kpi({
  label,
  value,
  sub,
  tone = "neutral",
  index,
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad";
  index: number;
}) {
  const toneClass = {
    neutral: "text-[var(--foreground)]",
    good: "text-emerald-600",
    warn: "text-amber-600",
    bad: "text-red-600",
  }[tone];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="rounded-3xl border border-[var(--border)] bg-white/80 p-5 shadow-sm"
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">{label}</p>
      <p className={`mt-2.5 text-3xl font-black tracking-tight ${toneClass}`}>{value}</p>
      {sub && <p className="mt-1.5 text-xs text-[var(--muted)]">{sub}</p>}
    </motion.div>
  );
}

function SectionCard({
  title,
  hint,
  children,
  className = "",
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-3xl border border-[var(--border)] bg-white/80 p-6 shadow-sm ${className}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--foreground)]">{title}</h2>
        {hint && <p className="text-xs text-[var(--muted)]">{hint}</p>}
      </div>
      <div className="mt-5">{children}</div>
    </div>
  );
}

export default function AdminHomePage() {
  const router = useRouter();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/overview", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load the admin overview");
      setData(await response.json());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load the admin overview");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const finance = data?.finance ?? null;
  const cohorts = data?.cohorts;
  const cohortTotal = cohorts
    ? cohorts.unpaid + cohorts.registeredOnly + cohorts.depositPaid + cohorts.fullPaid
    : 0;
  const trendMax = finance ? Math.max(1, ...finance.revenueTrend.map((point) => point.amount)) : 1;

  return (
    <AdminShell>
      <div className="flex flex-col gap-7">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
              Command centre
            </p>
            <h1 className="text-3xl font-black tracking-tight">Easyway LMS Admin</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {data
                ? `Live as of ${new Date(data.generatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
                : "Loading the school's numbers…"}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold transition hover:bg-white disabled:opacity-50"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/dashboard")}
              className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold transition hover:bg-white"
            >
              View student portal
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-3xl border border-red-300 bg-red-50 p-5 text-sm text-red-700">
            {error}
            <button type="button" onClick={() => void load()} className="ml-3 font-bold underline">
              Retry
            </button>
          </div>
        )}

        {/* Email is the one dependency that fails silently, so it gets a banner. */}
        {data && !data.health.emailProvider.configured && (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-amber-300 bg-amber-50 p-5">
            <div>
              <p className="text-sm font-bold text-amber-900">No email provider is configured</p>
              <p className="mt-1 text-sm text-amber-800">
                Registration alerts, fee reminders and enrolment invites are being queued but never delivered. Set
                <code className="mx-1 rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs">MAILERSEND_API_KEY</code>
                in both <code className="font-mono text-xs">.env</code> and{" "}
                <code className="font-mono text-xs">.env.local</code>.
              </p>
            </div>
            <button
              type="button"
              onClick={() => router.push("/admin/emails")}
              className="rounded-full bg-amber-600 px-4 py-2 text-sm font-bold text-white"
            >
              Email settings
            </button>
          </div>
        )}

        {/* KPI row */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          <Kpi
            index={0}
            label="Students"
            value={String(data?.school.students ?? "—")}
            sub={data ? `${data.school.activeStudents} active · +${data.school.newStudentsThisMonth} this month` : undefined}
          />
          <Kpi
            index={1}
            label="Behind the paywall"
            value={String(data?.lockedOut ?? "—")}
            tone={data && data.lockedOut > 0 ? "warn" : "good"}
            sub="Cannot reach classes yet"
          />
          {finance ? (
            <>
              <Kpi index={2} label="Collected" value={naira(finance.collectedRevenue)} tone="good" sub={`${finance.collectionRate}% of expected`} />
              <Kpi index={3} label="Outstanding" value={naira(finance.outstanding)} tone={finance.outstanding > 0 ? "bad" : "good"} sub="Tuition still owed" />
              <Kpi
                index={4}
                label="This month"
                value={naira(finance.revenueThisMonth)}
                tone={finance.monthOnMonthPercent != null && finance.monthOnMonthPercent < 0 ? "bad" : "good"}
                sub={
                  finance.monthOnMonthPercent != null
                    ? (
                        <span className="inline-flex items-center gap-1.5">
                          {finance.monthOnMonthPercent >= 0 ? <TrendingUpIcon className="h-3.5 w-3.5" /> : <TrendingDownIcon className="h-3.5 w-3.5" />}
                          {Math.abs(finance.monthOnMonthPercent)}% vs last month
                        </span>
                      )
                    : "No prior month to compare"
                }
              />
            </>
          ) : (
            <Kpi index={2} label="Finance" value="Restricted" sub="Your admin role excludes payments" />
          )}
          <Kpi
            index={5}
            label="Attendance (30d)"
            value={data?.attendance.rate != null ? `${data.attendance.rate}%` : "—"}
            tone={data?.attendance.rate != null && data.attendance.rate < 70 ? "warn" : "good"}
            sub={data ? `${data.attendance.recordsLast30Days} records` : undefined}
          />
        </div>

        <div className="grid gap-5 xl:grid-cols-[1.3fr_0.7fr]">
          {/* Revenue trend */}
          {finance && (
            <SectionCard title="Revenue, last 6 months" hint="Completed payments only">
              <div className="flex h-48 items-end gap-3">
                {finance.revenueTrend.map((point, index) => (
                  <div key={point.month} className="flex flex-1 flex-col items-center gap-2">
                    <span className="text-[10px] font-bold text-[var(--muted)]">
                      {point.amount > 0 ? naira(point.amount) : ""}
                    </span>
                    <motion.div
                      className="w-full rounded-t-xl bg-gradient-to-t from-[var(--accent)]/70 to-[var(--accent)]"
                      initial={{ height: 0 }}
                      animate={{ height: `${Math.max(2, (point.amount / trendMax) * 100)}%` }}
                      transition={{ duration: 0.7, delay: index * 0.06, ease: "easeOut" }}
                    />
                    <span className="text-xs font-semibold text-[var(--muted)]">{point.month}</span>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {/* Payment funnel */}
          <SectionCard title="Payment funnel" hint={`${cohortTotal} students`}>
            <div className="space-y-3">
              {cohorts &&
                (
                  [
                    { label: "Paid nothing", value: cohorts.unpaid, color: "bg-red-500" },
                    { label: "Registration only", value: cohorts.registeredOnly, color: "bg-amber-500" },
                    { label: "Deposit paid", value: cohorts.depositPaid, color: "bg-sky-500" },
                    { label: "Paid in full", value: cohorts.fullPaid, color: "bg-emerald-500" },
                  ] as const
                ).map((row, index) => (
                  <div key={row.label}>
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span className="text-[var(--foreground)]">{row.label}</span>
                      <span className="text-[var(--muted)]">{row.value}</span>
                    </div>
                    <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-slate-100">
                      <motion.div
                        className={`h-full rounded-full ${row.color}`}
                        initial={{ width: 0 }}
                        animate={{ width: `${cohortTotal > 0 ? (row.value / cohortTotal) * 100 : 0}%` }}
                        transition={{ duration: 0.7, delay: index * 0.08 }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          </SectionCard>
        </div>

        {/* Action queue */}
        <SectionCard
          title="Needs attention"
          hint={data ? `${data.actionQueue.atRiskCount} students behind on tuition` : undefined}
        >
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              {
                label: "Behind on tuition",
                value: data?.actionQueue.atRiskCount ?? 0,
                hint: "14+ days, deposit unpaid",
                href: "/admin/payments",
              },
              {
                label: "Exam registrations pending",
                value: data?.actionQueue.pendingExamRegistrations ?? 0,
                hint: "Awaiting confirmation",
                href: "/admin/exam-registrations",
              },
              {
                label: "Submissions ungraded",
                value: data?.actionQueue.ungradedSubmissions ?? 0,
                hint: "No score recorded",
                href: "/admin/students",
              },
              {
                label: "Enquiries to invite",
                value: data?.actionQueue.leadsAwaitingInvite ?? 0,
                hint: "New leads, not yet invited",
                href: "/admin/leads",
              },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => router.push(item.href)}
                className="rounded-3xl border border-[var(--border)] bg-[var(--accent)]/5 p-5 text-left transition hover:bg-[var(--accent)]/10"
              >
                <p className="text-3xl font-black text-[var(--foreground)]">{item.value}</p>
                <p className="mt-1.5 text-sm font-bold text-[var(--foreground)]">{item.label}</p>
                <p className="mt-0.5 text-xs text-[var(--muted)]">{item.hint}</p>
              </button>
            ))}
          </div>

          {data && data.actionQueue.atRisk.length > 0 && (
            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                    <th className="pb-2 font-bold">Student</th>
                    <th className="pb-2 font-bold">Branch</th>
                    <th className="pb-2 font-bold">Level</th>
                    <th className="pb-2 text-right font-bold">Paid</th>
                    <th className="pb-2 text-right font-bold">Owed</th>
                    <th className="pb-2 text-right font-bold">Enrolled</th>
                  </tr>
                </thead>
                <tbody>
                  {data.actionQueue.atRisk.map((student) => (
                    <tr key={student.email || student.name} className="border-b border-[var(--border)]/60">
                      <td className="py-2.5">
                        <p className="font-semibold text-[var(--foreground)]">{student.name}</p>
                        <p className="text-xs text-[var(--muted)]">{student.email}</p>
                      </td>
                      <td className="py-2.5 text-[var(--muted)]">{student.branch}</td>
                      <td className="py-2.5 text-[var(--muted)]">{student.level}</td>
                      <td className="py-2.5 text-right text-[var(--muted)]">₦{student.paid.toLocaleString("en-NG")}</td>
                      <td className="py-2.5 text-right font-bold text-red-600">₦{student.owed.toLocaleString("en-NG")}</td>
                      <td className="py-2.5 text-right text-[var(--muted)]">{student.daysEnrolled}d</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <div className="grid gap-5 xl:grid-cols-2">
          {/* Branch performance */}
          <SectionCard title="Branch performance">
            <div className="space-y-4">
              {(data?.branchPerformance ?? []).map((branch) => (
                <div key={branch.name}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-bold text-[var(--foreground)]">{branch.name}</span>
                    <span className="text-xs text-[var(--muted)]">
                      {branch.students} students
                      {branch.collected != null && ` · ${naira(branch.collected)} collected`}
                    </span>
                  </div>
                  {branch.collectionRate != null && (
                    <div className="mt-1.5 flex items-center gap-3">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <motion.div
                          className="h-full rounded-full bg-[var(--accent-strong)]"
                          initial={{ width: 0 }}
                          animate={{ width: `${branch.collectionRate}%` }}
                          transition={{ duration: 0.7 }}
                        />
                      </div>
                      <span className="w-10 text-right text-xs font-bold text-[var(--muted)]">
                        {branch.collectionRate}%
                      </span>
                    </div>
                  )}
                </div>
              ))}
              {data?.branchPerformance.length === 0 && (
                <p className="text-sm text-[var(--muted)]">No students enrolled yet.</p>
              )}
            </div>
          </SectionCard>

          {/* Level spread */}
          <SectionCard title="Students by level">
            <div className="flex h-40 items-end gap-3">
              {Object.entries(data?.school.byLevel ?? {})
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([level, count], index) => {
                  const max = Math.max(1, ...Object.values(data?.school.byLevel ?? { x: 1 }));
                  return (
                    <div key={level} className="flex flex-1 flex-col items-center gap-2">
                      <span className="text-xs font-bold text-[var(--foreground)]">{count}</span>
                      <motion.div
                        className="w-full rounded-t-xl bg-gradient-to-t from-[var(--accent-strong)]/60 to-[var(--accent-strong)]"
                        initial={{ height: 0 }}
                        animate={{ height: `${(count / max) * 100}%` }}
                        transition={{ duration: 0.6, delay: index * 0.05 }}
                      />
                      <span className="text-xs font-semibold text-[var(--muted)]">{level}</span>
                    </div>
                  );
                })}
              {Object.keys(data?.school.byLevel ?? {}).length === 0 && (
                <p className="text-sm text-[var(--muted)]">No level data yet.</p>
              )}
            </div>
          </SectionCard>
        </div>

        <div className="grid gap-5 xl:grid-cols-[0.55fr_0.45fr]">
          {/* Activity feed */}
          <SectionCard title="Live activity" hint="Newest first">
            <div className="space-y-3">
              {(data?.activity ?? []).map((event, index) => (
                <motion.div
                  key={`${event.at}-${index}`}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.04 }}
                  className="flex items-start gap-3 border-b border-[var(--border)]/50 pb-3 last:border-0"
                >
                  <span className="mt-0.5 text-[var(--accent)]">
                    {event.kind === "payment" ? <WalletIcon /> : event.kind === "signup" ? <LecturerIcon /> : <PencilIcon />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[var(--foreground)]">{event.text}</p>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">{timeAgo(event.at)}</p>
                  </div>
                </motion.div>
              ))}
              {data?.activity.length === 0 && <p className="text-sm text-[var(--muted)]">Nothing has happened yet.</p>}
            </div>
          </SectionCard>

          {/* System health */}
          <SectionCard title="System health">
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-2xl border border-[var(--border)] p-4">
                <div>
                  <p className="text-sm font-bold text-[var(--foreground)]">Email delivery</p>
                  <p className="text-xs text-[var(--muted)]">{data?.health.emailProvider.name ?? "—"}</p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    data?.health.emailProvider.configured
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-red-100 text-red-700"
                  }`}
                >
                  {data?.health.emailProvider.configured ? "Configured" : "Not configured"}
                </span>
              </div>

              {(data?.health.integrations ?? []).map((connector) => (
                <div
                  key={connector.id}
                  className="flex items-center justify-between rounded-2xl border border-[var(--border)] p-4"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[var(--foreground)]">{connector.name}</p>
                    <p className="truncate text-xs text-[var(--muted)]">
                      {connector.lastError
                        ? connector.lastError
                        : connector.lastSyncAt
                        ? `Synced ${timeAgo(connector.lastSyncAt)} · ${connector.itemsSynced} items`
                        : "Never synced"}
                    </p>
                  </div>
                  <span
                    className={`ml-3 shrink-0 rounded-full px-3 py-1 text-xs font-bold ${
                      !connector.enabled
                        ? "bg-slate-100 text-slate-600"
                        : connector.status === "error" || connector.status === "degraded"
                        ? "bg-red-100 text-red-700"
                        : connector.status === "connected"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {connector.enabled ? connector.status : "off"}
                  </span>
                </div>
              ))}

              {data && (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  {[
                    { label: "Lecturers", value: data.school.lecturers },
                    { label: "Branches", value: data.school.branches },
                    { label: "Materials", value: data.school.materials },
                    { label: "Private students", value: data.school.privateStudents },
                    { label: "Community threads", value: data.school.threads },
                    { label: "Enquiries", value: data.leads.total },
                  ].map((item) => (
                    <div key={item.label} className="rounded-2xl bg-[var(--accent)]/5 p-3">
                      <p className="text-lg font-black text-[var(--foreground)]">{item.value}</p>
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
                        {item.label}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </SectionCard>
        </div>

        {/* Quick actions */}
        <SectionCard title="Jump to">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Students", hint: "Enrol, edit, promote", href: "/admin/students" },
              { label: "Enquiries", hint: "Leads and invites", href: "/admin/leads" },
              { label: "Payments", hint: "Fees and invoices", href: "/admin/payments" },
              { label: "Finance", hint: "Revenue breakdown", href: "/admin/finance" },
              { label: "Attendance", hint: "Registers by class", href: "/admin/attendance" },
              { label: "Exam centre", hint: "Sittings and results", href: "/admin/exam-centre" },
              { label: "Promotions", hint: "End-of-session moves", href: "/admin/promotions" },
              { label: "Admin roles", hint: "Who can see what", href: "/admin/staff" },
            ].map((item) => (
              <button
                key={item.href}
                type="button"
                onClick={() => router.push(item.href)}
                className="rounded-3xl border border-[var(--border)] bg-white/70 p-5 text-left transition hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/5"
              >
                <p className="text-base font-bold text-[var(--foreground)]">{item.label}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">{item.hint}</p>
              </button>
            ))}
          </div>
        </SectionCard>
      </div>
    </AdminShell>
  );
}
