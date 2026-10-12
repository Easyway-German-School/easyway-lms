"use client";

import { useEffect, useMemo, useState } from "react";

import AdminShell from "@/components/AdminShell";
import { DownloadIcon, RefreshIcon } from "@/components/icons";

type Code = {
  id: string;
  code: string;
  type: "student_referral";
  status: "active" | "paused" | "revoked";
  label: string | null;
  discountPercent: number | null;
  discountFlat: number | null;
  discountCapAmount: number | null;
  commissionPercent: number | null;
  commissionFlat: number | null;
  createdAt: string;
  ownerStudent: { studentCode: string | null; user: { name: string | null; email: string }; branch: { name: string } | null } | null;
  _count: { redemptions: number };
};

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
  type: string;
  status: string;
  discountAmount: number;
  createdAt: string;
  redeemedByStudent: { studentCode: string | null; user: { name: string | null; email: string }; branch: { name: string } | null };
};

type ReferralData = {
  codes: Code[];
  pendingPayouts: Payout[];
  recentRedemptions: Redemption[];
  totalRedemptions: number;
  openHolds: number;
  truncated: boolean;
};

const naira = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;
const date = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function rewardLabel(code: Pick<Code, "discountPercent" | "discountFlat" | "commissionPercent" | "commissionFlat">): {
  discount: string;
  commission: string;
} {
  const discountParts: string[] = [];
  if (code.discountPercent) discountParts.push(`${code.discountPercent}%`);
  if (code.discountFlat) discountParts.push(naira(code.discountFlat));
  const commissionParts: string[] = [];
  if (code.commissionPercent) commissionParts.push(`${code.commissionPercent}%`);
  if (code.commissionFlat) commissionParts.push(naira(code.commissionFlat));
  return {
    discount: discountParts.length ? discountParts.join(" + ") : "—",
    commission: commissionParts.length ? commissionParts.join(" + ") : "—",
  };
}

const AMOUNT_FIELDS = ["discountPercent", "discountFlat", "discountCapAmount", "commissionPercent", "commissionFlat"] as const;

export default function AdminReferralsPage() {
  const [data, setData] = useState<ReferralData | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [creditingId, setCreditingId] = useState<string | null>(null);
  const [creditNote, setCreditNote] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  function refresh() {
    setLoading(true);
    setError("");
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

  const filteredCodes = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return data?.codes ?? [];
    return (data?.codes ?? []).filter((code) => {
      const owner = code.ownerStudent?.user;
      return [code.code, code.label, owner?.name, owner?.email].some((value) => value?.toLowerCase().includes(query));
    });
  }, [data?.codes, search]);

  const pendingPayoutTotal = useMemo(
    () => (data?.pendingPayouts ?? []).filter((p) => p.status === "pending").reduce((sum, p) => sum + p.amount, 0),
    [data?.pendingPayouts],
  );

  async function copyLink(code: string) {
    const link = `${window.location.origin}/auth/signup?promo=${encodeURIComponent(code)}`;
    try {
      await navigator.clipboard.writeText(link);
      setNotice(`Signup link copied for ${code}.`);
      setError("");
    } catch {
      setError("Could not copy the link. Check browser clipboard permissions.");
      setNotice("");
    }
  }

  function downloadCsv() {
    const rows = [
      ["Code", "Owner", "Email", "Discount", "Commission", "Sign-ups", "Status", "Created"],
      ...filteredCodes.map((code) => {
        const owner = code.ownerStudent?.user;
        const reward = rewardLabel(code);
        return [
          code.code,
          owner?.name,
          owner?.email,
          reward.discount,
          reward.commission,
          code._count.redemptions,
          code.status,
          date(code.createdAt),
        ];
      }),
    ];
    const blob = new Blob([rows.map((row) => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `easyway-referral-codes-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function startEdit(code: Code) {
    setEditingId(code.id);
    setEditValues({
      discountPercent: code.discountPercent?.toString() ?? "",
      discountFlat: code.discountFlat?.toString() ?? "",
      discountCapAmount: code.discountCapAmount?.toString() ?? "",
      commissionPercent: code.commissionPercent?.toString() ?? "",
      commissionFlat: code.commissionFlat?.toString() ?? "",
    });
  }

  async function saveEdit(id: string) {
    setBusyId(id);
    setError("");
    try {
      const res = await fetch(`/api/admin/promo-codes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          Object.fromEntries(AMOUNT_FIELDS.map((field) => [field, editValues[field] === "" ? null : Number(editValues[field])])),
        ),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Unable to save changes.");
      setEditingId(null);
      setNotice("Saved.");
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save changes.");
    } finally {
      setBusyId(null);
    }
  }

  async function setStatus(id: string, status: "active" | "paused" | "revoked") {
    setBusyId(id);
    setError("");
    try {
      const res = await fetch(`/api/admin/promo-codes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Unable to update status.");
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update status.");
    } finally {
      setBusyId(null);
    }
  }

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
      setNotice("Payout approved.");
      refresh();
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
      setNotice("Payout credited.");
      refresh();
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
              Every student's referral code — minted automatically at signup — the sign-ups it's brought in, and the
              credit owed. Influencers and other partners live in their own{" "}
              <a href="/admin/influencer-program" className="font-semibold text-[var(--accent-ink)] hover:underline">
                Influencer Program
              </a>
              .
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold disabled:opacity-50"
            >
              <RefreshIcon className="h-4 w-4" />
              Refresh
            </button>
            <button
              type="button"
              onClick={downloadCsv}
              disabled={!filteredCodes.length}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              <DownloadIcon className="h-4 w-4" />
              Export CSV
            </button>
          </div>
        </header>

        {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p> : null}
        {notice ? <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{notice}</p> : null}

        <section className="grid gap-3 sm:grid-cols-4">
          {[
            { label: "Promo codes", value: data?.codes.length ?? 0 },
            { label: "Attributed sign-ups", value: data?.totalRedemptions ?? 0 },
            { label: "Owed (pending)", value: pendingPayoutTotal, money: true },
            { label: "Open holds", value: data?.openHolds ?? 0 },
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
                          Code {payout.promoCode.code} ({owner?.name || owner?.email || "—"}) · referred{" "}
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
            This view is capped for performance. Some codes, payouts or registrations may be incomplete.
          </p>
        ) : null}

        <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Codes</h2>
              <p className="text-sm text-[var(--muted)]">Every student's referral code.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                aria-label="Search codes"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, email or code"
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm"
              />
            </div>
          </div>

          {loading ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">Loading…</p>
          ) : filteredCodes.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">No codes match this view.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-sm">
                <thead className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted)]">
                  <tr>
                    <th className="px-3 py-3">Owner</th>
                    <th className="px-3 py-3">Code</th>
                    <th className="px-3 py-3">Discount</th>
                    <th className="px-3 py-3">Commission</th>
                    <th className="px-3 py-3">Sign-ups</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {filteredCodes.map((code) => {
                    const owner = code.ownerStudent?.user;
                    const reward = rewardLabel(code);
                    const isEditing = editingId === code.id;
                    return (
                      <tr key={code.id}>
                        <td className="px-3 py-3">
                          <p className="font-semibold">{owner?.name || "—"}</p>
                          <p className="text-xs text-[var(--muted)]">{owner?.email}</p>
                        </td>
                        <td className="px-3 py-3 font-mono font-bold">{code.code}</td>
                        {isEditing ? (
                          <>
                            <td className="px-3 py-3">
                              <div className="flex gap-1">
                                <input
                                  aria-label="Discount percent"
                                  value={editValues.discountPercent}
                                  onChange={(e) => setEditValues((v) => ({ ...v, discountPercent: e.target.value }))}
                                  placeholder="%"
                                  className="w-14 rounded border border-[var(--border)] px-1.5 py-1 text-xs"
                                />
                                <input
                                  aria-label="Discount flat"
                                  value={editValues.discountFlat}
                                  onChange={(e) => setEditValues((v) => ({ ...v, discountFlat: e.target.value }))}
                                  placeholder="₦"
                                  className="w-20 rounded border border-[var(--border)] px-1.5 py-1 text-xs"
                                />
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex gap-1">
                                <input
                                  aria-label="Commission percent"
                                  value={editValues.commissionPercent}
                                  onChange={(e) => setEditValues((v) => ({ ...v, commissionPercent: e.target.value }))}
                                  placeholder="%"
                                  className="w-14 rounded border border-[var(--border)] px-1.5 py-1 text-xs"
                                />
                                <input
                                  aria-label="Commission flat"
                                  value={editValues.commissionFlat}
                                  onChange={(e) => setEditValues((v) => ({ ...v, commissionFlat: e.target.value }))}
                                  placeholder="₦"
                                  className="w-20 rounded border border-[var(--border)] px-1.5 py-1 text-xs"
                                />
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-3 py-3">{reward.discount}</td>
                            <td className="px-3 py-3">{reward.commission}</td>
                          </>
                        )}
                        <td className="px-3 py-3 tabular-nums">{code._count.redemptions}</td>
                        <td className="px-3 py-3">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${
                              code.status === "active"
                                ? "bg-emerald-100 text-emerald-900"
                                : code.status === "paused"
                                ? "bg-amber-100 text-amber-900"
                                : "bg-rose-100 text-rose-900"
                            }`}
                          >
                            {code.status}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <button type="button" onClick={() => void copyLink(code.code)} className="text-xs font-semibold text-[var(--accent-ink)] hover:underline">
                              Copy link
                            </button>
                            {isEditing ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void saveEdit(code.id)}
                                  disabled={busyId === code.id}
                                  className="text-xs font-semibold text-emerald-700 hover:underline disabled:opacity-50"
                                >
                                  Save
                                </button>
                                <button type="button" onClick={() => setEditingId(null)} className="text-xs font-semibold text-[var(--muted)] hover:underline">
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button type="button" onClick={() => startEdit(code)} className="text-xs font-semibold text-[var(--accent-ink)] hover:underline">
                                Edit reward
                              </button>
                            )}
                            {code.status === "active" ? (
                              <button
                                type="button"
                                onClick={() => void setStatus(code.id, "paused")}
                                disabled={busyId === code.id}
                                className="text-xs font-semibold text-amber-700 hover:underline disabled:opacity-50"
                              >
                                Pause
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void setStatus(code.id, "active")}
                                disabled={busyId === code.id}
                                className="text-xs font-semibold text-emerald-700 hover:underline disabled:opacity-50"
                              >
                                Activate
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div>
            <h2 className="text-lg font-bold">Recent sign-ups</h2>
            <p className="text-sm text-[var(--muted)]">A registration is recorded when a new student signs up with a promo code.</p>
          </div>
          {!data?.recentRedemptions.length ? (
            <p className="py-6 text-center text-sm text-[var(--muted)]">No registrations have been attributed yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted)]">
                  <tr>
                    <th className="px-3 py-3">Student</th>
                    <th className="px-3 py-3">Code</th>
                    <th className="px-3 py-3">Discount</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Registered</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {data.recentRedemptions.map((redemption) => (
                    <tr key={redemption.id}>
                      <td className="px-3 py-3">
                        <p className="font-semibold">{redemption.redeemedByStudent.user.name || "Student"}</p>
                        <p className="text-xs text-[var(--muted)]">{redemption.redeemedByStudent.user.email}</p>
                      </td>
                      <td className="px-3 py-3 font-mono">{redemption.codeSnapshot}</td>
                      <td className="px-3 py-3 tabular-nums">{redemption.discountAmount ? naira(redemption.discountAmount) : "—"}</td>
                      <td className="px-3 py-3 capitalize">{redemption.status}</td>
                      <td className="px-3 py-3">{date(redemption.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </AdminShell>
  );
}
