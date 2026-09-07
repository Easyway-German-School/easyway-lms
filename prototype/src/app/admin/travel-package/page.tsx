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
  /** Ledger still carries a per-level charge instead of the flat ₦980,000. */
  ledgerOutOfStep: boolean;
};

type StudentSearchHit = {
  id: string;
  name: string;
  email: string;
  level: string;
  pathway: string | null;
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
  /** id currently being reconciled, so just its row's button spins. */
  const [reconcilingId, setReconcilingId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [showConvert, setShowConvert] = useState(false);
  const [convertQuery, setConvertQuery] = useState("");
  const [convertHits, setConvertHits] = useState<StudentSearchHit[]>([]);
  const [convertSearching, setConvertSearching] = useState(false);

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

  /**
   * Put one student's Travel Package standing straight — sets the pathway (if
   * needed) and collapses their tuition ledger to the one flat ₦980,000 charge.
   * Money already received is untouched. Used both for a row flagged
   * "ledger out of step" and for a student just pulled in via the search below.
   */
  async function reconcile(studentId: string, label: string) {
    setReconcilingId(studentId);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/travel-package", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not reconcile this student");
      const r = data.reconcile as {
        pathwaySet: boolean;
        chargeFixed: boolean;
        chargesRetired: number;
        owed: number;
        wasFullPaidBefore: boolean;
        fullPaidAfter: boolean;
      };
      const parts: string[] = [];
      if (r.pathwaySet) parts.push("moved onto Travel Package");
      if (r.chargeFixed) parts.push("charge set to ₦980,000");
      if (r.chargesRetired > 0) parts.push(`${r.chargesRetired} old level charge${r.chargesRetired > 1 ? "s" : ""} folded away`);
      if (parts.length === 0) parts.push("already correct — nothing to change");
      const tail = r.wasFullPaidBefore && !r.fullPaidAfter
        ? ` Now ${naira(r.owed)} outstanding — the student has been notified it's a part payment.`
        : ` Now ${naira(r.owed)} outstanding.`;
      setNotice(`${label}: ${parts.join(", ")}.${tail}`);
      setConvertHits((hits) => hits.filter((h) => h.id !== studentId));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reconcile this student");
    } finally {
      setReconcilingId(null);
    }
  }

  async function searchStudents(query: string) {
    setConvertQuery(query);
    if (query.trim().length < 2) {
      setConvertHits([]);
      return;
    }
    setConvertSearching(true);
    try {
      const url = new URL("/api/admin/students", window.location.origin);
      url.searchParams.set("search", query.trim());
      url.searchParams.set("pageSize", "8");
      const res = await fetch(url.toString(), { cache: "no-store" });
      const data = await res.json();
      const hits: StudentSearchHit[] = (data.students ?? []).map((s: Record<string, unknown>) => ({
        id: String(s.id),
        name: String((s.user as { name?: string } | undefined)?.name ?? "Unnamed"),
        email: String((s.user as { email?: string } | undefined)?.email ?? ""),
        level: String(s.level ?? ""),
        pathway: (s.pathway as string | null) ?? null,
      }));
      setConvertHits(hits);
    } catch {
      setConvertHits([]);
    } finally {
      setConvertSearching(false);
    }
  }

  async function reconcileAll() {
    setReconcilingId("__all__");
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/travel-package", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not reconcile the roster");
      setNotice(
        `Swept ${data.scanned} Travel Package student${data.scanned === 1 ? "" : "s"} — ` +
          `${data.reconciled} needed fixing` +
          (data.notified > 0 ? `, ${data.notified} told it's now a part payment` : "") +
          (data.failed > 0 ? `. ${data.failed} could not be updated — check the logs.` : "."),
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reconcile the roster");
    } finally {
      setReconcilingId(null);
    }
  }

  const totalCollected = students.reduce((sum, s) => sum + s.paid, 0);
  const totalOutstanding = students.reduce((sum, s) => sum + s.owed, 0);
  const outOfStepCount = students.filter((s) => s.ledgerOutOfStep).length;

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
              <div className="flex flex-col items-stretch gap-2 sm:items-end">
                <Link
                  href="/admin/students?addStudent=1&pathway=Travel%20Package"
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-[#D4AF37] px-5 py-2.5 text-sm font-bold text-[#1c1508] shadow-lg transition hover:brightness-110"
                >
                  <PlusIcon className="h-4 w-4" /> Add a student
                </Link>
                <button
                  type="button"
                  onClick={() => setShowConvert((v) => !v)}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-white/25 px-5 py-2 text-xs font-semibold text-white/80 transition hover:bg-white/10"
                >
                  {showConvert ? "Close" : "Move an existing student here"}
                </button>
              </div>
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

        {notice && (
          <div className="mb-4 flex items-start justify-between gap-3 rounded-2xl bg-emerald-500/10 p-4 text-sm font-medium text-emerald-700">
            <span className="min-w-0">{notice}</span>
            <button type="button" onClick={() => setNotice("")} className="shrink-0 font-semibold">
              Dismiss
            </button>
          </div>
        )}

        {showConvert && (
          <div className="mb-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
            <p className="text-sm font-semibold text-[var(--foreground)]">Move an existing student onto Travel Package</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              For a student who was onboarded on the wrong pathway. This sets them to Travel Package and
              re-prices their tuition ledger to the flat {naira(packagePrice)} — money already received is
              kept as-is. If that turns a &quot;paid in full&quot; account into a balance owing, the student
              is told it&apos;s a part payment.
            </p>
            <input
              type="search"
              value={convertQuery}
              onChange={(e) => void searchStudents(e.target.value)}
              placeholder="Search by name or email…"
              className="mt-3 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            />
            {convertSearching && <p className="mt-2 text-xs text-[var(--muted)]">Searching…</p>}
            {!convertSearching && convertQuery.trim().length >= 2 && convertHits.length === 0 && (
              <p className="mt-2 text-xs text-[var(--muted)]">No students match.</p>
            )}
            {convertHits.length > 0 && (
              <div className="mt-3 space-y-2">
                {convertHits.map((h) => (
                  <div key={h.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--foreground)]">{h.name}</p>
                      <p className="truncate text-xs text-[var(--muted)]">
                        {h.email} · Level {h.level} · {h.pathway ?? "No pathway"}
                      </p>
                    </div>
                    {h.pathway === "Travel Package" ? (
                      <span className="text-[11px] font-semibold text-emerald-600">Already on Travel Package</span>
                    ) : (
                      <button
                        type="button"
                        disabled={reconcilingId === h.id}
                        onClick={() => void reconcile(h.id, h.name)}
                        className="rounded-full bg-[var(--accent)] px-3.5 py-1.5 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50"
                      >
                        {reconcilingId === h.id ? "Converting…" : "Convert"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!loading && outOfStepCount > 0 && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/40 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            <span className="min-w-0">
              {outOfStepCount} student{outOfStepCount === 1 ? "" : "s"} on this pathway {outOfStepCount === 1 ? "is" : "are"} still
              priced on the old per-level ladder. Reconcile {outOfStepCount === 1 ? "it" : "them all"} to the flat {naira(packagePrice)} —
              money received is kept, and anyone who now owes a balance is told it&apos;s a part payment.
            </span>
            <button
              type="button"
              disabled={reconcilingId === "__all__"}
              onClick={() => void reconcileAll()}
              className="shrink-0 rounded-full bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:brightness-110 disabled:opacity-50"
            >
              {reconcilingId === "__all__" ? "Reconciling…" : `Reconcile all ${outOfStepCount}`}
            </button>
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
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {s.ledgerOutOfStep && (
                      <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-600">
                        Ledger out of step
                      </span>
                    )}
                    {!s.ledgerOutOfStep && !s.firstPaymentMet && (
                      <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-600">
                        Below {naira(minFirstPayment)} floor
                      </span>
                    )}
                    {!s.ledgerOutOfStep && s.fullPaid && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-emerald-600">
                        <CheckIcon className="h-3 w-3" /> Paid in full
                      </span>
                    )}
                    {s.ledgerOutOfStep ? (
                      <button
                        type="button"
                        disabled={reconcilingId === s.id}
                        onClick={() => void reconcile(s.id, s.name)}
                        className="rounded-full border border-amber-500/50 bg-amber-500/10 px-3.5 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-500/20 disabled:opacity-50"
                      >
                        {reconcilingId === s.id ? "Reconciling…" : "Reconcile to ₦980,000"}
                      </button>
                    ) : (
                      !s.fullPaid && (
                        <button
                          type="button"
                          onClick={() => setPayModal(s)}
                          className="rounded-full bg-[var(--accent)] px-3.5 py-1.5 text-xs font-semibold text-white hover:brightness-110"
                        >
                          Record payment
                        </button>
                      )
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
