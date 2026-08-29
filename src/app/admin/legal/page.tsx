"use client";

/**
 * LEGAL & REFUNDS — the school's own consent ledger and refund queue.
 *
 * Two tabs on one page rather than two pages, because the questions they
 * answer are the same conversation: "did this student agree to the policy"
 * and "what did they ask for afterwards" are read together far more often
 * than either is read alone — a refund decision is the one place this school
 * needs to point at a specific signature, and that signature lives in the
 * other tab.
 */

import { useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import BrandLoader from "@/components/BrandLoader";
import { AlertIcon, CrossIcon } from "@/components/icons";

type Acceptance = {
  id: string;
  name: string;
  email: string;
  studentCode: string | null;
  branch: string | null;
  level: string | null;
  context: string;
  version: string;
  acceptedAt: string;
  ip: string | null;
};

type RefundRequest = {
  id: string;
  status: string;
  name: string;
  email: string;
  phone: string;
  studentCode: string | null;
  branch: string | null;
  level: string | null;
  courseOrPackage: string;
  paymentReference: string;
  reason: string;
  supportingDocs: string[] | null;
  requestedAmount: number | null;
  decisionAmount: number | null;
  decisionNote: string | null;
  decidedByName: string | null;
  acceptedTermsVersion: string;
  acceptedTermsAt: string;
  createdAt: string;
  decidedAt: string | null;
  paidAt: string | null;
};

const TABS = ["Refund requests", "Terms acceptances"] as const;
type Tab = (typeof TABS)[number];

const STATUS_STYLE: Record<string, string> = {
  submitted: "bg-amber-400/15 text-amber-600",
  under_review: "bg-sky-400/15 text-sky-600",
  approved: "bg-emerald-400/15 text-emerald-600",
  rejected: "bg-rose-400/15 text-rose-600",
  paid: "bg-emerald-500/20 text-emerald-700",
};

const STATUS_LABEL: Record<string, string> = {
  submitted: "Submitted",
  under_review: "Under review",
  approved: "Approved",
  rejected: "Rejected",
  paid: "Paid",
};

function DecideSheet({
  request,
  onClose,
  onDecided,
}: {
  request: RefundRequest;
  onClose: () => void;
  onDecided: (updated: { id: string; status: string }) => void;
}) {
  const [status, setStatus] = useState(request.status === "submitted" ? "under_review" : request.status);
  const [amount, setAmount] = useState(request.decisionAmount?.toString() ?? "");
  const [note, setNote] = useState(request.decisionNote ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/legal/refunds/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          decisionAmount: amount ? Number(amount) : undefined,
          decisionNote: note || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not save this decision.");
      onDecided(data.request);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this decision.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--accent)]">Refund request</p>
            <h2 className="mt-1 text-xl font-black text-[var(--foreground)]">{request.name}</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">{request.email} · {request.phone}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-[var(--muted)] hover:bg-[var(--surface-alt)]" aria-label="Close">
            <CrossIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-4 text-sm">
          <p><span className="font-semibold text-[var(--foreground)]">Course/package:</span> <span className="text-[var(--muted)]">{request.courseOrPackage}</span></p>
          <p><span className="font-semibold text-[var(--foreground)]">Payment reference:</span> <span className="text-[var(--muted)]">{request.paymentReference}</span></p>
          {request.studentCode ? (
            <p><span className="font-semibold text-[var(--foreground)]">Student:</span> <span className="text-[var(--muted)]">{request.studentCode} · {request.branch ?? "—"} · {request.level ?? "—"}</span></p>
          ) : null}
          <p><span className="font-semibold text-[var(--foreground)]">Reason:</span> <span className="text-[var(--muted)]">{request.reason}</span></p>
          {request.requestedAmount ? (
            <p><span className="font-semibold text-[var(--foreground)]">Requested amount:</span> <span className="text-[var(--muted)]">₦{request.requestedAmount.toLocaleString()}</span></p>
          ) : null}
          <p className="text-xs text-[var(--muted)]">
            Acknowledged Terms and Conditions v{request.acceptedTermsVersion} on {new Date(request.acceptedTermsAt).toLocaleString()}.
          </p>
          {request.supportingDocs?.length ? (
            <div className="flex flex-wrap gap-2">
              {request.supportingDocs.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer" className="rounded-full bg-[var(--surface)] px-3 py-1 text-xs font-semibold text-[var(--accent)] underline-offset-2 hover:underline">
                  Supporting document
                </a>
              ))}
            </div>
          ) : null}
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label>
            <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Decision</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]">
              <option value="under_review">Under review</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="paid">Paid</option>
            </select>
          </label>
          <label>
            <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Approved amount (₦, up to 70% per section 23)</span>
            <input
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
            />
          </label>
          <label className="sm:col-span-2">
            <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Note to the student</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
            />
          </label>
        </div>

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

        <div className="mt-6 flex gap-3">
          <button type="button" onClick={save} disabled={saving} className="flex-1 rounded-xl bg-gradient-to-r from-[#0D7C7E] to-[#FF6600] px-6 py-3 text-sm font-bold text-white disabled:opacity-60">
            {saving ? "Saving…" : "Save decision"}
          </button>
          <button type="button" onClick={onClose} className="rounded-xl border border-[var(--border)] px-6 py-3 text-sm font-bold text-[var(--foreground)] hover:bg-[var(--surface-alt)]">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LegalPage() {
  const [tab, setTab] = useState<Tab>("Refund requests");
  const [acceptances, setAcceptances] = useState<Acceptance[]>([]);
  const [refunds, setRefunds] = useState<RefundRequest[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deciding, setDeciding] = useState<RefundRequest | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [refundsRes, acceptancesRes] = await Promise.all([
        fetch(`/api/admin/legal/refunds?status=${statusFilter}`, { cache: "no-store" }),
        fetch("/api/admin/legal/terms", { cache: "no-store" }),
      ]);
      const refundsData = await refundsRes.json();
      const acceptancesData = await acceptancesRes.json();
      if (!refundsRes.ok) throw new Error(refundsData?.error || "Could not load refund requests.");
      if (!acceptancesRes.ok) throw new Error(acceptancesData?.error || "Could not load terms acceptances.");
      setRefunds(refundsData.requests || []);
      setAcceptances(acceptancesData.acceptances || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this page.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  return (
    <AdminShell>
      <main className="min-h-screen bg-[var(--background)] p-6 text-[var(--foreground)] sm:p-10">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent)]/15 text-[var(--accent)]">
              <AlertIcon className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--accent)]">Legal</p>
              <h1 className="text-2xl font-black">Legal &amp; refunds</h1>
            </div>
          </div>
          <p className="mt-3 max-w-2xl text-sm text-[var(--muted)]">
            Every acceptance of the school&apos;s Terms and Conditions, and every refund request weighed against it — the
            same record a school would otherwise keep in a filing cabinet.
          </p>

          <div className="mt-8 flex gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] p-1.5">
            {TABS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setTab(item)}
                className={`flex-1 rounded-full px-4 py-2.5 text-sm font-bold transition ${
                  tab === item ? "bg-[var(--accent)] text-white" : "text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {item}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="mt-10"><BrandLoader /></div>
          ) : error ? (
            <p className="mt-10 text-sm text-red-600">{error}</p>
          ) : tab === "Refund requests" ? (
            <div className="mt-6">
              <div className="flex flex-wrap gap-2">
                {["all", "submitted", "under_review", "approved", "rejected", "paid"].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setStatusFilter(value)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-[0.1em] transition ${
                      statusFilter === value
                        ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                        : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    {value === "all" ? "All" : STATUS_LABEL[value]}
                  </button>
                ))}
              </div>

              <div className="mt-4 overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)]">
                {refunds.length === 0 ? (
                  <p className="p-8 text-center text-sm text-[var(--muted)]">No refund requests here.</p>
                ) : (
                  <div className="divide-y divide-[var(--border)]">
                    {refunds.map((request) => (
                      <button
                        key={request.id}
                        type="button"
                        onClick={() => setDeciding(request)}
                        className="flex w-full flex-col gap-2 px-5 py-4 text-left transition hover:bg-[var(--surface-alt)] sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-[var(--foreground)]">{request.name}</p>
                          <p className="truncate text-sm text-[var(--muted)]">
                            {request.courseOrPackage} · {new Date(request.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <span className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${STATUS_STYLE[request.status] ?? "bg-[var(--surface-alt)] text-[var(--muted)]"}`}>
                          {STATUS_LABEL[request.status] ?? request.status}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-6 overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)]">
              {acceptances.length === 0 ? (
                <p className="p-8 text-center text-sm text-[var(--muted)]">No acceptances recorded yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-[var(--border)] text-left text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
                      <tr>
                        <th className="px-5 py-3">Name</th>
                        <th className="px-5 py-3">Student</th>
                        <th className="px-5 py-3">Context</th>
                        <th className="px-5 py-3">Version</th>
                        <th className="px-5 py-3">Accepted</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {acceptances.map((row) => (
                        <tr key={row.id}>
                          <td className="px-5 py-3">
                            <p className="font-semibold text-[var(--foreground)]">{row.name}</p>
                            <p className="text-xs text-[var(--muted)]">{row.email}</p>
                          </td>
                          <td className="px-5 py-3 text-[var(--muted)]">
                            {row.studentCode ? `${row.studentCode} · ${row.branch ?? "—"} · ${row.level ?? "—"}` : "—"}
                          </td>
                          <td className="px-5 py-3 capitalize text-[var(--muted)]">{row.context}</td>
                          <td className="px-5 py-3 text-[var(--muted)]">{row.version}</td>
                          <td className="px-5 py-3 text-[var(--muted)]">{new Date(row.acceptedAt).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {deciding ? (
        <DecideSheet
          request={deciding}
          onClose={() => setDeciding(null)}
          onDecided={(updated) => {
            setRefunds((prev) => prev.map((row) => (row.id === updated.id ? { ...row, status: updated.status } : row)));
            setDeciding(null);
          }}
        />
      ) : null}
    </AdminShell>
  );
}
