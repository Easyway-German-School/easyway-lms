"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import StudentShell from "@/components/StudentShell";
import TuitionNudge from "@/components/TuitionNudge";
import { CheckIcon } from "@/components/icons";

type PaymentRecord = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  method: string;
  description?: string;
  createdAt: string;
};

export default function PaymentsPage() {
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Tuition varies by level (A1 150k … C2 220k), so the figures have to come
  // from the server rather than a constant on this page.
  const [summary, setSummary] = useState<{
    totalPaid: number;
    tuitionFee: number;
    fullPaid: boolean;
    paymentProgressPercent: number;
  } | null>(null);

  useEffect(() => {
    async function loadPayments() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/student/payments", { cache: "no-store", credentials: "include" });
        if (!response.ok) {
          throw new Error(`Unable to load payments (${response.status})`);
        }
        const data = await response.json();
        setPayments(Array.isArray(data.payments) ? data.payments : []);

        const summaryRes = await fetch("/api/student", { cache: "no-store", credentials: "include" });
        if (summaryRes.ok) {
          const student = await summaryRes.json();
          if (student?.paymentSummary) setSummary(student.paymentSummary);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load payments");
      } finally {
        setLoading(false);
      }
    }

    async function syncPendingPayment() {
      if (typeof window === "undefined") return;
      const pendingReference = window.localStorage.getItem("pendingPaystackReference");
      if (!pendingReference) {
        await loadPayments();
        return;
      }

      try {
        const verifyResponse = await fetch(`/api/paystack/verify?reference=${encodeURIComponent(pendingReference)}`, {
          cache: "no-store",
          credentials: "include",
        });
        if (verifyResponse.ok) {
          window.localStorage.removeItem("pendingPaystackReference");
        }
      } catch {
        // ignore verify failures and still show the latest payment list
      } finally {
        await loadPayments();
      }
    }

    void syncPendingPayment();
  }, []);

  // Prefer the server's figures; fall back to summing the visible rows only
  // while the summary is still loading.
  const totalPaid = summary?.totalPaid ?? payments
    .filter((payment) => payment.status.toLowerCase() === "completed")
    .reduce((sum, payment) => sum + payment.amount, 0);
  const tuitionFee = summary?.tuitionFee ?? 150000;
  const fullPaid = summary?.fullPaid ?? false;
  const amountDue = Math.max(0, tuitionFee - totalPaid);
  const paymentProgress = Math.min(100, Math.round((totalPaid / tuitionFee) * 100));

  return (
    <StudentShell>
      <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
        <div className="mx-auto max-w-7xl px-6 py-10">
          {/* Renders nothing once tuition is settled. */}
          <TuitionNudge className="mb-6" />
          <div className="rounded-[32px] border border-[var(--border)] bg-[var(--surface)] p-8 shadow-[var(--shadow)]">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.3em] text-[var(--muted)]">Payments</p>
                <h1 className="mt-3 text-3xl font-semibold">Billing overview</h1>
                <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
                  Track your payment history, upcoming balance, and complete secure checkout from the program payment page.
                </p>
              </div>
              {/*
                Once tuition is settled there is nothing left to charge, and a
                live Pay button invites a duplicate payment that then has to be
                refunded by hand.
              */}
              {fullPaid ? (
                <span
                  aria-disabled="true"
                  className="inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-full border border-emerald-300 bg-emerald-50 px-6 py-3 text-sm font-semibold text-emerald-700"
                >
                  <CheckIcon className="h-4 w-4" /> Tuition fully paid
                </span>
              ) : (
                <Link href="/programs" className="inline-flex items-center justify-center rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[var(--accent)]/20 transition hover:brightness-110">
                  Make a payment
                </Link>
              )}
            </div>

            <div className="mt-10 grid gap-6 lg:grid-cols-3">
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)] p-6 shadow-sm">
                <p className="text-sm uppercase tracking-[0.3em] text-[var(--muted)]">Total paid</p>
                <p className="mt-4 text-4xl font-semibold text-[var(--foreground)]">₦{totalPaid.toLocaleString()}</p>
                <p className="mt-2 text-sm text-[var(--muted)]">Completed payments received</p>
              </div>
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)] p-6 shadow-sm">
                <p className="text-sm uppercase tracking-[0.3em] text-[var(--muted)]">Outstanding</p>
                <p className="mt-4 text-4xl font-semibold text-[var(--accent)]">₦{amountDue.toLocaleString()}</p>
                <p className="mt-2 text-sm text-[var(--muted)]">Balance remaining for tuition.</p>
              </div>
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)] p-6 shadow-sm">
                <p className="text-sm uppercase tracking-[0.3em] text-[var(--muted)]">Progress</p>
                <p className="mt-4 text-4xl font-semibold text-[var(--foreground)]">{paymentProgress}%</p>
                <p className="mt-2 text-sm text-[var(--muted)]">Payment completion ratio</p>
              </div>
            </div>

            <div className="mt-10 overflow-hidden rounded-[32px] border border-[var(--border)] bg-[var(--surface-alt)] shadow-sm">
              <div className="grid grid-cols-5 gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-6 py-4 text-sm uppercase tracking-[0.24em] text-[var(--muted)]">
                <span className="col-span-2">Payment</span>
                <span>Status</span>
                <span>Amount</span>
                <span>Date</span>
              </div>

              <div className="space-y-3 px-6 py-6 text-sm text-[var(--foreground)]">
                {loading ? (
                  <div className="rounded-3xl border border-[var(--border)] bg-white px-6 py-8 text-center text-sm text-[var(--muted)]">
                    Loading payment history…
                  </div>
                ) : error ? (
                  <div className="rounded-3xl border border-rose-200 bg-rose-50 px-6 py-8 text-center text-sm text-rose-700">
                    {error}
                  </div>
                ) : payments.length === 0 ? (
                  <div className="rounded-3xl border border-[var(--border)] bg-white px-6 py-8 text-center text-sm text-[var(--muted)]">
                    No payments have been recorded yet. Click &quot;Make a payment&quot; to pay your next deposit or tuition balance.
                  </div>
                ) : (
                  payments.map((payment) => (
                    <div key={payment.id} className="grid grid-cols-5 gap-4 rounded-3xl border border-[var(--border)] bg-white px-4 py-4 shadow-sm">
                      <span className="col-span-2">{payment.description || "Payment received"}</span>
                      <span className={payment.status.toLowerCase() === "completed" ? "text-emerald-600" : "text-[var(--accent)]"}>
                        {payment.status}
                      </span>
                      <span>
                        {payment.currency.toUpperCase()} {payment.amount.toLocaleString()}
                      </span>
                      <span>{new Date(payment.createdAt).toLocaleDateString()}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </StudentShell>
  );
}
