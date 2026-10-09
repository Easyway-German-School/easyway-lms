"use client";

import { Fragment, Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import { LEVELS, nextLevelAfter } from "@/lib/levels";
import { paymentLevelsForStudent } from "@/lib/payment-level";

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

type EnrolmentChip = {
  id: string;
  level: string;
  batchMonth: string | null;
  batchYear: number | null;
  outcome: string;
};

type PaymentRecord = {
  id: string;
  studentId?: string;
  amount: number;
  currency: string;
  status: string;
  method: string;
  description?: string | null;
  level?: string | null;
  student: {
    classType?: string;
    level?: string;
    studentCode?: string | null;
    user: { name?: string | null; email: string };
    enrolments?: EnrolmentChip[];
  };
  invoice?: { id: string } | null;
  createdAt: string;
};

type LedgerLineSnapshot = {
  level: string;
  amount: number;
  allocated: number;
  outstanding: number;
  settled: boolean;
};

type PaymentStudentCard = {
  id: string;
  studentCode: string | null;
  name: string;
  email: string;
  level: string;
  classType: string;
  pathway: string;
  status: string;
  currentBatchMonth: string | null;
  nextLevel: string | null;
  nextLevelFee: number;
  returning: boolean;
  enrolments: Array<EnrolmentChip & { feeSnapshot: number | null; branchName: string | null }>;
  paid: number;
  owed: number;
  lines: LedgerLineSnapshot[];
  suggested: {
    current: { level: string; outstanding: number; batchLabel: string } | null;
    next: { level: string; fee: number; batchHint: string } | null;
  };
};

function batchLabel(month?: string | null, year?: number | null) {
  const m = String(month ?? "").trim();
  if (!m) return "";
  return year ? `${m} ${year}` : m;
}

function enrolmentCaption(entry: Pick<EnrolmentChip, "level" | "batchMonth" | "batchYear">) {
  const batch = batchLabel(entry.batchMonth, entry.batchYear);
  return batch ? `${entry.level} · ${batch}` : entry.level;
}

function PaymentsLedger() {
  const params = useSearchParams();
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [studentId, setStudentId] = useState("");
  const [picked, setPicked] = useState<PaymentStudentCard | null>(null);
  const [studentQuery, setStudentQuery] = useState("");
  const [studentMatches, setStudentMatches] = useState<PaymentStudentCard[]>([]);
  const [searchingStudents, setSearchingStudents] = useState(false);
  const [amount, setAmount] = useState(0);
  const [currency, setCurrency] = useState("ngn");
  const [method, setMethod] = useState("bank_transfer");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("pending");
  const [paymentLevel, setPaymentLevel] = useState("");
  const [forNextLevel, setForNextLevel] = useState(false);
  const [formError, setFormError] = useState("");
  const [formNotice, setFormNotice] = useState("");
  const [noticeGood, setNoticeGood] = useState(false);
  const [formBusy, setFormBusy] = useState(false);
  const [editPayment, setEditPayment] = useState<PaymentRecord | null>(null);
  const [rowBusy, setRowBusy] = useState("");
  const [expandedRow, setExpandedRow] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>(params.get("status") ?? "");
  const [filterMethod, setFilterMethod] = useState<string>(params.get("method") ?? "");
  const [filterClassType, setFilterClassType] = useState<string>(params.get("classType") ?? "");
  const [filterLevel, setFilterLevel] = useState<string>(params.get("level") ?? "");
  const [search, setSearch] = useState<string>(params.get("search") ?? "");
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [totalCount, setTotalCount] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  async function loadPaymentsList() {
    try {
      setLoading(true);
      const url = new URL("/api/admin/payments-list", window.location.origin);
      if (filterStatus) url.searchParams.set("status", filterStatus);
      if (filterMethod) url.searchParams.set("method", filterMethod);
      if (filterClassType) url.searchParams.set("classType", filterClassType);
      if (filterLevel) url.searchParams.set("level", filterLevel);
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

  useEffect(() => {
    loadPaymentsList();
  }, [filterStatus, filterMethod, filterClassType, filterLevel, search, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [filterStatus, filterMethod, filterClassType, filterLevel, search, pageSize]);

  useEffect(() => {
    if (!showForm) return;
    const query = studentQuery.trim();
    if (picked || query.length < 2) {
      setStudentMatches([]);
      setSearchingStudents(false);
      return;
    }
    let cancelled = false;
    setSearchingStudents(true);
    const timer = window.setTimeout(async () => {
      try {
        const url = new URL("/api/admin/payments/students", window.location.origin);
        url.searchParams.set("q", query);
        const res = await fetch(url.toString(), { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setStudentMatches(data.students ?? []);
      } catch {
        if (!cancelled) setStudentMatches([]);
      } finally {
        if (!cancelled) setSearchingStudents(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [studentQuery, showForm, picked]);

  async function loadStudentCard(id: string): Promise<PaymentStudentCard | null> {
    const url = new URL("/api/admin/payments/students", window.location.origin);
    url.searchParams.set("id", id);
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.students ?? [])[0] ?? null;
  }

  function resetFormFields() {
    setStudentId("");
    setPicked(null);
    setStudentQuery("");
    setStudentMatches([]);
    setAmount(0);
    setCurrency("ngn");
    setMethod("bank_transfer");
    setDescription("");
    setStatus("pending");
    setPaymentLevel("");
    setForNextLevel(false);
  }

  function applyStudent(card: PaymentStudentCard, prefill?: { amount?: number; description?: string; status?: string; method?: string; level?: string; forNextLevel?: boolean }) {
    setPicked(card);
    setStudentId(card.id);
    setStudentQuery("");
    setStudentMatches([]);
    setPaymentLevel(prefill?.level ?? card.level);
    setForNextLevel(Boolean(prefill?.forNextLevel));
    if (prefill?.amount !== undefined) setAmount(prefill.amount);
    if (prefill?.description !== undefined) setDescription(prefill.description);
    if (prefill?.status !== undefined) setStatus(prefill.status);
    if (prefill?.method !== undefined) setMethod(prefill.method);
    setFormError("");
  }

  async function openPaymentForm(
    student: { id: string; user: { name?: string | null; email: string } },
    prefill?: { amount?: number; description?: string; status?: string; method?: string; level?: string; forNextLevel?: boolean },
  ) {
    setShowForm(true);
    setFormError("");
    setFormNotice("");
    const card = await loadStudentCard(student.id);
    if (card) {
      if (prefill?.forNextLevel) recordNextLevel(card);
      else if (prefill?.level === card.level && prefill.amount === undefined) recordCurrentLevel(card);
      else applyStudent(card, prefill);
      return;
    }
    setStudentId(student.id);
    setStudentQuery(student.user.name || student.user.email);
    if (prefill?.amount !== undefined) setAmount(prefill.amount);
    if (prefill?.description !== undefined) setDescription(prefill.description);
    if (prefill?.status !== undefined) setStatus(prefill.status);
    if (prefill?.method !== undefined) setMethod(prefill.method);
    if (prefill?.level) setPaymentLevel(prefill.level);
    setForNextLevel(Boolean(prefill?.forNextLevel));
  }

  function recordCurrentLevel(card: PaymentStudentCard) {
    const outstanding = card.suggested.current?.outstanding ?? card.owed;
    const batch = card.suggested.current?.batchLabel || batchLabel(card.currentBatchMonth, null);
    applyStudent(card, {
      amount: outstanding > 0 ? outstanding : 0,
      description: batch ? `${card.level} tuition — ${batch}` : `${card.level} tuition`,
      status: "completed",
      method: "bank_transfer",
      level: card.level,
      forNextLevel: false,
    });
  }

  function recordNextLevel(card: PaymentStudentCard) {
    if (!card.suggested.next) return;
    const next = card.suggested.next;
    applyStudent(card, {
      amount: next.fee,
      description: `${next.level} tuition — next level (${next.batchHint} intake)`,
      status: "completed",
      method: "bank_transfer",
      level: next.level,
      forNextLevel: true,
    });
  }

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

  async function savePaymentEdit(fields: { amount: number; status: string; method: string; description: string; level: string }) {
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
          level: fields.level.trim() || null,
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
          level: paymentLevel || null,
          forNextLevel,
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

      resetFormFields();
      setShowForm(false);
      setLoading(true);
      await loadPaymentsList();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to create payment");
    } finally {
      setFormBusy(false);
    }
  }

  function toggleForm() {
    setShowForm((current) => {
      const next = !current;
      if (next) {
        if (search.trim().length >= 2 && !studentId) setStudentQuery(search.trim());
        window.setTimeout(() => searchInputRef.current?.focus(), 50);
      } else {
        resetFormFields();
      }
      return next;
    });
  }

  return (
    <AdminShell>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Admin</p>
            <h1 className="text-3xl font-bold">Payments</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Search any student — August batch, October batch, next level — and keep every level they have paid for on record.
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white"
            onClick={toggleForm}
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
              placeholder="Student name, email, or code"
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
            <label htmlFor="levelFilter" className="block text-sm font-semibold text-[var(--muted)]">Level</label>
            <select
              id="levelFilter"
              value={filterLevel}
              onChange={(event) => setFilterLevel(event.target.value)}
              className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            >
              <option value="">All levels</option>
              {LEVELS.map((level) => (
                <option key={level} value={level}>{level}</option>
              ))}
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
            <div className="space-y-2">
              <label htmlFor="studentSearch" className="block text-sm font-semibold text-[var(--muted)]">Student</label>
              {picked ? (
                <StudentBillingCard
                  card={picked}
                  onClear={() => {
                    resetFormFields();
                    window.setTimeout(() => searchInputRef.current?.focus(), 50);
                  }}
                  onRecordCurrent={() => recordCurrentLevel(picked)}
                  onRecordNext={() => recordNextLevel(picked)}
                />
              ) : (
                <>
                  <input
                    ref={searchInputRef}
                    id="studentSearch"
                    value={studentQuery}
                    onChange={(event) => setStudentQuery(event.target.value)}
                    placeholder="Type a name, email, or student code — any batch"
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                    autoComplete="off"
                  />
                  {searchingStudents ? <p className="text-xs text-[var(--muted)]">Searching every batch…</p> : null}
                  {!searchingStudents && studentQuery.trim().length >= 2 && studentMatches.length === 0 ? (
                    <p className="text-xs text-[var(--muted)]">No student matches “{studentQuery.trim()}”.</p>
                  ) : null}
                  {studentMatches.length ? (
                    <div className="max-h-72 space-y-1 overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--background)] p-1">
                      {studentMatches.map((match) => {
                        const previous = match.enrolments.filter((entry) => entry.outcome !== "ongoing");
                        return (
                          <button
                            key={match.id}
                            type="button"
                            onClick={() => applyStudent(match)}
                            className="flex w-full flex-col gap-1 rounded-xl px-3 py-2.5 text-left hover:bg-[var(--accent-soft)]"
                          >
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold">{match.name}</span>
                              <LevelBadge level={match.level} current />
                              {match.returning ? (
                                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-800">
                                  Returning
                                </span>
                              ) : null}
                            </span>
                            <span className="text-xs text-[var(--muted)]">
                              {match.studentCode || match.email}
                              {match.currentBatchMonth ? ` · ${match.currentBatchMonth} batch` : ""}
                              {match.owed > 0 ? ` · ${naira(match.owed)} outstanding` : ""}
                            </span>
                            {previous.length ? (
                              <span className="flex flex-wrap gap-1">
                                {previous.map((entry) => (
                                  <span
                                    key={entry.id}
                                    className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] font-semibold text-[var(--muted)]"
                                  >
                                    {enrolmentCaption(entry)}
                                  </span>
                                ))}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </>
              )}
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
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
                <span className="font-semibold text-[var(--muted)]">Level this payment is for</span>
                <select
                  value={paymentLevel}
                  onChange={(event) => {
                    setPaymentLevel(event.target.value);
                    setForNextLevel(Boolean(picked?.nextLevel && event.target.value === picked.nextLevel));
                  }}
                  disabled={!picked}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                >
                  {!picked ? <option value="">Select a student first</option> : null}
                  {picked
                    ? paymentLevelsForStudent(picked.level).map((level) => (
                        <option key={level} value={level}>
                          {level}{level === picked.level ? " (current)" : level === picked.nextLevel ? " (next level)" : ""}
                        </option>
                      ))
                    : null}
                </select>
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
                  placeholder="e.g. A2 tuition — October 2026"
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
            {forNextLevel ? (
              <p className="mt-3 text-xs text-[var(--muted)]">
                This will be stored as {paymentLevel || "next-level"} tuition. If their current level is already signed off, they move up; otherwise the money is on file for when they do.
              </p>
            ) : null}
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={handleCreatePayment}
                disabled={formBusy}
                className="rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {formBusy ? "Saving…" : forNextLevel ? `Save ${paymentLevel || "next-level"} payment` : "Save payment"}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); resetFormFields(); }}
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
                  <th className="px-4 py-3">Level</th>
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
                    <td colSpan={8} className="px-4 py-6 text-center text-sm text-[var(--muted)]">Loading payments…</td>
                  </tr>
                ) : payments.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-sm text-[var(--muted)]">No payments recorded yet.</td>
                  </tr>
                ) : (
                  payments.map((payment) => {
                    const currentLevel = payment.student.level;
                    // Never fall back to the student's CURRENT level — that is
                    // how an A1 August payment showed as A2 after they moved.
                    const thisLevel = payment.status === "not_paid" ? currentLevel : payment.level || null;
                    const previous = (payment.student.enrolments ?? []).filter(
                      (entry) => entry.outcome !== "ongoing" && entry.level !== thisLevel,
                    );
                    const next = currentLevel ? nextLevelAfter(currentLevel) : null;
                    const open = expandedRow === payment.id;
                    return (
                      <Fragment key={payment.id}>
                        <tr>
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-1">
                              <button
                                type="button"
                                className="text-left font-semibold hover:text-[var(--accent)]"
                                onClick={() => payment.studentId && void openPaymentForm({ id: payment.studentId, user: payment.student.user })}
                                title="Record another payment for this student"
                              >
                                {payment.student.user.name || payment.student.user.email}
                              </button>
                              <div className="flex flex-wrap items-center gap-1">
                                {currentLevel ? <LevelBadge level={currentLevel} current /> : null}
                                {payment.student.classType === "private" ? (
                                  <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800" title="Private membership">
                                    Private
                                  </span>
                                ) : null}
                                {previous.slice(0, 3).map((entry) => (
                                  <span
                                    key={entry.id}
                                    className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] font-semibold text-[var(--muted)]"
                                    title="Previous level"
                                  >
                                    {enrolmentCaption(entry)}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-1">
                              <LevelBadge level={thisLevel || "—"} current={Boolean(thisLevel && thisLevel === currentLevel)} />
                              {thisLevel && currentLevel && thisLevel !== currentLevel ? (
                                <span className="text-[10px] text-[var(--muted)]">now {currentLevel}</span>
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
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-2">
                              {payment.studentId ? (
                                <button
                                  type="button"
                                  className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs font-semibold"
                                  onClick={() => setExpandedRow(open ? "" : payment.id)}
                                >
                                  {open ? "Hide levels" : "Levels"}
                                </button>
                              ) : null}
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
                              {payment.studentId && currentLevel && thisLevel && thisLevel !== currentLevel ? (
                                <button
                                  className="rounded-lg border border-[var(--accent)] px-2 py-1 text-xs font-semibold text-[var(--accent)]"
                                  onClick={() =>
                                    openPaymentForm(
                                      { id: payment.studentId!, user: payment.student.user },
                                      { level: currentLevel, status: "completed", method: "bank_transfer" },
                                    )
                                  }
                                >
                                  Record {currentLevel} payment
                                </button>
                              ) : null}
                              {payment.studentId && next && thisLevel === currentLevel ? (
                                <button
                                  className="rounded-lg border border-sky-400 px-2 py-1 text-xs font-semibold text-sky-700"
                                  onClick={() =>
                                    openPaymentForm(
                                      { id: payment.studentId!, user: payment.student.user },
                                      { level: next, forNextLevel: true, status: "completed", method: "bank_transfer" },
                                    )
                                  }
                                >
                                  Record {next} payment
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
                            </div>
                          </td>
                        </tr>
                        {open ? (
                          <tr className="bg-[var(--surface)]">
                            <td colSpan={8} className="px-4 py-4">
                              <LevelHistory
                                currentLevel={currentLevel}
                                enrolments={payment.student.enrolments ?? []}
                                paymentLevel={thisLevel}
                              />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })
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

function LevelBadge({ level, current }: { level: string; current?: boolean }) {
  if (!level || level === "—") return <span className="text-[var(--muted)]">—</span>;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
        current
          ? "bg-[var(--accent)] text-white"
          : "border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground-soft)]"
      }`}
    >
      {level}
    </span>
  );
}

function LevelHistory({
  currentLevel,
  enrolments,
  paymentLevel,
}: {
  currentLevel?: string;
  enrolments: EnrolmentChip[];
  paymentLevel?: string | null;
}) {
  const rows = enrolments.length
    ? enrolments
    : currentLevel
      ? [{ id: "current", level: currentLevel, batchMonth: null, batchYear: null, outcome: "ongoing" }]
      : [];
  if (!rows.length) {
    return <p className="text-sm text-[var(--muted)]">No level history stored for this student yet.</p>;
  }
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">Level history</p>
      <div className="mt-2 overflow-x-auto">
        <table className="min-w-[28rem] text-left text-sm">
          <thead className="text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">
            <tr>
              <th className="py-1 pr-4">Level</th>
              <th className="py-1 pr-4">Batch</th>
              <th className="py-1 pr-4">Status</th>
              <th className="py-1">This payment</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => (
              <tr key={entry.id} className="border-t border-[var(--border)]">
                <td className="py-2 pr-4">
                  <LevelBadge level={entry.level} current={entry.outcome === "ongoing"} />
                </td>
                <td className="py-2 pr-4 text-[var(--muted)]">{batchLabel(entry.batchMonth, entry.batchYear) || "—"}</td>
                <td className="py-2 pr-4 capitalize text-[var(--muted)]">{entry.outcome}</td>
                <td className="py-2">
                  {paymentLevel && paymentLevel === entry.level ? (
                    <span className="text-xs font-semibold text-[var(--accent)]">Recorded here</span>
                  ) : (
                    <span className="text-[var(--muted)]">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StudentBillingCard({
  card,
  onClear,
  onRecordCurrent,
  onRecordNext,
}: {
  card: PaymentStudentCard;
  onClear: () => void;
  onRecordCurrent: () => void;
  onRecordNext: () => void;
}) {
  const previous = card.enrolments.filter((entry) => entry.outcome !== "ongoing");
  const currentBatch = batchLabel(
    card.enrolments.find((entry) => entry.outcome === "ongoing")?.batchMonth ?? card.currentBatchMonth,
    card.enrolments.find((entry) => entry.outcome === "ongoing")?.batchYear ?? null,
  );

  return (
    <div className="rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent-soft)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-base font-bold">{card.name}</p>
          <p className="text-xs text-[var(--muted)]">
            {card.studentCode || card.email}
            {card.classType === "private" ? " · Private" : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold"
        >
          Change student
        </button>
      </div>

      {card.returning ? (
        <p className="mt-3 rounded-xl bg-[var(--surface)] px-3 py-2 text-xs text-[var(--foreground-soft)]">
          Returning student
          {previous[0] ? ` — completed ${enrolmentCaption(previous[previous.length - 1])} before` : ""}.
          Now in {card.level}
          {currentBatch ? ` · ${currentBatch}` : ""}.
        </p>
      ) : (
        <p className="mt-3 text-xs text-[var(--muted)]">
          Currently {card.level}
          {currentBatch ? ` · ${currentBatch} batch` : ""}.
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-1">
        {card.enrolments.length ? (
          card.enrolments.map((entry) => (
            <span
              key={entry.id}
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                entry.outcome === "ongoing"
                  ? "bg-[var(--accent)] text-white"
                  : "border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]"
              }`}
            >
              {enrolmentCaption(entry)}
            </span>
          ))
        ) : (
          <LevelBadge level={card.level} current />
        )}
      </div>

      {card.lines.length ? (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="uppercase tracking-[0.14em] text-[var(--muted)]">
              <tr>
                <th className="py-1 pr-3">Level</th>
                <th className="py-1 pr-3">Charged</th>
                <th className="py-1 pr-3">Paid</th>
                <th className="py-1">Left</th>
              </tr>
            </thead>
            <tbody>
              {card.lines.map((line) => (
                <tr key={line.level} className="border-t border-[var(--border)]/60">
                  <td className="py-1.5 pr-3 font-semibold">{line.level}</td>
                  <td className="py-1.5 pr-3">{naira(line.amount)}</td>
                  <td className="py-1.5 pr-3">{naira(line.allocated)}</td>
                  <td className="py-1.5 font-semibold">{line.settled ? "Settled" : naira(line.outstanding)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {card.suggested.current ? (
          <button
            type="button"
            onClick={onRecordCurrent}
            className="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white"
          >
            Record {card.suggested.current.level} payment
            {card.suggested.current.outstanding > 0 ? ` · ${naira(card.suggested.current.outstanding)} left` : ""}
          </button>
        ) : (
          <button
            type="button"
            onClick={onRecordCurrent}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold"
          >
            Record {card.level} payment
          </button>
        )}
        {card.suggested.next ? (
          <button
            type="button"
            onClick={onRecordNext}
            className="rounded-lg border border-sky-400 bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-sky-800"
          >
            Record {card.suggested.next.level} (next level) · {naira(card.suggested.next.fee)}
          </button>
        ) : null}
      </div>
    </div>
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
  onSave: (fields: { amount: number; status: string; method: string; description: string; level: string }) => void;
}) {
  const [amount, setAmount] = useState(String(payment.amount));
  const [status, setStatus] = useState(payment.status);
  const [method, setMethod] = useState(payment.method);
  const [description, setDescription] = useState(payment.description ?? "");
  const [level, setLevel] = useState(payment.level || "");

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" onClick={() => !busy && onCancel()}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl">
        <h2 className="text-lg font-bold text-[var(--foreground)]">
          Edit payment — {payment.student.user.name || payment.student.user.email}
        </h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Recorded {new Date(payment.createdAt).toLocaleDateString()}. Corrections update every total this
          payment feeds, straight away.
        </p>

        <div className="mt-3">
          <LevelHistory
            currentLevel={payment.student.level}
            enrolments={payment.student.enrolments ?? []}
            paymentLevel={payment.level}
          />
        </div>

        <label className="mt-4 block text-xs font-semibold text-[var(--muted)]">Amount (₦)</label>
        <input
          type="number"
          min={1}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={busy}
          className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
        />

        <label className="mt-3 block text-xs font-semibold text-[var(--muted)]">Level this payment is for</label>
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          disabled={busy}
          className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
        >
          <option value="">Not stamped</option>
          {LEVELS.map((entry) => (
            <option key={entry} value={entry}>{entry}</option>
          ))}
        </select>

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
            onClick={() => onSave({ amount: Number(amount), status, method, description, level })}
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
