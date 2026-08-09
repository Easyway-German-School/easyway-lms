"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import AdminShell from "@/components/AdminShell";
import { DownloadIcon, TrendingDownIcon, TrendingUpIcon } from "@/components/icons";

/**
 * The finance workspace.
 *
 * What was here before was four aggregates and a bar chart: total revenue,
 * a count of payments, "outstanding", total invoices. It could tell an
 * accountant how much had come in and nothing whatsoever about what had not —
 * no names, no ages, no branch, no export. The outstanding figure was invoiced
 * minus collected, and most students who owe tuition have no invoice raised
 * against them at all, so on a school owed millions it read close to zero while
 * the admin dashboard, three clicks away, showed the real number.
 *
 * Four tabs, one question each: what the book says, who owes it and for how
 * long, what actually arrived, and where it came from.
 */

type Money = { amount: number; count: number };

type Bucket = { id: string; label: string; hint: string; students: number; amount: number; depositShortfall: number };

type Rollup = {
  key: string;
  name: string;
  students: number;
  expected: number;
  collected: number;
  outstanding: number;
  collectionRate: number;
};

type FinancePayload = {
  generatedAt: string;
  book: {
    students: number;
    expected: number;
    collected: number;
    outstanding: number;
    depositShortfall: number;
    collectionRate: number;
    cohorts: Record<string, number>;
    lockedOut: number;
    behindOnTuition: number;
  };
  cash: {
    thisMonth: number;
    lastMonth: number;
    monthOnMonthPercent: number | null;
    trend: Array<{ key: string; label: string; amount: number; count: number }>;
    byMethod: Array<{ method: string; amount: number; count: number }>;
    completed: Money;
    pending: Money;
    failed: Money;
    windowMonths: number;
  };
  aging: Bucket[];
  byBranch: Rollup[];
  byLevel: Rollup[];
  topDebtors: DebtorRow[];
  recentPayments: Array<{
    id: string;
    amount: number;
    method: string;
    description: string | null;
    at: string;
    studentId: string | null;
    studentName: string;
    branch: string;
  }>;
  invoices: { count: number; total: number; unsettled: number };
};

type DebtorRow = {
  id: string;
  name: string;
  email: string;
  level: string;
  branch: string;
  branchId: string | null;
  tuitionFee: number;
  requiredDeposit: number;
  paid: number;
  owed: number;
  owedOnDeposit: number;
  progressPercent: number;
  cohort: string;
  daysEnrolled: number;
  agingBucket: string;
  behindOnTuition: boolean;
  lastPaymentAt: string | null;
  paymentCount: number;
};

type ReceivablesPayload = {
  summary: FinancePayload["book"] & { aging: Bucket[] };
  buckets: Array<{ id: string; label: string; hint: string }>;
  filters: { focus: { id: string; label: string; hint: string } | null };
  totalCount: number;
  rows: DebtorRow[];
};

const TABS = [
  { id: "book", label: "The book" },
  { id: "receivables", label: "Receivables" },
  { id: "cash", label: "Cash" },
  { id: "branches", label: "Branches & levels" },
] as const;

function naira(value: number) {
  return `₦${Math.round(value).toLocaleString("en-NG")}`;
}

function nairaShort(value: number) {
  const rounded = Math.round(value);
  if (Math.abs(rounded) >= 1_000_000) return `₦${(rounded / 1_000_000).toFixed(1)}m`;
  if (Math.abs(rounded) >= 1_000) return `₦${(rounded / 1_000).toFixed(0)}k`;
  return `₦${rounded.toLocaleString("en-NG")}`;
}

/** Older money is redder. The colour is the ageing, not decoration. */
const BUCKET_TONE: Record<string, string> = {
  current: "border-slate-300 bg-slate-50 text-slate-700",
  d14_30: "border-amber-300 bg-amber-50 text-amber-800",
  d31_60: "border-orange-300 bg-orange-50 text-orange-800",
  d61_90: "border-red-300 bg-red-50 text-red-700",
  d90_plus: "border-red-500 bg-red-100 text-red-800",
};

function Tile({
  label,
  value,
  sub,
  tone = "neutral",
  href,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad";
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
      <p className={`mt-2 text-3xl font-black tracking-tight ${toneClass}`}>{value}</p>
      {sub && <div className="mt-1.5 text-xs text-[var(--muted)]">{sub}</div>}
    </>
  );

  const base = "block rounded-3xl border border-[var(--border)] bg-white/80 p-5 shadow-sm transition";
  return href ? (
    <Link href={href} className={`${base} hover:-translate-y-0.5 hover:border-[var(--accent)]/40`}>
      {body}
    </Link>
  ) : (
    <div className={base}>{body}</div>
  );
}

function FinanceWorkspace() {
  const params = useSearchParams();
  const [tab, setTab] = useState<string>(() => {
    const requested = params.get("tab");
    return TABS.some((entry) => entry.id === requested) ? (requested as string) : "book";
  });

  const [data, setData] = useState<FinancePayload | null>(null);
  const [receivables, setReceivables] = useState<ReceivablesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Receivables view controls, seeded from the URL so a dashboard tile can aim
  // at one bucket, one branch or one rule and land on exactly that.
  const [bucket, setBucket] = useState(params.get("agingBucket") ?? "");
  const [branchId, setBranchId] = useState(params.get("branchId") ?? "");
  const [level, setLevel] = useState(params.get("level") ?? "");
  const [focus, setFocus] = useState(params.get("focus") ?? "");
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [sort, setSort] = useState("owed");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const financeUrl = new URL("/api/admin/finance", window.location.origin);
      if (branchId) financeUrl.searchParams.set("branchId", branchId);

      const receivablesUrl = new URL("/api/admin/finance/receivables", window.location.origin);
      if (bucket) receivablesUrl.searchParams.set("agingBucket", bucket);
      if (branchId) receivablesUrl.searchParams.set("branchId", branchId);
      if (level) receivablesUrl.searchParams.set("level", level);
      if (focus) receivablesUrl.searchParams.set("focus", focus);
      if (search) receivablesUrl.searchParams.set("search", search);
      receivablesUrl.searchParams.set("sort", sort);

      const [financeRes, receivablesRes] = await Promise.all([
        fetch(financeUrl.toString(), { cache: "no-store" }),
        fetch(receivablesUrl.toString(), { cache: "no-store" }),
      ]);

      if (!financeRes.ok) throw new Error("Could not load the finance figures");
      if (!receivablesRes.ok) throw new Error("Could not load the receivables ledger");

      setData(await financeRes.json());
      setReceivables(await receivablesRes.json());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load finance");
    } finally {
      setLoading(false);
    }
  }, [bucket, branchId, level, focus, search, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportHref = useMemo(() => {
    const url = new URLSearchParams({ format: "csv", sort });
    if (bucket) url.set("agingBucket", bucket);
    if (branchId) url.set("branchId", branchId);
    if (level) url.set("level", level);
    if (focus) url.set("focus", focus);
    if (search) url.set("search", search);
    return `/api/admin/finance/receivables?${url.toString()}`;
  }, [bucket, branchId, level, focus, search, sort]);

  const trendMax = data ? Math.max(1, ...data.cash.trend.map((point) => point.amount)) : 1;

  function clearFilters() {
    setBucket("");
    setBranchId("");
    setLevel("");
    setFocus("");
    setSearch("");
  }

  const filtered = Boolean(bucket || branchId || level || focus || search);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Finance</p>
          <h1 className="text-3xl font-black tracking-tight">The fee book</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {data
              ? `Every enrolled student priced off the fee table, as of ${new Date(data.generatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.`
              : "Loading…"}
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
          {/*
            A plain link, not a fetch-and-blob. The route sets its own
            Content-Disposition, so the browser saves the file with the right
            name and the export carries exactly the filters on screen.
          */}
          <a
            href={exportHref}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white transition hover:brightness-110"
          >
            <DownloadIcon className="h-4 w-4" />
            Export CSV
          </a>
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

      <div className="flex flex-wrap gap-2">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            className={`rounded-full border px-5 py-2 text-sm font-semibold transition ${
              tab === entry.id
                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                : "border-[var(--border)] bg-white hover:bg-slate-50"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {/* ---------------------------------------------------------------- */}
      {tab === "book" && data && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Tile label="Expected" value={nairaShort(data.book.expected)} sub={`${data.book.students} students on the books`} />
            <Tile
              label="Collected"
              value={nairaShort(data.book.collected)}
              tone="good"
              sub={`${data.book.collectionRate}% of expected`}
            />
            <Tile
              label="Outstanding"
              value={nairaShort(data.book.outstanding)}
              tone={data.book.outstanding > 0 ? "bad" : "good"}
              sub="Priced off the fee table, not off raised invoices"
              href="/admin/finance?tab=receivables"
            />
            <Tile
              label="Short of deposit"
              value={nairaShort(data.book.depositShortfall)}
              tone={data.book.depositShortfall > 0 ? "warn" : "good"}
              sub={`${data.book.lockedOut} students cannot reach classes`}
              href="/admin/finance?tab=receivables&focus=locked_out"
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <div className="rounded-3xl border border-[var(--border)] bg-white/80 p-6 shadow-sm">
              <h2 className="text-sm font-bold uppercase tracking-[0.18em]">Ageing</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">
                By days since enrolment. Settled students are excluded.
              </p>
              <div className="mt-5 space-y-3">
                {data.aging.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => {
                      setBucket(entry.id);
                      setTab("receivables");
                    }}
                    className={`flex w-full items-center justify-between gap-4 rounded-2xl border px-4 py-3 text-left transition hover:brightness-95 ${
                      BUCKET_TONE[entry.id] ?? BUCKET_TONE.current
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold">{entry.label}</p>
                      <p className="text-xs opacity-80">
                        {entry.students} {entry.students === 1 ? "student" : "students"} · {entry.hint}
                      </p>
                    </div>
                    <span className="shrink-0 text-base font-black">{nairaShort(entry.amount)}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-[var(--border)] bg-white/80 p-6 shadow-sm">
              <h2 className="text-sm font-bold uppercase tracking-[0.18em]">Who to ring first</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">Largest balance, longest standing.</p>
              <div className="mt-5 space-y-2">
                {data.topDebtors.length === 0 && (
                  <p className="text-sm text-[var(--muted)]">Nothing outstanding. Every student is paid up.</p>
                )}
                {data.topDebtors.map((debtor) => (
                  <div
                    key={debtor.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{debtor.name}</p>
                      <p className="truncate text-xs text-[var(--muted)]">
                        {debtor.branch} · {debtor.level} · {debtor.daysEnrolled}d enrolled
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-black text-red-600">{naira(debtor.owed)}</p>
                      <p className="text-[10px] text-[var(--muted)]">{debtor.progressPercent}% paid</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-[var(--border)] bg-white/80 p-6 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-[0.18em]">Invoices raised</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Invoices are raised at checkout, so this counts transactions rather than the whole fee book — which is
              why outstanding above is priced off tuition instead.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Tile label="Invoices" value={String(data.invoices.count)} />
              <Tile label="Invoiced" value={nairaShort(data.invoices.total)} />
              <Tile label="Unsettled" value={String(data.invoices.unsettled)} tone={data.invoices.unsettled > 0 ? "warn" : "good"} />
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {tab === "receivables" && receivables && (
        <div className="space-y-5">
          {receivables.filters.focus && (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-red-300 bg-red-50 p-5 text-red-800">
              <div>
                <p className="text-sm font-black uppercase tracking-[0.14em]">{receivables.filters.focus.label}</p>
                <p className="mt-1 text-sm">{receivables.filters.focus.hint}.</p>
              </div>
              <button
                type="button"
                onClick={() => setFocus("")}
                className="rounded-full border border-current px-4 py-2 text-sm font-bold hover:bg-white/60"
              >
                Clear
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setBucket("")}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                bucket === "" ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-[var(--border)] bg-white"
              }`}
            >
              All ages
            </button>
            {receivables.buckets.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setBucket(entry.id)}
                title={entry.hint}
                className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                  bucket === entry.id ? BUCKET_TONE[entry.id] ?? BUCKET_TONE.current : "border-[var(--border)] bg-white"
                }`}
              >
                {entry.label}
              </button>
            ))}
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name, email or branch"
              className="ml-auto rounded-full border border-[var(--border)] bg-white px-4 py-2 text-sm"
            />
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value)}
              className="rounded-full border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold"
            >
              <option value="owed">Largest balance</option>
              <option value="oldest">Longest outstanding</option>
              <option value="name">Name</option>
              <option value="branch">Branch</option>
              <option value="paid">Most paid</option>
            </select>
            {filtered && (
              <button
                type="button"
                onClick={clearFilters}
                className="rounded-full border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold"
              >
                Clear filters
              </button>
            )}
          </div>

          <p className="text-sm text-[var(--muted)]">
            {receivables.totalCount} {receivables.totalCount === 1 ? "student" : "students"} in this view. The totals
            above stay on the whole book, so a filtered view never restates what the school is owed.
          </p>

          <div className="overflow-hidden rounded-3xl border border-[var(--border)] bg-white/80">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-[var(--border)] text-sm">
                <thead className="bg-[var(--surface)] text-left text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                  <tr>
                    <th className="px-5 py-3">Student</th>
                    <th className="px-5 py-3">Branch</th>
                    <th className="px-5 py-3">Level</th>
                    <th className="px-5 py-3 text-right">Fee</th>
                    <th className="px-5 py-3 text-right">Paid</th>
                    <th className="px-5 py-3 text-right">Outstanding</th>
                    <th className="px-5 py-3 text-right">Age</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-10 text-center text-[var(--muted)]">
                        Loading the ledger…
                      </td>
                    </tr>
                  ) : receivables.rows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-10 text-center text-[var(--muted)]">
                        Nothing matches this view.
                      </td>
                    </tr>
                  ) : (
                    receivables.rows.map((row) => (
                      <tr key={row.id} className={row.behindOnTuition ? "bg-red-50/70" : undefined}>
                        <td className="px-5 py-3">
                          <p className={`font-semibold ${row.behindOnTuition ? "text-red-700" : ""}`}>{row.name}</p>
                          <p className="text-xs text-[var(--muted)]">{row.email}</p>
                        </td>
                        <td className="px-5 py-3 text-[var(--muted)]">{row.branch}</td>
                        <td className="px-5 py-3 text-[var(--muted)]">{row.level}</td>
                        <td className="px-5 py-3 text-right text-[var(--muted)]">{naira(row.tuitionFee)}</td>
                        <td className="px-5 py-3 text-right">
                          {naira(row.paid)}
                          <span className="ml-1 text-[10px] text-[var(--muted)]">{row.progressPercent}%</span>
                        </td>
                        <td className={`px-5 py-3 text-right font-bold ${row.owed > 0 ? "text-red-600" : "text-emerald-600"}`}>
                          {naira(row.owed)}
                        </td>
                        <td className="px-5 py-3 text-right text-[var(--muted)]">{row.daysEnrolled}d</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {tab === "cash" && data && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Tile
              label="This month"
              value={nairaShort(data.cash.thisMonth)}
              tone={data.cash.monthOnMonthPercent != null && data.cash.monthOnMonthPercent < 0 ? "bad" : "good"}
              sub={
                data.cash.monthOnMonthPercent != null ? (
                  <span className="inline-flex items-center gap-1.5">
                    {data.cash.monthOnMonthPercent >= 0 ? (
                      <TrendingUpIcon className="h-3.5 w-3.5" />
                    ) : (
                      <TrendingDownIcon className="h-3.5 w-3.5" />
                    )}
                    {Math.abs(data.cash.monthOnMonthPercent)}% vs last month
                  </span>
                ) : (
                  "No prior month to compare"
                )
              }
            />
            <Tile label="Last month" value={nairaShort(data.cash.lastMonth)} />
            <Tile
              label="Pending"
              value={String(data.cash.pending.count)}
              tone={data.cash.pending.count > 0 ? "warn" : "good"}
              sub={`${nairaShort(data.cash.pending.amount)} not yet confirmed`}
              href="/admin/payments?status=pending"
            />
            <Tile
              label="Failed"
              value={String(data.cash.failed.count)}
              tone={data.cash.failed.count > 0 ? "bad" : "good"}
              sub={`${nairaShort(data.cash.failed.amount)} did not go through`}
              href="/admin/payments?status=failed"
            />
          </div>

          <div className="rounded-3xl border border-[var(--border)] bg-white/80 p-6 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-[0.18em]">
              Received, last {data.cash.windowMonths} months
            </h2>
            <div className="mt-6 flex h-56 items-end gap-2">
              {data.cash.trend.map((point, index) => (
                <div key={point.key} className="group flex flex-1 flex-col items-center justify-end gap-2 self-stretch">
                  <span className="text-[10px] font-bold text-[var(--muted)] opacity-0 transition group-hover:opacity-100">
                    {point.count} payments
                  </span>
                  <span className="text-[10px] font-bold text-[var(--muted)]">
                    {point.amount > 0 ? nairaShort(point.amount) : ""}
                  </span>
                  <motion.div
                    className="w-full rounded-t-xl bg-gradient-to-t from-[var(--accent)]/70 to-[var(--accent)]"
                    initial={{ height: 0 }}
                    animate={{ height: `${Math.max(2, (point.amount / trendMax) * 100)}%` }}
                    transition={{ duration: 0.6, delay: index * 0.04 }}
                  />
                  <span className="text-[10px] font-semibold text-[var(--muted)]">{point.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <div className="rounded-3xl border border-[var(--border)] bg-white/80 p-6 shadow-sm">
              <h2 className="text-sm font-bold uppercase tracking-[0.18em]">How it arrived</h2>
              <div className="mt-5 space-y-3">
                {data.cash.byMethod.length === 0 && (
                  <p className="text-sm text-[var(--muted)]">No completed payments in this window.</p>
                )}
                {data.cash.byMethod.map((entry) => {
                  const share = data.cash.completed.amount > 0 ? (entry.amount / data.cash.completed.amount) * 100 : 0;
                  return (
                    <Link
                      key={entry.method}
                      href={`/admin/payments?method=${encodeURIComponent(entry.method)}`}
                      className="block rounded-xl px-2 py-1 transition hover:bg-[var(--accent)]/5"
                    >
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span className="capitalize">{entry.method}</span>
                        <span className="text-[var(--muted)]">
                          {naira(entry.amount)} · {entry.count}
                        </span>
                      </div>
                      <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-[var(--accent-strong)]" style={{ width: `${share}%` }} />
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>

            <div className="rounded-3xl border border-[var(--border)] bg-white/80 p-6 shadow-sm">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-bold uppercase tracking-[0.18em]">Latest receipts</h2>
                <Link href="/admin/payments" className="text-xs font-bold text-[var(--accent)] hover:underline">
                  All payments →
                </Link>
              </div>
              <div className="mt-5 space-y-2">
                {data.recentPayments.length === 0 && (
                  <p className="text-sm text-[var(--muted)]">No payments recorded yet.</p>
                )}
                {data.recentPayments.map((payment) => (
                  <div
                    key={payment.id}
                    className="flex items-center justify-between gap-3 border-b border-[var(--border)]/60 pb-2 last:border-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{payment.studentName}</p>
                      <p className="truncate text-xs text-[var(--muted)]">
                        {payment.branch} · {payment.method} · {new Date(payment.at).toLocaleDateString("en-GB")}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-black text-emerald-600">{naira(payment.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {tab === "branches" && data && (
        <div className="grid gap-5 xl:grid-cols-2">
          {[
            { title: "By branch", rows: data.byBranch, filter: (key: string) => setBranchId(key === "unassigned" ? "" : key) },
            { title: "By level", rows: data.byLevel, filter: (key: string) => setLevel(key) },
          ].map((group) => (
            <div key={group.title} className="rounded-3xl border border-[var(--border)] bg-white/80 p-6 shadow-sm">
              <h2 className="text-sm font-bold uppercase tracking-[0.18em]">{group.title}</h2>
              <p className="mt-1 text-xs text-[var(--muted)]">Sorted by what is still owed.</p>
              <div className="mt-5 space-y-4">
                {group.rows.map((row) => (
                  <button
                    key={row.key}
                    type="button"
                    onClick={() => {
                      group.filter(row.key);
                      setTab("receivables");
                    }}
                    className="block w-full rounded-xl px-2 py-1 text-left transition hover:bg-[var(--accent)]/5"
                  >
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-bold">{row.name}</span>
                      <span className="text-xs text-[var(--muted)]">
                        {row.students} students · {nairaShort(row.collected)} in ·{" "}
                        <span className={row.outstanding > 0 ? "font-bold text-red-600" : ""}>
                          {nairaShort(row.outstanding)} owed
                        </span>
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-3">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-[var(--accent-strong)]"
                          style={{ width: `${row.collectionRate}%` }}
                        />
                      </div>
                      <span className="w-10 text-right text-xs font-bold text-[var(--muted)]">
                        {row.collectionRate}%
                      </span>
                    </div>
                  </button>
                ))}
                {group.rows.length === 0 && <p className="text-sm text-[var(--muted)]">Nothing to show yet.</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {loading && !data && (
        <div className="rounded-3xl border border-[var(--border)] bg-white/80 p-8 text-center text-sm text-[var(--muted)]">
          Loading the fee book…
        </div>
      )}
    </div>
  );
}

export default function AdminFinancePage() {
  return (
    <AdminShell>
      {/* useSearchParams needs a Suspense boundary above it. */}
      <Suspense fallback={<div className="p-6 text-sm text-[var(--muted)]">Loading…</div>}>
        <FinanceWorkspace />
      </Suspense>
    </AdminShell>
  );
}
