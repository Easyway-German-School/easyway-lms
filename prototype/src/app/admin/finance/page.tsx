"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";

export default function AdminFinancePage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [monthly, setMonthly] = useState<Array<{label: string; revenue: number}>>([]);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/finance");
    if (res.ok) setData(await res.json());
    const mres = await fetch("/api/admin/finance/monthly");
    if (mres.ok) {
      const md = await mres.json();
      setMonthly(md.monthly || []);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function renderChart() {
    if (!monthly || monthly.length === 0) return null;
    const max = Math.max(...monthly.map((m) => m.revenue), 1);
    const width = 600;
    const height = 200;
    const barWidth = Math.floor(width / monthly.length) - 6;

    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
        <div className="text-sm text-[var(--muted)]">Monthly revenue (last 12 months)</div>
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} className="mt-3">
          {monthly.map((m, i) => {
            const barHeight = (m.revenue / max) * (height - 40);
            const x = i * (barWidth + 6) + 20;
            const y = height - barHeight - 20;
            return (
              <g key={m.label}>
                <rect x={x} y={y} width={barWidth} height={barHeight} fill="var(--accent)" rx={4} />
                <text x={x + barWidth / 2} y={height - 6} fontSize={10} textAnchor="middle" fill="var(--muted)">{m.label.split(' ')[0]}</text>
              </g>
            );
          })}
        </svg>
      </div>
    );
  }

  return (
    <AdminShell>
      <div className="space-y-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Admin</p>
          <h1 className="text-3xl font-bold">Finance overview</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">Quick summary of payments and invoices.</p>
        </div>

        {loading ? (
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6">Loading…</div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
                <div className="text-sm text-[var(--muted)]">Total revenue</div>
                <div className="mt-2 text-2xl font-bold">₦{data?.totalRevenue ?? 0}</div>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
                <div className="text-sm text-[var(--muted)]">Total payments</div>
                <div className="mt-2 text-2xl font-bold">{data?.totalPaymentsCount ?? 0}</div>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
                <div className="text-sm text-[var(--muted)]">Outstanding balance</div>
                <div className="mt-2 text-2xl font-bold">₦{data?.outstanding ?? 0}</div>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
                <div className="text-sm text-[var(--muted)]">Total invoices</div>
                <div className="mt-2 text-2xl font-bold">{data?.totalInvoices ?? 0}</div>
              </div>
            </div>
            <div className="mt-6">{renderChart()}</div>
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
                <div className="text-sm text-[var(--muted)]">Pending payments</div>
                <div className="mt-2 text-2xl font-bold">{data?.pendingCount ?? 0}</div>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
                <div className="text-sm text-[var(--muted)]">Failed payments</div>
                <div className="mt-2 text-2xl font-bold">{data?.failedCount ?? 0}</div>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
                <div className="text-sm text-[var(--muted)]">Invoiced amount</div>
                <div className="mt-2 text-2xl font-bold">₦{data?.totalInvoicedAmount ?? 0}</div>
              </div>
            </div>
          </>
        )}
      </div>
    </AdminShell>
  );
}
