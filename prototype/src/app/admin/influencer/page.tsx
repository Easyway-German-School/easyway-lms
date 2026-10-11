"use client";

import { useEffect, useMemo, useState } from "react";

import AdminShell from "@/components/AdminShell";
import { RefreshIcon } from "@/components/icons";

type Redemption = {
  id: string;
  status: string;
  discountAmount: number;
  createdAt: string;
  redeemedByStudent: { user: { name: string | null } };
};

type Payout = {
  id: string;
  amount: number;
  status: string;
  createdAt: string;
  creditedAt: string | null;
  creditedNote: string | null;
};

type InfluencerCode = {
  id: string;
  code: string;
  label: string | null;
  status: string;
  discountPercent: number | null;
  discountFlat: number | null;
  commissionPercent: number | null;
  commissionFlat: number | null;
  createdAt: string;
  redemptions: Redemption[];
  payouts: Payout[];
};

const naira = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;
const date = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
const firstName = (name: string | null) => (name ? name.trim().split(/\s+/)[0] : "Student");

function discountLabel(code: InfluencerCode): string {
  const parts: string[] = [];
  if (code.discountPercent) parts.push(`${code.discountPercent}%`);
  if (code.discountFlat) parts.push(naira(code.discountFlat));
  return parts.length ? `${parts.join(" + ")} off for new students` : "No discount configured yet";
}

function commissionLabel(code: InfluencerCode): string {
  const parts: string[] = [];
  if (code.commissionPercent) parts.push(`${code.commissionPercent}%`);
  if (code.commissionFlat) parts.push(naira(code.commissionFlat));
  return parts.length ? `You earn ${parts.join(" + ")} per sign-up` : "No commission configured yet";
}

export default function InfluencerDashboardPage() {
  const [codes, setCodes] = useState<InfluencerCode[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/influencer", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Unable to load your influencer dashboard.");
        return body as { codes: InfluencerCode[] };
      })
      .then((result) => {
        if (!active) return;
        setCodes(result.codes);
        setError("");
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load your influencer dashboard.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshKey]);

  const totals = useMemo(() => {
    const all = codes ?? [];
    const payouts = all.flatMap((code) => code.payouts);
    const redemptions = all.flatMap((code) => code.redemptions);
    return {
      signups: redemptions.length,
      pending: payouts.filter((p) => p.status === "pending").reduce((sum, p) => sum + p.amount, 0),
      approved: payouts.filter((p) => p.status === "approved").reduce((sum, p) => sum + p.amount, 0),
      credited: payouts.filter((p) => p.status === "credited").reduce((sum, p) => sum + p.amount, 0),
    };
  }, [codes]);

  async function copyLink(code: string) {
    const link = `${window.location.origin}/auth/signup?promo=${encodeURIComponent(code)}`;
    try {
      await navigator.clipboard.writeText(link);
      setNotice(`Signup link copied for ${code}.`);
      setError("");
    } catch {
      setError("Could not copy the link. Check your browser's clipboard permission.");
      setNotice("");
    }
  }

  return (
    <AdminShell>
      <main className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)]">Your influencer dashboard</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Your code, the students who signed up with it, and what you've earned.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setError("");
              setRefreshKey((key) => key + 1);
            }}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold disabled:opacity-50"
          >
            <RefreshIcon className="h-4 w-4" />
            Refresh
          </button>
        </header>

        {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p> : null}
        {notice ? <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{notice}</p> : null}

        <section className="grid gap-3 sm:grid-cols-4">
          {[
            { label: "Sign-ups", value: totals.signups.toLocaleString() },
            { label: "Pending", value: naira(totals.pending) },
            { label: "Approved", value: naira(totals.approved) },
            { label: "Credited", value: naira(totals.credited) },
          ].map((metric) => (
            <div key={metric.label} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <p className="text-sm text-[var(--muted)]">{metric.label}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{loading ? "…" : metric.value}</p>
            </div>
          ))}
        </section>

        {loading ? (
          <p className="py-8 text-center text-sm text-[var(--muted)]">Loading your dashboard…</p>
        ) : !codes?.length ? (
          <p className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--muted)]">
            You don't have an influencer code yet. Ask the school office to set one up for you.
          </p>
        ) : (
          codes.map((code) => (
            <section key={code.id} className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-2xl font-black tracking-wide text-[var(--accent-ink)]">{code.code}</p>
                  {code.label ? <p className="text-sm text-[var(--muted)]">{code.label}</p> : null}
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-3 py-1.5 text-xs font-black uppercase tracking-wide ${
                      code.status === "active"
                        ? "bg-emerald-100 text-emerald-900"
                        : "bg-rose-100 text-rose-900"
                    }`}
                  >
                    {code.status}
                  </span>
                  <button
                    type="button"
                    onClick={() => void copyLink(code.code)}
                    className="rounded-xl bg-[var(--accent)] px-3 py-2 text-sm font-bold text-white"
                  >
                    Copy signup link
                  </button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] p-4">
                  <p className="text-sm font-bold">For your audience</p>
                  <p className="mt-1 text-sm text-[var(--muted)]">{discountLabel(code)}</p>
                </div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] p-4">
                  <p className="text-sm font-bold">For you</p>
                  <p className="mt-1 text-sm text-[var(--muted)]">{commissionLabel(code)}</p>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-bold">Recent sign-ups</h3>
                {!code.redemptions.length ? (
                  <p className="py-4 text-center text-sm text-[var(--muted)]">No sign-ups yet with this code.</p>
                ) : (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full min-w-[480px] text-left text-sm">
                      <thead className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted)]">
                        <tr>
                          <th className="px-3 py-2">Student</th>
                          <th className="px-3 py-2">Discount given</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Joined</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {code.redemptions.map((redemption) => (
                          <tr key={redemption.id}>
                            <td className="px-3 py-2">{firstName(redemption.redeemedByStudent.user.name)}</td>
                            <td className="px-3 py-2 tabular-nums">{naira(redemption.discountAmount)}</td>
                            <td className="px-3 py-2 capitalize">{redemption.status}</td>
                            <td className="px-3 py-2">{date(redemption.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-sm font-bold">Your payouts</h3>
                {!code.payouts.length ? (
                  <p className="py-4 text-center text-sm text-[var(--muted)]">Nothing accrued yet.</p>
                ) : (
                  <ul className="mt-2 divide-y divide-[var(--border)]">
                    {code.payouts.map((payout) => (
                      <li key={payout.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                        <span className="font-semibold tabular-nums">{naira(payout.amount)}</span>
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${
                            payout.status === "credited"
                              ? "bg-emerald-100 text-emerald-900"
                              : payout.status === "approved"
                              ? "bg-amber-100 text-amber-900"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {payout.status}
                        </span>
                        <span className="text-xs text-[var(--muted)]">{date(payout.createdAt)}</span>
                        {payout.creditedNote ? <span className="w-full text-xs text-[var(--muted)]">{payout.creditedNote}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          ))
        )}
      </main>
    </AdminShell>
  );
}
