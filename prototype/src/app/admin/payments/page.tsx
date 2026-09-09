"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import AdminShell from "@/components/AdminShell";

/**
 * AMOUNTS ARE WHOLE NAIRA.
 *
 * `Payment.amount` is written in naira — the Paystack boundary in
 * src/lib/paystack-verify.ts divides kobo by 100 before it is stored, and the
 * fee table quotes naira. This table divided by 100 again and printed the
 * result next to the row's currency code, so a ₦150,000 tuition payment showed
 * as "1500 USD": wrong by two orders of magnitude and in the wrong currency, on
 * the one screen whose entire job is to state what a student paid.
 */
function naira(amount: number) {
  return `₦${Math.round(amount).toLocaleString("en-NG")}`;
}

/**
 * The ₦5,000 registration fee is mirrored in as a `completed` Payment whose
 * description starts "Registration fee" (see src/lib/payment.ts). It settles
 * nothing toward tuition and never unlocks class access, so this screen must
 * not dress it up as a fully-paid account.
 */
function isRegistrationFeeRow(description?: string | null) {
  return String(description ?? "").startsWith("Registration fee");
}

type PaymentRecord = {
  id: string;
  studentId?: string;
  amount: number;
  currency: string;
  status: string;
  method: string;
  description?: string | null;
  student: { classType?: string; user: { name?: string | null; email: string } };
  invoice?: { id: string } | null;
  createdAt: string;
};

type StudentOption = { id: string; user: { name?: string | null; email: string } };

function PaymentsLedger() {
  const params = useSearchParams();
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [studentId, setStudentId] = useState("");
  const [amount, setAmount] = useState(0);
  // NGN, not USD. The school prices in naira, charges in naira through
  // Paystack and stores naira; a form defaulting to dollars only ever produced
  // rows whose currency code contradicted their own amount.
  const [currency, setCurrency] = useState("ngn");
  const [method, setMethod] = useState("bank_transfer");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("pending");
  const [formError, setFormError] = useState("");
  const [formNotice, setFormNotice] = useState("");
  // A `notice` back from the API is good news ("classes are now unlocked"); a
  // `warning` is amber ("still below the deposit"). Drives the banner colour.
  const [noticeGood, setNoticeGood] = useState(false);
  const [formBusy, setFormBusy] = useState(false);
  // Correcting a hand-entered payment after the fact — a typo'd amount, the
  // wrong status, the wrong method. Gateway rows are not editable here.
  const [editPayment, setEditPayment] = useState<PaymentRecord | null>(null);
  const [rowBusy, setRowBusy] = useState("");
  // Seeded from the URL: the finance workspace links straight to the pending
  // and failed transactions, and to one payment method at a time.
  const [filterStatus, setFilterStatus] = useState<string>(params.get("status") ?? "");
  const [filterMethod, setFilterMethod] = useState<string>(params.get("method") ?? "");
  const [filterClassType, setFilterClassType] = useState<string>(params.get("classType") ?? "");
  const [search, setSearch] = useState<string>(params.get("search") ?? "");
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [totalCount, setTotalCount] = useState(0);

  async function loadPaymentsList() {
    try {
      setLoading(true);
      const url = new URL("/api/admin/payments-list", window.location.origin);
      if (filterStatus) url.searchParams.set("status", filterStatus);
      if (filterMethod) url.searchParams.set("method", filterMethod);
      if (filterClassType) url.searchParams.set("classType", filterClassType);
      if (search) url.searchParams.set("search", search);
      if (page) url.searchParams.set("page", String(page));
      if (pageSize) url.searchParams.set("pageSize", String(pageSize));

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("Unable to load payments");
      const data = await res.json();
      setPayments(data.payments ?? []);
      setTotalCount(typeof data.totalCount === "number" ? data.totalCount : 0);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  async function loadStudents() {
    try {
      const res = await fetch("/api/admin/students");
      if (!res.ok) return;
      const data = await res.json();
      setStudents(data.students || []);
    } catch (error) {
      console.error(error);
    }
  }

  useEffect(() => {
    loadPaymentsList();
    loadStudents();
  }, [filterStatus, filterMethod, filterClassType, search, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [filterStatus, filterMethod, filterClassType, search, pageSize]);

  async function handleStatusUpdate(paymentId: string, newStatus: string) {
    formError && setFormError("");
    try {
      const res = await fetch("/api/admin/payments-list", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId, status: newStatus }),
      });

      if (!res.ok) throw new Error("Unable to update payment status");
      await loadPaymentsList();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to update payment status");
    }
  }

  async function savePaymentEdit(fields: { amount: number; status: string; method: string; description: string }) {
    if (!editPayment) return;
    setRowBusy(editPayment.id);
    setFormError("");
    setFormNotice("");
    try {
      const res = await fetch("/api/admin/payments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editPayment.id,
          amount: Math.round(fields.amount),
          status: fields.status,
          method: fields.method.trim(),
          description: fields.description.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Unable to update payment");
      if (data.travelPackage?.wasFullPaidBefore && !data.travelPackage?.fullPaidAfter) {
        setFormNotice("Payment updated. This student now owes a balance on their Travel Package — they've been notified it's a part payment.");
      }
      setEditPayment(null);
      await loadPaymentsList();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to update payment");
    } finally {
      setRowBusy("");
    }
  }

  async function voidPayment(payment: PaymentRecord) {
    if (!window.confirm(`Void this ${naira(payment.amount)} ${payment.method} payment from ${payment.student.user.name || payment.student.user.email}? It is removed from every total but kept in the audit trail.`)) {
      return;
    }
    setRowBusy(payment.id);
    setFormError("");
    try {
      const res = await fetch(`/api/admin/payments?id=${encodeURIComponent(payment.id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Unable to void payment");
      await loadPaymentsList();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to void payment");
    } finally {
      setRowBusy("");
    }
  }

  function openPaymentForm(
    student: StudentOption,
    prefill?: { amount?: number; description?: string; status?: string; method?: string },
  ) {
    setStudents((current) => current.some((item) => item.id === student.id) ? current : [student, ...current]);
    setStudentId(student.id);
    if (prefill?.amount !== undefined) setAmount(prefill.amount);
    if (prefill?.description !== undefined) setDescription(prefill.description);
    if (prefill?.status !== undefined) setStatus(prefill.status);
    if (prefill?.method !== undefined) setMethod(prefill.method);
    setFormError("");
    setFormNotice("");
    setShowForm(true);
  }

  async function handleCreatePayment() {
    setFormError("");
    setFormNotice("");
    setNoticeGood(false);

    if (!studentId || amount <= 0 || !method.trim()) {
      setFormError("Student, amount, and payment method are required.");
      return;
    }

    setFormBusy(true);

    try {
      const res = await fetch("/api/admin/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId,
          amount: Math.round(amount),
          currency,
          method,
          description: description.trim() || null,
          status,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Unable to create payment");
      }
      if (data.notice) {
        setFormNotice(String(data.notice));
        setNoticeGood(true);
      } else if (data.warning) {
        setFormNotice(String(data.warning));
        setNoticeGood(false);
      }

      setStudentId("");
      setAmount(0);
      setCurrency("ngn");
      setMethod("bank_transfer");
      setDescription("");
      setStatus("pending");
      setShowForm(false);
      setLoading(true);
      await loadPaymentsList();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to create payment");
    } finally {
      setFormBusy(false);
    }
  }

  return (
    <AdminShell>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Admin</p>
            <h1 className="text-3xl font-bold">Payments</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">Review payments, invoices, and student billing history.</p>
          </div>
          <button
            type="button"
            className="rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white"
            onClick={() => setShowForm((current) => !current)}
          >
            {showForm ? "Close form" : "New payment"}
          </button>
        </div>

        {formNotice ? (
          <div
            className={`flex items-start justify-between gap-4 rounded-2xl border px-4 py-3 text-sm ${
              noticeGood
                ? "border-emerald-400/40 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                : "border-amber-400/40 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
            }`}
          >
            <p>{formNotice}</p>
            <button type="button" onClick={() => { setFormNotice(""); setNoticeGood(false); }} className="shrink-0 font-semibold">
              Dismiss
            </button>
          </div>
        ) : null}

        <div className="filter-grid">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
            <label htmlFor="search" className="block text-sm font-semibold text-[var(--muted)]">Search</label>
            <input
              id="search"
              placeholder="Student name or email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            />
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
            <label htmlFor="statusFilter" className="block text-sm font-semibold text-[var(--muted)]">Status</label>
            <select
              id="statusFilter"
              value={filterStatus}
              onChange={(event) => setFilterStatus(event.target.value)}
              className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            >
              <option value="">All statuses</option>
              <option value="completed">Completed</option>
              <option value="partial">Part-payment (balance owed)</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
              <option value="not_paid">Not paid</option>
            </select>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
            <label htmlFor="classTypeFilter" className="block text-sm font-semibold text-[var(--muted)]">Membership</label>
            <select
              id="classTypeFilter"
              value={filterClassType}
              onChange={(event) => setFilterClassType(event.target.value)}
              className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            >
              <option value="">All memberships</option>
              <option value="private">Private membership</option>
              <option value="group">Group class</option>
            </select>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
            <label htmlFor="methodFilter" className="block text-sm font-semibold text-[var(--muted)]">Method</label>
            <select
              id="methodFilter"
              value={filterMethod}
              onChange={(event) => setFilterMethod(event.target.value)}
              className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            >
              <option value="">All methods</option>
              <option value="paystack">Paystack</option>
              <option value="stripe">Stripe</option>
              <option value="manual">Manual</option>
              <option value="card">Card</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="cash">Cash</option>
            </select>
          </div>
        </div>

        {showForm ? (
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-[var(--muted)]">Student</span>
                <select
                  value={studentId}
                  onChange={(event) => setStudentId(event.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                >
                  <option value="">Select a student</option>
                  {students.map((student) => (
                    <option key={student.id} value={student.id}>
                      {student.user.name || student.user.email}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-[var(--muted)]">Amount</span>
                <input
                  type="number"
                  value={amount}
                  onChange={(event) => setAmount(Number(event.target.value))}
                  min={0}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-[var(--muted)]">Currency</span>
                <select
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                >
                  <option value="ngn">NGN (₦)</option>
                  <option value="usd">USD</option>
                  <option value="eur">EUR</option>
                </select>
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-[var(--muted)]">Method</span>
                <select
                  value={method}
                  onChange={(event) => setMethod(event.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                >
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="cash">Cash</option>
                  <option value="pos">POS</option>
                  <option value="card">Card</option>
                  <option value="paystack">Paystack</option>
                </select>
              </label>
              <label className="space-y-2 text-sm md:col-span-2">
                <span className="font-semibold text-[var(--muted)]">Description</span>
                <input
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-2 text-sm md:col-span-2">
                <span className="font-semibold text-[var(--muted)]">Status</span>
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                >
                  <option value="pending">Pending — money not in yet</option>
                  <option value="partial">Part-payment — deposit cleared, balance owed</option>
                  <option value="completed">Completed — account settled</option>
                </select>
              </label>
            </div>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={handleCreatePayment}
                disabled={formBusy}
                className="rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                Save payment
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                disabled={formBusy}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm font-semibold text-[var(--foreground-soft)]"
              >
                Cancel
              </button>
              {formError ? <p className="text-sm text-red-500">{formError}</p> : null}
            </div>
          </div>
        ) : null}

        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-[var(--border)] text-sm">
              <thead className="bg-[var(--background)] text-left uppercase tracking-[0.16em] text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Method</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)] bg-[var(--background)]">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-sm text-[var(--muted)]">Loading payments…</td>
                  </tr>
                ) : payments.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-sm text-[var(--muted)]">No payments recorded yet.</td>
                  </tr>
                ) : (
                  payments.map((payment) => (
                    <tr key={payment.id}>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span>{payment.student.user.name || payment.student.user.email}</span>
                          {payment.student.classType === "private" ? (
                            <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800" title="Private membership">
                              Private membership
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-semibold">{naira(payment.amount)}</td>
                      <td className="px-4 py-3 capitalize">{payment.method}</td>
                      <td className="px-4 py-3">
                        {isRegistrationFeeRow(payment.description) && payment.status === "completed" ? (
                          <span
                            className="rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-700"
                            title="Registration fee received. This does NOT unlock class access — that needs the 60% tuition deposit."
                          >
                            registration paid
                          </span>
                        ) : (
                          <span className={`rounded-full px-2 py-1 text-xs font-semibold ${
                            payment.status === "completed" ? "bg-green-100 text-green-700" :
                            payment.status === "partial" ? "bg-amber-100 text-amber-700" :
                            payment.status === "pending" ? "bg-yellow-100 text-yellow-700" :
                            payment.status === "failed" ? "bg-red-100 text-red-700" : "bg-[var(--surface-alt)] text-[var(--foreground-soft)]"
                          }`}>
                            {payment.status === "partial" ? "part-payment" : payment.status}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">{payment.description ?? "—"}</td>
                      <td className="px-4 py-3">{new Date(payment.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3 flex flex-wrap gap-2">
                        {/* A registration-fee row otherwise offers only "Fail".
                            This is the way in to recording the tuition the
                            student paid at the desk or by transfer — status
                            completed, which unlocks their portal once the
                            received total clears the 60% deposit. */}
                        {isRegistrationFeeRow(payment.description) && payment.studentId ? (
                          <button
                            className="rounded-lg border border-[var(--accent)] text-[var(--accent)] px-2 py-1 text-xs font-semibold"
                            onClick={() =>
                              openPaymentForm(
                                { id: payment.studentId!, user: payment.student.user },
                                { description: "Tuition payment", status: "completed", method: "bank_transfer" },
                              )
                            }
                          >
                            Record tuition payment
                          </button>
                        ) : null}
                        {payment.status === "not_paid" && payment.studentId ? (
                          <button
                            className="rounded-lg border border-[var(--accent)] text-[var(--accent)] px-2 py-1 text-xs"
                            onClick={() => openPaymentForm({ id: payment.studentId!, user: payment.student.user })}
                          >
                            Record payment
                          </button>
                        ) : null}
                        {payment.status !== "partial" && payment.status !== "completed" && payment.status !== "not_paid" && (
                          <button
                            className="rounded-lg border border-amber-500 text-amber-600 px-2 py-1 text-xs"
                            onClick={() => handleStatusUpdate(payment.id, "partial")}
                            title="Deposit cleared — unlocks classes, balance still owed"
                          >
                            Mark part-paid
                          </button>
                        )}
                        {payment.status !== "completed" && payment.status !== "not_paid" && (
                          <button
                            className="rounded-lg border border-green-500 text-green-600 px-2 py-1 text-xs"
                            onClick={() => handleStatusUpdate(payment.id, "completed")}
                          >
                            Complete
                          </button>
                        )}
                        {payment.status !== "failed" && payment.status !== "not_paid" && (
                          <button
                            className="rounded-lg border border-red-500 text-red-600 px-2 py-1 text-xs"
                            onClick={() => handleStatusUpdate(payment.id, "failed")}
                          >
                            Fail
                          </button>
                        )}
                        {payment.status !== "not_paid" && payment.method !== "paystack" && (
                          <>
                            <button
                              className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs font-semibold hover:bg-[var(--surface-alt)] disabled:opacity-50"
                              disabled={rowBusy === payment.id}
                              onClick={() => setEditPayment(payment)}
                            >
                              Edit
                            </button>
                            <button
                              className="rounded-lg border border-red-400 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950/30"
                              disabled={rowBusy === payment.id}
                              onClick={() => void voidPayment(payment)}
                            >
                              {rowBusy === payment.id ? "…" : "Void"}
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center justify-between gap-4 border-t border-[var(--border)] pt-4">
            <div className="text-sm text-[var(--muted)]">
              Page {page} • Showing {payments.length} of {totalCount} payments
            </div>
            <div className="flex items-center gap-3">
              <button
                className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-semibold disabled:opacity-50"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Prev
              </button>
              <button
                className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-semibold disabled:opacity-50"
                onClick={() => setPage((p) => p + 1)}
                disabled={page * pageSize >= totalCount}
              >
                Next
              </button>
              <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-2 text-sm">
                <option value={10}>10/page</option>
                <option value={20}>20/page</option>
                <option value={50}>50/page</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {editPayment && (
        <EditPaymentModal
          key={editPayment.id}
          payment={editPayment}
          busy={rowBusy === editPayment.id}
          onCancel={() => setEditPayment(null)}
          onSave={(fields) => void savePaymentEdit(fields)}
        />
      )}
    </AdminShell>
  );
}

function EditPaymentModal({
  payment,
  busy,
  onCancel,
  onSave,
}: {
  payment: PaymentRecord;
  busy: boolean;
  onCancel: () => void;
  onSave: (fields: { amount: number; status: string; method: string; description: string }) => void;
}) {
  const [amount, setAmount] = useState(String(payment.amount));
  const [status, setStatus] = useState(payment.status);
  const [method, setMethod] = useState(payment.method);
  const [description, setDescription] = useState(payment.description ?? "");

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" onClick={() => !busy && onCancel()}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl">
        <h2 className="text-lg font-bold text-[var(--foreground)]">
          Edit payment — {payment.student.user.name || payment.student.user.email}
        </h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Recorded {new Date(payment.createdAt).toLocaleDateString()}. Corrections update every total this
          payment feeds, straight away.
        </p>

        <label className="mt-4 block text-xs font-semibold text-[var(--muted)]">Amount (₦)</label>
        <input
          type="number"
          min={1}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={busy}
          className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
        />

        <label className="mt-3 block text-xs font-semibold text-[var(--muted)]">Status</label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          disabled={busy}
          className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
        >
          <option value="pending">pending</option>
          <option value="partial">part-payment</option>
          <option value="completed">completed</option>
          <option value="failed">failed</option>
        </select>

        <label className="mt-3 block text-xs font-semibold text-[var(--muted)]">Method</label>
        <input
          type="text"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          disabled={busy}
          className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
        />

        <label className="mt-3 block text-xs font-semibold text-[var(--muted)]">Description</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={busy}
          className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
        />

        <div className="mt-5 flex justify-end gap-2.5">
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-full border border-[var(--border)] px-5 py-2.5 text-sm font-semibold hover:bg-[var(--surface-alt)] disabled:opacity-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave({ amount: Number(amount), status, method, description })}
            disabled={busy || !Number(amount) || Number(amount) <= 0 || !method.trim()}
            className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminPaymentsPage() {
  // useSearchParams needs a Suspense boundary above it.
  return (
    <Suspense
      fallback={
        <AdminShell>
          <p className="p-6 text-sm text-[var(--muted)]">Loading payments…</p>
        </AdminShell>
      }
    >
      <PaymentsLedger />
    </Suspense>
  );
}
