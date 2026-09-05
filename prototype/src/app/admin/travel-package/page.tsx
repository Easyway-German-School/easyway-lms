"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { AlertIcon, CheckIcon, PlaneIcon, PlusIcon } from "@/components/icons";

/**
 * The Travel Package roster — the school's premium, admin-onboarded-only
 * relocation track (₦980,000 flat, ₦200,000 minimum first payment; see
 * TRAVEL_PACKAGE_PRICE in src/lib/payment.ts). Onboarding still happens on
 * the ordinary "Add student" form — the "Travel Package" pathway already
 * lives there — this page is where the office watches these specific
 * accounts afterwards: who has cleared the floor, who hasn't, and what's
 * still owed toward the full ₦980,000.
 */

type TravelPackageStudent = {
  id: string;
  studentCode: string | null;
  name: string;
  email: string;
  level: string;
  branch: string;
  firstPaymentMet: boolean;
  paid: number;
  owed: number;
  progressPercent: number;
  fullPaid: boolean;
  lockedOut: boolean;
};

function naira(amount: number): string {
  return `₦${Math.round(amount).toLocaleString("en-NG")}`;
}

export default function TravelPackagePage() {
  const [students, setStudents] = useState<TravelPackageStudent[]>([]);
  const [packagePrice, setPackagePrice] = useState(980000);
  const [minFirstPayment, setMinFirstPayment] = useState(200000);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [payModal, setPayModal] = useState<TravelPackageStudent | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/travel-package", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load the Travel Package roster");
      setStudents(data.students ?? []);
      setPackagePrice(data.packagePrice ?? 980000);
      setMinFirstPayment(data.minFirstPayment ?? 200000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function recordPayment(amount: number) {
    if (!payModal || !Number.isFinite(amount) || amount <= 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: payModal.id,
          amount,
          method: "bank_transfer",
          status: payModal.paid + amount >= packagePrice ? "completed" : "partial",
          description: "Travel Package payment",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not record the payment");
      setPayModal(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the payment");
    } finally {
      setBusy(false);
    }
  }

  const totalCollected = students.reduce((sum, s) => sum + s.paid, 0);
  const totalOutstanding = students.reduce((sum, s) => sum + s.owed, 0);

  return (
    <AdminShell>
      <div className="min-w-0">
        {/* A dreamier header than the rest of the admin area on purpose — this
            is the school's highest-value track, and the page that watches it
            should not look identical to the roster of every ₦150k A1 seat. */}
        <div className="relative mb-6 overflow-hidden rounded-[28px] p-[1px]" style={{ background: "linear-gradient(135deg, rgba(212,175,55,0.7), rgba(56,142,255,0.35), rgba(212,175,55,0.15))" }}>
          <div className="relative overflow-hidden rounded-[27px] bg-[radial-gradient(circle_at_10%_0%,_#0f1c2e_0%,_#0a0f1a_55%,_#000000_100%)] px-6 py-7 sm:px-9">
            <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-56 w-56 rounded-full bg-[#3B82F6] opacity-[0.18] blur-3xl" />
            <div aria-hidden className="pointer-events-none absolute bottom-0 left-1/4 h-64 w-64 rounded-full bg-[#D4AF37] opacity-[0.14] blur-3xl" />
            <div className="relative flex flex-wrap items-start justify-between gap-4">
              <div>
                <span className="inline-flex items-center gap-2 rounded-full border border-[#D4AF37]/40 bg-[#D4AF37]/10 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#E8C766]">
                  <PlaneIcon className="h-3.5 w-3.5" /> Travel Package
                </span>
                <h1 className="mt-4 text-2xl font-bold text-white sm:text-3xl">The relocation track</h1>
                <p className="mt-2 max-w-xl text-sm leading-6 text-white/60">
                  {naira(packagePrice)} flat, walk-in only. A {naira(minFirstPayment)} minimum first
                  payment opens the account; everything after that is flexible, any amount, until the
                  full fee is in.
                </p>
              </div>
              <Link
                href="/admin/students?addStudent=1&pathway=Travel%20Package"
                className="inline-flex items-center gap-2 rounded-full bg-[#D4AF37] px-5 py-2.5 text-sm font-bold text-[#1c1508] shadow-lg transition hover:brightness-110"
              >
                <PlusIcon className="h-4 w-4" /> Add a student
              </Link>
            </div>

            <div className="relative mt-7 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <p className="text-[11px] uppercase tracking-[0.2em] text-white/40">Students</p>
                <p className="mt-1 text-2xl font-bold text-white">{students.length}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <p className="text-[11px] uppercase tracking-[0.2em] text-white/40">Collected</p>
                <p className="mt-1 text-2xl font-bold text-emerald-400">{naira(totalCollected)}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <p className="text-[11px] uppercase tracking-[0.2em] text-white/40">Outstanding</p>
                <p className="mt-1 text-2xl font-bold text-[#E8C766]">{naira(totalOutstanding)}</p>
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-2xl bg-red-500/10 p-4 text-sm font-medium text-red-700">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0">{error}</span>
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-[var(--muted)]">Loading…</div>
        ) : students.length === 0 ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-[var(--muted)]">
            No Travel Package students yet. Onboard the first one from &quot;Add a student&quot; above —
            pick the Travel Package pathway on the form.
          </div>
        ) : (
          <div className="space-y-3">
            {students.map((s) => (
              <div key={s.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link href={`/admin/students/${s.id}`} className="font-semibold text-[var(--foreground)] hover:underline">
                      {s.name}
                    </Link>
                    <p className="text-xs text-[var(--muted)]">
                      {s.studentCode ?? "No student ID yet"} · Level {s.level} · {s.branch}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!s.firstPaymentMet && (
                      <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-600">
                        Below {naira(minFirstPayment)} floor
                      </span>
                    )}
                    {s.fullPaid && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-emerald-600">
                        <CheckIcon className="h-3 w-3" /> Paid in full
                      </span>
                    )}
                    {!s.fullPaid && (
                      <button
                        type="button"
                        onClick={() => setPayModal(s)}
                        className="rounded-full bg-[var(--accent)] px-3.5 py-1.5 text-xs font-semibold text-white hover:brightness-110"
                      >
                        Record payment
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-3">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-alt)]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#D4AF37] to-[#E8C766]"
                      style={{ width: `${Math.min(100, s.progressPercent)}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-[var(--muted)]">
                    {naira(s.paid)} of {naira(packagePrice)} · {naira(s.owed)} remaining
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {payModal && (
        <PayModal
          student={payModal}
          minFirstPayment={minFirstPayment}
          busy={busy}
          onCancel={() => setPayModal(null)}
          onConfirm={(amount) => void recordPayment(amount)}
        />
      )}
    </AdminShell>
  );
}

function PayModal({
  student,
  minFirstPayment,
  busy,
  onCancel,
  onConfirm,
}: {
  student: TravelPackageStudent;
  minFirstPayment: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (amount: number) => void;
}) {
  const floorRemaining = Math.max(0, minFirstPayment - student.paid);
  const [amount, setAmount] = useState(floorRemaining > 0 ? String(floorRemaining) : "");

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" onClick={() => !busy && onCancel()}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl">
        <h2 className="text-lg font-bold text-[var(--foreground)]">Record a payment from {student.name}</h2>
        {floorRemaining > 0 ? (
          <p className="mt-2 text-xs leading-5 text-amber-600">
            This student hasn&apos;t reached the {naira(minFirstPayment)} minimum first payment yet —
            {naira(floorRemaining)} more clears it.
          </p>
        ) : (
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
            The floor is already cleared — any further amount is fine.
          </p>
        )}
        <label className="mt-4 block text-xs font-semibold text-[var(--muted)]">Amount received</label>
        <input
          type="number"
          min={0}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={busy}
          className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
        />
        <div className="mt-5 flex justify-end gap-2.5">
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-full border border-[var(--border)] px-5 py-2.5 text-sm font-semibold hover:bg-[var(--surface-alt)] disabled:opacity-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(Number(amount))}
            disabled={busy || !Number(amount)}
            className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "Recording…" : "Confirm received"}
          </button>
        </div>
      </div>
    </div>
  );
}
