"use client";

import { LecturerIcon, PencilIcon, TrendingDownIcon, TrendingUpIcon, WalletIcon } from "@/components/icons";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";

import AdminShell from "@/components/AdminShell";
import { firstReachable } from "@/lib/admin-routes";

type Overview = {
  adminRole: string;
  generatedAt: string;
  viewer: { adminRole: string; capabilities: string[] };
  school: {
    students: number;
    activeStudents: number;
    newStudentsThisMonth: number;
    privateStudents: number;
    branches: number;
    lecturers: number;
    materials: number;
    messages: number;
    comments: number;
    examRegistrations: number;
    byLevel: Record<string, number>;
  };
  branchPerformance: Array<{
    id: string | null;
    name: string;
    students: number;
    collected: number | null;
    expected: number | null;
    outstanding: number | null;
    collectionRate: number | null;
  }>;
  cohorts: { unpaid: number; registered_only: number; deposit_paid: number; full_paid: number };
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
    atRiskRule: string;
    atRiskIds: string[];
    // `paid` and `owed` are absent for an admin without the payments
    // capability — the route drops the fields rather than sending zeros, so
    // there is nothing to accidentally render.
    atRisk: Array<{
      id: string;
      name: string;
      email: string;
      level: string;
      branch: string;
      branchId: string | null;
      paid?: number;
      owed?: number;
      daysEnrolled: number;
    }>;
    pendingExamRegistrations: number;
    ungradedSubmissions: number;
    leadsAwaitingInvite: number;
    // A different question from `atRisk` above — engagement/dropout risk,
    // not payment. See lib/student-risk.ts.
    churnRiskCount: number;
    churnRiskRule: string;
    churnRiskIds: string[];
    churnRisk: Array<{
      id: string;
      name: string;
      email: string;
      level: string;
      branch: string;
      branchId: string | null;
      reason: string;
      score: number;
    }>;
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
  /**
   * `studentId` is absent — not null — for an admin without the `students`
   * capability, so the row simply does not become a link for them.
   */
  activity: Array<{
    kind: "signup" | "payment" | "submission";
    at: string;
    text: string;
    studentId?: string;
  }>;
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

/**
 * A figure that leads somewhere.
 *
 * `href` is optional and undefined is a real answer, not an oversight: an
 * admin whose role does not cover the destination gets the number as plain
 * text. A tile that looks clickable and lands on "Not your area" reads as a
 * broken portal rather than as a boundary, which is the failure this whole
 * page was rebuilt to avoid.
 */
function Kpi({
  label,
  value,
  sub,
  tone = "neutral",
  index,
  href,
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad";
  index: number;
  href?: string;
}) {
  const toneClass = {
    neutral: "text-[var(--foreground)]",
    good: "text-emerald-600",
    warn: "text-amber-600",
    bad: "text-red-600",
  }[tone];

  const body = (
    <>
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">{label}</p>
      <p className={`mt-2.5 text-3xl font-black tracking-tight ${toneClass}`}>{value}</p>
      {sub && <div className="mt-1.5 text-xs text-[var(--muted)]">{sub}</div>}
      {href && (
        <span className="mt-2 block text-[11px] font-bold text-[var(--accent)] opacity-0 transition group-hover:opacity-100">
          Open →
        </span>
      )}
    </>
  );

  const className =
    "group block rounded-3xl border border-[var(--border)] bg-[var(--surface-soft)] p-5 text-left shadow-sm transition";

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
      {href ? (
        <Link href={href} className={`${className} hover:-translate-y-0.5 hover:border-[var(--accent)]/40 hover:shadow-md`}>
          {body}
        </Link>
      ) : (
        <div className={className}>{body}</div>
      )}
    </motion.div>
  );
}

function SectionCard({
  title,
  hint,
  href,
  hrefLabel = "Open",
  children,
  className = "",
}: {
  title: string;
  hint?: string;
  href?: string;
  hrefLabel?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-3xl border border-[var(--border)] bg-[var(--surface-soft)] p-6 shadow-sm ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--foreground)]">{title}</h2>
        <div className="flex items-baseline gap-3">
          {hint && <p className="text-xs text-[var(--muted)]">{hint}</p>}
          {href && (
            <Link href={href} className="text-xs font-bold text-[var(--accent)] hover:underline">
              {hrefLabel} →
            </Link>
          )}
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </div>
  );
}

/** A row inside a card that behaves as a link when there is one, and as a row when there is not. */
function RowLink({ href, children, className = "" }: { href?: string; children: ReactNode; className?: string }) {
  if (!href) return <div className={className}>{children}</div>;
  return (
    <Link href={href} className={`${className} group block transition hover:bg-[var(--accent)]/5`}>
      {children}
    </Link>
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
    ? cohorts.unpaid + cohorts.registered_only + cohorts.deposit_paid + cohorts.full_paid
    : 0;
  const trendMax = finance ? Math.max(1, ...finance.revenueTrend.map((point) => point.amount)) : 1;
  /**
   * Whether this admin sees money anywhere on this page.
   *
   * Read off the DATA, not off a second capability lookup: `finance` is null
   * for exactly the people whose at-risk rows arrive without balances, so one
   * flag governs both and they cannot disagree.
   */
  const showsMoney = finance !== null;

  /**
   * Every destination on this page is resolved through the viewer's own
   * capability list, best-first. The roster is the natural home for a cohort of
   * students; the receivables ledger is the same cohort priced up, and it is
   * where an Accountant — who holds the money and not the student records —
   * lands instead. Nobody gets a link they cannot open.
   */
  const capabilities = data?.viewer?.capabilities ?? null;
  const to = useMemo(
    () =>
      (...candidates: Array<string | null | undefined>) =>
        firstReachable(capabilities, ...candidates),
    [capabilities],
  );

  /** The roster filtered to a named rule, or the same rule in the fee ledger. */
  const focusHref = useCallback(
    (focus: string) => to(`/admin/students?focus=${focus}`, `/admin/finance?tab=receivables&focus=${focus}`),
    [to],
  );

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
                ? `Live as of ${new Date(data.generatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · every figure below opens the list behind it`
                : "Loading the school's numbers…"}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold transition hover:bg-[var(--surface-alt)] disabled:opacity-50"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/dashboard")}
              className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold transition hover:bg-[var(--surface-alt)]"
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
              {/*
                THE REMEDY HAS TO NAME THE RIGHT PLACE. This used to say
                ".env.local", which is correct on a laptop and useless on the
                deployed site — that file is gitignored and never uploaded, so
                the one environment where this banner actually fires is the one
                where the instruction could not be followed. A school reading
                it would reasonably conclude the setting was already made.
              */}
              <p className="mt-1 text-sm text-amber-800">
                Registration confirmations, office alerts and fee reminders are being queued but never delivered. SMTP
                needs <em>all</em> of{" "}
                <code className="mx-0.5 rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs">EMAIL_PROVIDER</code>
                <code className="mx-0.5 rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs">SMTP_USER</code>
                <code className="mx-0.5 rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs">SMTP_PASS</code>
                <code className="mx-0.5 rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs">SMTP_FROM</code> — a
                username and password on their own build no transport at all. On the deployed site these live in the
                hosting provider&apos;s environment variables, not in{" "}
                <code className="font-mono text-xs">.env.local</code>, which is never uploaded.
              </p>
            </div>
            {to("/admin/emails") && (
              <Link
                href="/admin/emails"
                className="rounded-full bg-amber-600 px-4 py-2 text-sm font-bold text-white"
              >
                Email settings
              </Link>
            )}
          </div>
        )}

        {/* KPI row */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          <Kpi
            index={0}
            label="Students"
            value={String(data?.school.students ?? "—")}
            href={to("/admin/students", "/admin/finance?tab=receivables")}
            sub={
              data ? (
                <span className="flex flex-wrap gap-x-2">
                  <span>{data.school.activeStudents} active</span>
                  <span>·</span>
                  <span>+{data.school.newStudentsThisMonth} this month</span>
                </span>
              ) : undefined
            }
          />
          <Kpi
            index={1}
            label="Behind the paywall"
            value={String(data?.lockedOut ?? "—")}
            tone={data && data.lockedOut > 0 ? "warn" : "good"}
            href={focusHref("locked_out")}
            sub="Cannot reach classes yet"
          />
          {finance ? (
            <>
              <Kpi
                index={2}
                label="Collected"
                value={naira(finance.collectedRevenue)}
                tone="good"
                sub={`${finance.collectionRate}% of expected`}
                href={to("/admin/finance")}
              />
              <Kpi
                index={3}
                label="Outstanding"
                value={naira(finance.outstanding)}
                tone={finance.outstanding > 0 ? "bad" : "good"}
                sub="Tuition still owed"
                href={to("/admin/finance?tab=receivables")}
              />
              <Kpi
                index={4}
                label="This month"
                value={naira(finance.revenueThisMonth)}
                tone={finance.monthOnMonthPercent != null && finance.monthOnMonthPercent < 0 ? "bad" : "good"}
                href={to("/admin/finance?tab=cash")}
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
            href={to("/admin/attendance", "/admin/reports")}
            sub={data ? `${data.attendance.recordsLast30Days} records` : undefined}
          />
        </div>

        <div className="grid gap-5 xl:grid-cols-[1.3fr_0.7fr]">
          {/* Revenue trend */}
          {finance && (
            <SectionCard
              title="Revenue, last 6 months"
              hint="Completed payments only"
              href={to("/admin/finance?tab=cash")}
              hrefLabel="Cash detail"
            >
              <div className="flex h-48 items-end gap-3">
                {finance.revenueTrend.map((point, index) => {
                  const bar = (
                    <>
                      <span className="text-[10px] font-bold text-[var(--muted)]">
                        {point.amount > 0 ? naira(point.amount) : ""}
                      </span>
                      <motion.div
                        className="w-full rounded-t-xl bg-gradient-to-t from-[var(--accent)]/70 to-[var(--accent)] group-hover:brightness-110"
                        initial={{ height: 0 }}
                        animate={{ height: `${Math.max(2, (point.amount / trendMax) * 100)}%` }}
                        transition={{ duration: 0.7, delay: index * 0.06, ease: "easeOut" }}
                      />
                      <span className="text-xs font-semibold text-[var(--muted)]">{point.month}</span>
                    </>
                  );
                  const href = to(`/admin/finance?tab=cash&month=${encodeURIComponent(point.month)}`);
                  return href ? (
                    <Link
                      key={point.month}
                      href={href}
                      title={`${point.month}: ${naira(point.amount)} collected`}
                      className="group flex flex-1 flex-col items-center gap-2 self-stretch justify-end"
                    >
                      {bar}
                    </Link>
                  ) : (
                    <div key={point.month} className="flex flex-1 flex-col items-center justify-end gap-2 self-stretch">
                      {bar}
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          )}

          {/* Payment funnel */}
          <SectionCard
            title="Payment funnel"
            hint={`${cohortTotal} students`}
            href={to("/admin/finance?tab=receivables", "/admin/students")}
          >
            <div className="space-y-3">
              {cohorts &&
                (
                  [
                    { label: "Paid nothing", value: cohorts.unpaid, color: "bg-red-500", focus: "unpaid" },
                    { label: "Registration only", value: cohorts.registered_only, color: "bg-amber-500", focus: "registered_only" },
                    { label: "Deposit paid", value: cohorts.deposit_paid, color: "bg-sky-500", focus: "deposit_paid" },
                    { label: "Paid in full", value: cohorts.full_paid, color: "bg-emerald-500", focus: "full_paid" },
                  ] as const
                ).map((row, index) => (
                  <RowLink key={row.label} href={focusHref(row.focus)} className="-mx-2 rounded-xl px-2 py-1">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span className="text-[var(--foreground)] group-hover:text-[var(--accent)]">{row.label}</span>
                      <span className="text-[var(--muted)]">{row.value}</span>
                    </div>
                    <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-[var(--surface-alt)]">
                      <motion.div
                        className={`h-full rounded-full ${row.color}`}
                        initial={{ width: 0 }}
                        animate={{ width: `${cohortTotal > 0 ? (row.value / cohortTotal) * 100 : 0}%` }}
                        transition={{ duration: 0.7, delay: index * 0.08 }}
                      />
                    </div>
                  </RowLink>
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
                hint: data?.actionQueue.atRiskRule ?? "14+ days, deposit unpaid",
                // The exact set the count selected, not a re-derivation. If
                // somebody pays while this page is open the roster shows them
                // as settled rather than the two lists quietly disagreeing.
                href: focusHref("behind_tuition"),
              },
              {
                label: "Going quiet",
                value: data?.actionQueue.churnRiskCount ?? 0,
                hint: "Attendance or activity has dropped",
                // A different rule from "Behind on tuition" above — this one
                // catches a fully-paid student who has stopped showing up,
                // not somebody who owes money. See lib/student-risk.ts. No
                // finance-page fallback (unlike focusHref) — the fee ledger
                // has no equivalent view for this rule.
                href: to("/admin/students?focus=churn_risk"),
              },
              {
                label: "Exam registrations pending",
                value: data?.actionQueue.pendingExamRegistrations ?? 0,
                hint: "Awaiting confirmation",
                href: to("/admin/exams"),
              },
              {
                label: "Submissions ungraded",
                value: data?.actionQueue.ungradedSubmissions ?? 0,
                hint: "Handed in, no mark recorded",
                // Was /admin/students — a list of people, when the thing being
                // counted is a list of unmarked papers.
                href: to("/admin/marking"),
              },
              {
                label: "Enquiries to invite",
                value: data?.actionQueue.leadsAwaitingInvite ?? 0,
                hint: "New leads, not yet invited",
                href: to("/admin/leads?status=new"),
              },
            ].map((item) =>
              item.href ? (
                <Link
                  key={item.label}
                  href={item.href}
                  className="group rounded-3xl border border-[var(--border)] bg-[var(--accent)]/5 p-5 text-left transition hover:-translate-y-0.5 hover:bg-[var(--accent)]/10"
                >
                  <p className="text-3xl font-black text-[var(--foreground)]">{item.value}</p>
                  <p className="mt-1.5 text-sm font-bold text-[var(--foreground)]">{item.label}</p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">{item.hint}</p>
                </Link>
              ) : (
                <div
                  key={item.label}
                  className="rounded-3xl border border-[var(--border)] bg-[var(--accent)]/5 p-5 text-left opacity-70"
                >
                  <p className="text-3xl font-black text-[var(--foreground)]">{item.value}</p>
                  <p className="mt-1.5 text-sm font-bold text-[var(--foreground)]">{item.label}</p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">{item.hint}</p>
                </div>
              ),
            )}
          </div>

          {data && data.actionQueue.atRisk.length > 0 && (
            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                    <th className="pb-2 font-bold">Student</th>
                    <th className="pb-2 font-bold">Branch</th>
                    <th className="pb-2 font-bold">Level</th>
                    {/* The route strips `paid`/`owed` for anyone without the
                        payments capability, so the columns follow the data
                        rather than being hidden separately — two places
                        deciding this is how they drift apart again. */}
                    {showsMoney && <th className="pb-2 text-right font-bold">Paid</th>}
                    {showsMoney && <th className="pb-2 text-right font-bold">Owed</th>}
                    <th className="pb-2 text-right font-bold">Enrolled</th>
                  </tr>
                </thead>
                <tbody>
                  {data.actionQueue.atRisk.map((student) => {
                    const studentHref = to(
                      student.id ? `/admin/students/${student.id}` : null,
                      student.id ? `/admin/finance?tab=receivables&search=${encodeURIComponent(student.email)}` : null,
                    );
                    const branchHref = student.branchId
                      ? to(
                          `/admin/students?branchId=${student.branchId}&focus=behind_tuition`,
                          `/admin/finance?tab=receivables&branchId=${student.branchId}`,
                        )
                      : undefined;
                    const levelHref = to(
                      `/admin/students?level=${encodeURIComponent(student.level)}&focus=behind_tuition`,
                      `/admin/finance?tab=receivables&level=${encodeURIComponent(student.level)}`,
                    );
                    return (
                      <tr key={student.id || student.email || student.name} className="border-b border-[var(--border)]/60">
                        <td className="py-2.5">
                          {studentHref ? (
                            <Link
                              href={studentHref}
                              className="font-semibold text-[var(--foreground)] underline-offset-4 hover:text-[var(--accent)] hover:underline"
                            >
                              {student.name}
                            </Link>
                          ) : (
                            <p className="font-semibold text-[var(--foreground)]">{student.name}</p>
                          )}
                          <p className="text-xs text-[var(--muted)]">{student.email}</p>
                        </td>
                        <td className="py-2.5 text-[var(--muted)]">
                          {branchHref ? (
                            <Link href={branchHref} className="hover:text-[var(--accent)] hover:underline">
                              {student.branch}
                            </Link>
                          ) : (
                            student.branch
                          )}
                        </td>
                        <td className="py-2.5 text-[var(--muted)]">
                          {levelHref ? (
                            <Link href={levelHref} className="hover:text-[var(--accent)] hover:underline">
                              {student.level}
                            </Link>
                          ) : (
                            student.level
                          )}
                        </td>
                        {showsMoney && (
                          <td className="py-2.5 text-right text-[var(--muted)]">
                            ₦{(student.paid ?? 0).toLocaleString("en-NG")}
                          </td>
                        )}
                        {showsMoney && (
                          <td className="py-2.5 text-right font-bold text-red-600">
                            ₦{(student.owed ?? 0).toLocaleString("en-NG")}
                          </td>
                        )}
                        <td className="py-2.5 text-right text-[var(--muted)]">{student.daysEnrolled}d</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {data.actionQueue.atRiskCount > data.actionQueue.atRisk.length && focusHref("behind_tuition") && (
                <Link
                  href={focusHref("behind_tuition")!}
                  className="mt-4 inline-block text-xs font-bold text-[var(--accent)] hover:underline"
                >
                  See all {data.actionQueue.atRiskCount} →
                </Link>
              )}
            </div>
          )}
        </SectionCard>

        <div className="grid gap-5 xl:grid-cols-2">
          {/* Branch performance */}
          <SectionCard title="Branch performance" href={to("/admin/branches", "/admin/finance?tab=branches")}>
            <div className="space-y-4">
              {(data?.branchPerformance ?? []).map((branch) => {
                const href = branch.id
                  ? to(`/admin/finance?tab=receivables&branchId=${branch.id}`, `/admin/students?branchId=${branch.id}`)
                  : to("/admin/students?focus=owing", "/admin/finance?tab=receivables");
                return (
                  <RowLink key={branch.name} href={href} className="-mx-2 rounded-xl px-2 py-1">
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-bold text-[var(--foreground)] group-hover:text-[var(--accent)]">
                        {branch.name}
                      </span>
                      <span className="text-xs text-[var(--muted)]">
                        {branch.students} students
                        {branch.collected != null && ` · ${naira(branch.collected)} collected`}
                        {branch.outstanding != null && branch.outstanding > 0 && ` · ${naira(branch.outstanding)} owed`}
                      </span>
                    </div>
                    {branch.collectionRate != null && (
                      <div className="mt-1.5 flex items-center gap-3">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--surface-alt)]">
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
                  </RowLink>
                );
              })}
              {data?.branchPerformance.length === 0 && (
                <p className="text-sm text-[var(--muted)]">No students enrolled yet.</p>
              )}
            </div>
          </SectionCard>

          {/* Level spread */}
          <SectionCard title="Students by level" href={to("/admin/students", "/admin/reports")}>
            <div className="flex h-40 items-end gap-3">
              {Object.entries(data?.school.byLevel ?? {})
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([level, count], index) => {
                  const max = Math.max(1, ...Object.values(data?.school.byLevel ?? { x: 1 }));
                  const href = to(
                    `/admin/students?level=${encodeURIComponent(level)}`,
                    `/admin/finance?tab=receivables&level=${encodeURIComponent(level)}`,
                  );
                  const bar = (
                    <>
                      <span className="text-xs font-bold text-[var(--foreground)]">{count}</span>
                      <motion.div
                        className="w-full rounded-t-xl bg-gradient-to-t from-[var(--accent-strong)]/60 to-[var(--accent-strong)] group-hover:brightness-110"
                        initial={{ height: 0 }}
                        animate={{ height: `${(count / max) * 100}%` }}
                        transition={{ duration: 0.6, delay: index * 0.05 }}
                      />
                      <span className="text-xs font-semibold text-[var(--muted)]">{level}</span>
                    </>
                  );
                  return href ? (
                    <Link
                      key={level}
                      href={href}
                      title={`${count} students at ${level}`}
                      className="group flex flex-1 flex-col items-center justify-end gap-2 self-stretch"
                    >
                      {bar}
                    </Link>
                  ) : (
                    <div key={level} className="flex flex-1 flex-col items-center justify-end gap-2 self-stretch">
                      {bar}
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
          <SectionCard title="Live activity" hint="Newest first · click to open the file">
            <div className="space-y-3">
              {(data?.activity ?? []).map((event, index) => {
                const row = (
                  <>
                    <span className="mt-0.5 text-[var(--accent)]">
                      {event.kind === "payment" ? <WalletIcon /> : event.kind === "signup" ? <LecturerIcon /> : <PencilIcon />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-[var(--foreground)]">{event.text}</p>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">{timeAgo(event.at)}</p>
                    </div>
                    {event.studentId && (
                      <span className="mt-0.5 shrink-0 text-xs font-semibold text-[var(--muted)] opacity-0 transition group-hover:opacity-100">
                        Open →
                      </span>
                    )}
                  </>
                );

                const href = event.studentId
                  ? to(`/admin/students/${event.studentId}`)
                  : event.kind === "payment"
                  ? to("/admin/payments")
                  : event.kind === "submission"
                  ? to("/admin/marking")
                  : undefined;

                return (
                  <motion.div
                    key={`${event.at}-${index}`}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.04 }}
                    className="border-b border-[var(--border)]/50 pb-3 last:border-0"
                  >
                    {href ? (
                      <Link
                        href={href}
                        className="group -mx-2 flex items-start gap-3 rounded-xl px-2 py-1 transition hover:bg-[var(--accent)]/5"
                      >
                        {row}
                      </Link>
                    ) : (
                      <div className="flex items-start gap-3">{row}</div>
                    )}
                  </motion.div>
                );
              })}
              {data?.activity.length === 0 && <p className="text-sm text-[var(--muted)]">Nothing has happened yet.</p>}
            </div>
          </SectionCard>

          {/* System health */}
          <SectionCard title="System health">
            <div className="space-y-4">
              <RowLink
                href={to("/admin/emails")}
                className="flex items-center justify-between rounded-2xl border border-[var(--border)] p-4"
              >
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
              </RowLink>

              {(data?.health.integrations ?? []).map((connector) => (
                <RowLink
                  key={connector.id}
                  href={to("/admin/integrations")}
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
                        ? "bg-[var(--surface-alt)] text-[var(--muted)]"
                        : connector.status === "error" || connector.status === "degraded"
                        ? "bg-red-100 text-red-700"
                        : connector.status === "connected"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-[var(--surface-alt)] text-[var(--muted)]"
                    }`}
                  >
                    {connector.enabled ? connector.status : "off"}
                  </span>
                </RowLink>
              ))}

              {data && (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  {[
                    { label: "Lecturers", value: data.school.lecturers, href: to("/admin/lecturer-invite", "/admin/staff") },
                    { label: "Branches", value: data.school.branches, href: to("/admin/branches") },
                    { label: "Materials", value: data.school.materials, href: to("/admin/materials", "/admin/courses") },
                    { label: "Private students", value: data.school.privateStudents, href: focusHref("private") },
                    { label: "Community messages", value: data.school.messages, href: to("/admin/community") },
                    { label: "Enquiries", value: data.leads.total, href: to("/admin/leads") },
                  ].map((item) =>
                    item.href ? (
                      <Link
                        key={item.label}
                        href={item.href}
                        className="rounded-2xl bg-[var(--accent)]/5 p-3 transition hover:bg-[var(--accent)]/10"
                      >
                        <p className="text-lg font-black text-[var(--foreground)]">{item.value}</p>
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
                          {item.label}
                        </p>
                      </Link>
                    ) : (
                      <div key={item.label} className="rounded-2xl bg-[var(--accent)]/5 p-3 opacity-70">
                        <p className="text-lg font-black text-[var(--foreground)]">{item.value}</p>
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
                          {item.label}
                        </p>
                      </div>
                    ),
                  )}
                </div>
              )}
            </div>
          </SectionCard>
        </div>

        {/* Quick actions. Filtered to what this admin can open rather than
            greyed out — an empty-handed shortcut grid is noise, and the sidebar
            is already hiding the same areas. */}
        <SectionCard title="Jump to">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Students", hint: "Enrol, edit, promote", href: "/admin/students" },
              { label: "Enquiries", hint: "Leads and invites", href: "/admin/leads" },
              { label: "Payments", hint: "Transactions and invoices", href: "/admin/payments" },
              { label: "Finance", hint: "Receivables and cash", href: "/admin/finance" },
              { label: "Marking queue", hint: "Work waiting on a tutor", href: "/admin/marking" },
              { label: "Attendance", hint: "Registers by class", href: "/admin/attendance" },
              { label: "Exams", hint: "Sittings and results", href: "/admin/exams" },
              { label: "Promotions", hint: "End-of-session moves", href: "/admin/promotions" },
              { label: "Reports", hint: "Enrolment and progress", href: "/admin/reports" },
              { label: "Admin roles", hint: "Who can see what", href: "/admin/staff" },
            ]
              .filter((item) => Boolean(to(item.href)))
              .map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-3xl border border-[var(--border)] bg-[var(--surface-soft)] p-5 text-left transition hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/5"
                >
                  <p className="text-base font-bold text-[var(--foreground)]">{item.label}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">{item.hint}</p>
                </Link>
              ))}
          </div>
        </SectionCard>
      </div>
    </AdminShell>
  );
}
