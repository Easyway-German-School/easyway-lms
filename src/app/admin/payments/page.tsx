"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";

type PaymentRecord = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  method: string;
  description?: string | null;
  student: { user: { name?: string | null; email: string } };
  invoice?: { id: string } | null;
  createdAt: string;
};

type StudentOption = { id: string; user: { name?: string | null; email: string } };

export default function AdminPaymentsPage() {
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [studentId, setStudentId] = useState("");
  const [amount, setAmount] = useState(0);
  const [currency, setCurrency] = useState("usd");
  const [method, setMethod] = useState("card");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("pending");
  const [formError, setFormError] = useState("");
  const [formBusy, setFormBusy] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterMethod, setFilterMethod] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [totalCount, setTotalCount] = useState(0);

  async function loadPaymentsList() {
    try {
      setLoading(true);
      const url = new URL("/api/admin/payments-list", window.location.origin);
      if (filterStatus) url.searchParams.set("status", filterStatus);
      if (filterMethod) url.searchParams.set("method", filterMethod);
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

  async function loadPayments() {
    try {
      const res = await fetch("/api/admin/payments");
      if (!res.ok) throw new Error("Unable to load payments");
      const data = await res.json();
      setPayments(data.payments ?? []);
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
  }, [filterStatus, filterMethod, search, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [filterStatus, filterMethod, search, pageSize]);

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

  async function handleCreatePayment() {
    setFormError("");

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

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Unable to create payment");
      }

      setStudentId("");
      setAmount(0);
      setCurrency("usd");
      setMethod("card");
      setDescription("");
      setStatus("pending");
      setShowForm(false);
      setLoading(true);
      await loadPayments();
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

        <div className="grid gap-4 sm:grid-cols-3">
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
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
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
                  <option value="card">Card</option>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="cash">Cash</option>
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
                  <option value="pending">Pending</option>
                  <option value="completed">Completed</option>
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
                className="rounded-lg border border-[var(--border)] bg-white px-4 py-3 text-sm font-semibold text-slate-700"
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
                        {payment.student.user.name || payment.student.user.email}
                      </td>
                      <td className="px-4 py-3">{payment.amount / 100} {payment.currency.toUpperCase()}</td>
                      <td className="px-4 py-3 capitalize">{payment.method}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${
                          payment.status === "completed" ? "bg-green-100 text-green-700" :
                          payment.status === "pending" ? "bg-yellow-100 text-yellow-700" :
                          payment.status === "failed" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-700"
                        }`}>
                          {payment.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">{payment.description ?? "—"}</td>
                      <td className="px-4 py-3">{new Date(payment.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3 flex flex-wrap gap-2">
                        {payment.status !== "completed" && (
                          <button
                            className="rounded-lg border border-green-500 text-green-600 px-2 py-1 text-xs"
                            onClick={() => handleStatusUpdate(payment.id, "completed")}
                          >
                            Complete
                          </button>
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
    </AdminShell>
  );
}
