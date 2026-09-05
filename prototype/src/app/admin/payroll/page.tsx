"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { AlertIcon, CheckIcon } from "@/components/icons";

/**
 * What the school pays its tutors — separate from the tuition ledger, which
 * is money coming IN. An admin sets one rate per tutor (per class held, or a
 * flat monthly figure); this page reads back what each tutor actually held
 * this month and shows what they are owed. Recording a payment here is an
 * audit entry, not a trigger — nothing here moves money on its own.
 */

type RateRow = {
  lecturerId: string;
  name: string;
  status: string;
  branchName: string | null;
  rateType: "per_class" | "monthly" | null;
  amount: number | null;
};

type SummaryTutor = {
  lecturerId: string;
  name: string;
  branchName: string | null;
  rateType: "per_class" | "monthly" | null;
  rateAmount: number | null;
  classesHeld: number;
  earned: number | null;
  paid: number;
  owed: number | null;
};

type Summary = {
  period: { label: string };
  tutors: SummaryTutor[];
  totals: { earned: number; paid: number; owed: number };
};

function naira(amount: number): string {
  return `₦${Math.round(amount).toLocaleString("en-NG")}`;
}

function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function PayrollPage() {
  const [rates, setRates] = useState<RateRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [month, setMonth] = useState(currentMonthValue());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [payModal, setPayModal] = useState<{ lecturerId: string; name: string; suggested: number; classesHeld: number } | null>(null);

  const load = useCallback(async (selectedMonth: string) => {
    setLoading(true);
    setError("");
    try {
      const [ratesRes, summaryRes] = await Promise.all([
        fetch("/api/admin/payroll/rates", { cache: "no-store" }),
        fetch(`/api/admin/payroll/summary?month=${selectedMonth}`, { cache: "no-store" }),
      ]);
      const ratesData = await ratesRes.json();
      const summaryData = await summaryRes.json();
      if (!ratesRes.ok) throw new Error(ratesData.error ?? "Could not load tutor rates");
      if (!summaryRes.ok) throw new Error(summaryData.error ?? "Could not load payroll summary");
      setRates(ratesData.lecturers ?? []);
      setSummary(summaryData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(month);
  }, [load, month]);

  async function saveRate(lecturerId: string, rateType: "per_class" | "monthly", amount: number) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    setBusyId(lecturerId);
    try {
      const res = await fetch("/api/admin/payroll/rates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lecturerId, rateType, amount }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not save rate");
      await load(month);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save rate");
    } finally {
      setBusyId(null);
    }
  }

  async function recordPayment(amount: number, note: string) {
    if (!payModal || !Number.isFinite(amount) || amount <= 0) return;
    setBusyId(payModal.lecturerId);
    try {
      const res = await fetch("/api/admin/payroll/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lecturerId: payModal.lecturerId,
          amount,
          periodLabel: summary?.period.label ?? month,
          classesCounted: payModal.classesHeld,
          note: note || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not record payment");
      setPayModal(null);
      await load(month);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record payment");
    } finally {
      setBusyId(null);
    }
  }

  const summaryByLecturer = new Map((summary?.tutors ?? []).map((t) => [t.lecturerId, t]));

  return (
    <AdminShell>
      <div className="min-w-0">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold sm:text-3xl">Tutor payroll</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Set a rate per tutor, see what they earned this month from classes actually held, and
              record what they were paid.
            </p>
          </div>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-2xl bg-red-500/10 p-4 text-sm font-medium text-red-700">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0">{error}</span>
          </div>
        )}

        {summary && (
          <div className="mb-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Earned — {summary.period.label}</p>
              <p className="mt-1 text-2xl font-bold text-[var(--foreground)]">{naira(summary.totals.earned)}</p>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Paid so far</p>
              <p className="mt-1 text-2xl font-bold text-emerald-600">{naira(summary.totals.paid)}</p>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Still owed</p>
              <p className="mt-1 text-2xl font-bold text-[var(--accent)]">{naira(summary.totals.owed)}</p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-[var(--muted)]">Loading…</div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-[var(--surface-alt)]/70 text-left text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3">Tutor</th>
                  <th className="px-4 py-3">Rate</th>
                  <th className="px-4 py-3">Classes held</th>
                  <th className="px-4 py-3">Earned</th>
                  <th className="px-4 py-3">Paid</th>
                  <th className="px-4 py-3">Owed</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {rates.map((tutor) => {
                  const figures = summaryByLecturer.get(tutor.lecturerId);
                  const busy = busyId === tutor.lecturerId;
                  return (
                    <RateRowView
                      key={tutor.lecturerId}
                      tutor={tutor}
                      figures={figures}
                      busy={busy}
                      onSaveRate={(rateType, amount) => void saveRate(tutor.lecturerId, rateType, amount)}
                      onRecordPayment={() =>
                        setPayModal({
                          lecturerId: tutor.lecturerId,
                          name: tutor.name,
                          suggested: figures?.owed ?? 0,
                          classesHeld: figures?.classesHeld ?? 0,
                        })
                      }
                    />
                  );
                })}
                {rates.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-[var(--muted)]">
                      No active tutors found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {payModal && (
        <PayModal
          name={payModal.name}
          suggested={payModal.suggested}
          onCancel={() => setPayModal(null)}
          onConfirm={(amount, note) => void recordPayment(amount, note)}
          busy={busyId === payModal.lecturerId}
        />
      )}
    </AdminShell>
  );
}

function RateRowView({
  tutor,
  figures,
  busy,
  onSaveRate,
  onRecordPayment,
}: {
  tutor: RateRow;
  figures: SummaryTutor | undefined;
  busy: boolean;
  onSaveRate: (rateType: "per_class" | "monthly", amount: number) => void;
  onRecordPayment: () => void;
}) {
  const [rateType, setRateType] = useState<"per_class" | "monthly">(tutor.rateType ?? "per_class");
  const [amount, setAmount] = useState(tutor.amount ? String(tutor.amount) : "");

  return (
    <tr>
      <td className="px-4 py-3">
        <p className="font-semibold text-[var(--foreground)]">{tutor.name}</p>
        <p className="text-xs text-[var(--muted)]">{tutor.branchName ?? "No branch"}</p>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <select
            value={rateType}
            onChange={(e) => setRateType(e.target.value as "per_class" | "monthly")}
            disabled={busy}
            className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs"
          >
            <option value="per_class">per class</option>
            <option value="monthly">monthly</option>
          </select>
          <input
            type="number"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="₦"
            disabled={busy}
            className="w-24 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => onSaveRate(rateType, Number(amount))}
            className="rounded-lg border border-[var(--border)] px-2 py-1.5 text-xs font-semibold text-[var(--muted)] hover:bg-[var(--surface-alt)] disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </td>
      <td className="px-4 py-3 text-center">{figures?.classesHeld ?? "—"}</td>
      <td className="px-4 py-3">{figures?.earned != null ? naira(figures.earned) : "—"}</td>
      <td className="px-4 py-3 text-emerald-600">{figures ? naira(figures.paid) : "—"}</td>
      <td className="px-4 py-3 font-semibold text-[var(--accent)]">{figures?.owed != null ? naira(figures.owed) : "—"}</td>
      <td className="px-4 py-3">
        {tutor.rateType && (
          <button
            type="button"
            onClick={onRecordPayment}
            className="rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110"
          >
            Record payment
          </button>
        )}
      </td>
    </tr>
  );
}

function PayModal({
  name,
  suggested,
  busy,
  onCancel,
  onConfirm,
}: {
  name: string;
  suggested: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (amount: number, note: string) => void;
}) {
  const [amount, setAmount] = useState(suggested > 0 ? String(suggested) : "");
  const [note, setNote] = useState("");

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" onClick={() => !busy && onCancel()}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl">
        <h2 className="text-lg font-bold text-[var(--foreground)]">Record a payment to {name}</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">This is an audit entry — confirm the transfer has already gone out.</p>
        <label className="mt-4 block text-xs font-semibold text-[var(--muted)]">Amount</label>
        <input
          type="number"
          min={0}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={busy}
          className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
        />
        <label className="mt-3 block text-xs font-semibold text-[var(--muted)]">Note (optional)</label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={busy}
          placeholder="e.g. Paid via bank transfer"
          className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
        />
        <div className="mt-5 flex justify-end gap-2.5">
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-full border border-[var(--border)] px-5 py-2.5 text-sm font-semibold hover:bg-[var(--surface-alt)] disabled:opacity-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(Number(amount), note)}
            disabled={busy || !Number(amount)}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
          >
            <CheckIcon className="h-4 w-4" /> {busy ? "Saving…" : "Confirm paid"}
          </button>
        </div>
      </div>
    </div>
  );
}
