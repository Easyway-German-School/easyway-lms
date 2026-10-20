"use client";

import { useEffect, useMemo, useState } from "react";

import AdminShell from "@/components/AdminShell";
import { RefreshIcon } from "@/components/icons";

type Payout = {
  id: string;
  amount: number;
  kind: "referral_credit";
  status: "pending" | "approved";
  createdAt: string;
  promoCode: {
    code: string;
    type: string;
    ownerStudent: { user: { name: string | null; email: string } } | null;
  };
  promoRedemption: { redeemedByStudent: { user: { name: string | null; email: string } } };
};

type Redemption = {
  id: string;
  codeSnapshot: string;
  createdAt: string;
  redeemedByStudent: { studentCode: string | null; user: { name: string | null; email: string }; branch: { name: string } | null };
  promoCode: { ownerStudent: { user: { name: string | null } } | null };
  payouts: { amount: number; status: "pending" | "approved" | "credited" }[];
};

type ReferralData = {
  referrerCount: number;
  pendingPayouts: Payout[];
  recentRedemptions: Redemption[];
  totalRedemptions: number;
  openHolds: number;
  truncated: boolean;
};

const naira = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;
const date = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

/**
 * Who has ACTUALLY referred someone — not every student's own code, which
 * is the whole student body (most of whom have never referred anyone). See
 * the comment on /api/admin/referrals for why that list was removed
 * entirely instead of just made collapsible: nobody asked to scroll past
 * 500 students who've done nothing to find the handful who have.
 */
export default function AdminReferralsPage() {
  const [data, setData] = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [creditingId, setCreditingId] = useState<string | null>(null);
  const [creditNote, setCreditNote] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  function refresh(message?: string) {
    setLoading(true);
    setError("");
    if (message) setNotice(message);
    setRefreshKey((key) => key + 1);
  }

  useEffect(() => {
    let active = true;
    fetch("/api/admin/referrals", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Unable to load referral records.");
        return body as ReferralData;
      })
      .then((result) => {
        if (!active) return;
        setData(result);
        setError("");
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load referral records.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshKey]);

  const pendingPayoutTotal = useMemo(
    () => (data?.pendingPayouts ?? []).filter((p) => p.status === "pending").reduce((sum, p) => sum + p.amount, 0),
    [data?.pendingPayouts],
  );

  async function approvePayout(id: string) {
    setBusyId(id);
    setError("");
    try {
      const res = await fetch(`/api/admin/promo-payouts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Unable to approve this payout.");
      refresh("Payout approved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to approve this payout.");
    } finally {
      setBusyId(null);
    }
  }

  async function creditPayout(id: string) {
    setBusyId(id);
    setError("");
    try {
      const res = await fetch(`/api/admin/promo-payouts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "credit", note: creditNote.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Unable to credit this payout.");
      setCreditingId(null);
      setCreditNote("");
      refresh("Payout credited.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to credit this payout.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AdminShell>
      <main className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)]">Student referrals</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Who's actually referred someone, and what's owed them. Influencers and other partners live in their
              own{" "}
              <a href="/admin/influencer-program" className="font-semibold text-[var(--accent-ink)] hover:underline">
                Influencer Program
              </a>
              .
            </p>
          </div>
          <button
            type="button"
            onClick={() => refresh()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold disabled:opacity-50"
          >
            <RefreshIcon className="h-4 w-4" />
            Refresh
          </button>
        </header>

        {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p> : null}
        {notice ? <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{notice}</p> : null}

        <section className="grid gap-3 sm:grid-cols-3">
          {[
            { label: "Students who've referred someone", value: data?.referrerCount ?? 0 },
            { label: "Sign-ups attributed", value: data?.totalRedemptions ?? 0 },
            { label: "Owed (pending)", value: pendingPayoutTotal, money: true },
          ].map((metric) => (
            <div key={metric.label} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <p className="text-sm text-[var(--muted)]">{metric.label}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {loading ? "…" : metric.money ? naira(metric.value) : metric.value.toLocaleString()}
              </p>
            </div>
          ))}
        </section>

        {data?.pendingPayouts.length ? (
          <section className="space-y-3 rounded-2xl border border-amber-300 bg-[var(--surface)] p-4">
            <h2 className="text-lg font-bold">Payouts waiting on you</h2>
            <ul className="divide-y divide-[var(--border)]">
              {data.pendingPayouts.map((payout) => {
                const owner = payout.promoCode.ownerStudent?.user;
                return (
                  <li key={payout.id} className="space-y-2 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold">{naira(payout.amount)} — referral credit</p>
                        <p className="text-xs text-[var(--muted)]">
                          {owner?.name || owner?.email || "—"} referred{" "}
                          {payout.promoRedemption.redeemedByStudent.user.name || "a student"} · {date(payout.createdAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-slate-700">
                          {payout.status}
                        </span>
                        {payout.status === "pending" ? (
                          <button
                            type="button"
                            onClick={() => void approvePayout(payout.id)}
                            disabled={busyId === payout.id}
                            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-bold disabled:opacity-50"
                          >
                            Approve
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setCreditingId(creditingId === payout.id ? null : payout.id);
                              setCreditNote("");
                            }}
                            disabled={busyId === payout.id}
                            className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                          >
                            Credit
                          </button>
                        )}
                      </div>
                    </div>
                    {creditingId === payout.id ? (
                      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-[var(--surface-alt)] p-3">
                        <input
                          value={creditNote}
                          onChange={(e) => setCreditNote(e.target.value)}
                          placeholder="Optional — leave blank to auto-apply as a waiver on their open balance"
                          className="min-w-[14rem] flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => void creditPayout(payout.id)}
                          disabled={busyId === payout.id}
                          className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50"
                        >
                          Mark credited
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {data?.truncated ? (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            This view is capped for performance. Some payouts or referrals may be incomplete.
          </p>
        ) : null}

        <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div>
            <h2 className="text-lg font-bold">Referrals</h2>
            <p className="text-sm text-[var(--muted)]">
              Every new student who signed up with someone else's code — nothing else shows up here.
            </p>
          </div>
          {loading ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">Loading…</p>
          ) : !data?.recentRedemptions.length ? (
            <p className="py-10 text-center text-sm text-[var(--muted)]">
              No one's been referred yet. Once a student signs up with someone's code, they'll show up here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted)]">
                  <tr>
                    <th className="px-3 py-3">New student</th>
                    <th className="px-3 py-3">Referred by</th>
                    <th className="px-3 py-3">Credit</th>
                    <th className="px-3 py-3">Joined</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {data.recentRedemptions.map((redemption) => {
                    const payout = redemption.payouts[0];
                    return (
                      <tr key={redemption.id}>
                        <td className="px-3 py-3">
                          <p className="font-semibold">{redemption.redeemedByStudent.user.name || "Student"}</p>
                          <p className="text-xs text-[var(--muted)]">{redemption.redeemedByStudent.user.email}</p>
                        </td>
                        <td className="px-3 py-3">{redemption.promoCode.ownerStudent?.user.name || "—"}</td>
                        <td className="px-3 py-3">
                          {!payout ? (
                            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-amber-900">
                              Waiting to pay
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="font-semibold tabular-nums">{naira(payout.amount)}</span>
                              <span
                                className={`rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${
                                  payout.status === "credited" ? "bg-emerald-100 text-emerald-900" : "bg-slate-100 text-slate-700"
                                }`}
                              >
                                {payout.status}
                              </span>
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3">{date(redemption.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </AdminShell>
  );
}
