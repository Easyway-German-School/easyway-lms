"use client";

export const dynamic = "force-dynamic";

/**
 * The cohort console — where the school says a batch has finished.
 *
 * This page holds the one switch that makes a student's "your level is
 * complete, here is the next one" offer appear. It used to be a date
 * calculation, and the date calculation congratulated students who had never
 * attended a lesson. Now a person who was in the building presses a button.
 *
 * The page carries three facts per student because those are the three that
 * decide whether somebody can actually be signed off:
 *
 *   did they ever start   — a student with no start date never sat the level
 *   how far through       — the real clock, from their real first day
 *   do they still owe     — an unpaid student is usually held back
 *
 * The "never started" block at the top is the part the office has never had:
 * paid students who have not once walked in, and the reason each of them gave.
 * Every one of those is a refund request the branch has not received yet.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { LEVELS } from "@/lib/levels";
import { MONTH_NAMES } from "@/lib/batch";
import { NOT_STARTED_REASONS } from "@/lib/germany-journey";
import { AlertIcon, CheckCircleIcon, FlagIcon, PendingIcon, UsersIcon } from "@/components/icons";

type CohortMember = {
  studentId: string;
  name: string;
  email: string;
  studentCode: string | null;
  level: string;
  batch: string | null;
  sessionSlot: string;
  branchName: string | null;
  classesStartedAt: string | null;
  startConfirmedVia: string | null;
  notStartedCount: number;
  notStartedReason: string | null;
  daysElapsed: number | null;
  percent: number | null;
  levelCompletedFor: string | null;
  paymentStatus: string;
  outstanding: number;
  heldBackAt: string | null;
  heldBackReason: string | null;
};

type Summary = {
  total: number;
  started: number;
  neverStarted: number;
  stalled: number;
  signedOff: number;
  owing: number;
};

type Branch = { id: string; name: string };

const PAYMENT_TONE: Record<string, string> = {
  Completed: "bg-emerald-100 text-emerald-700",
  Partial: "bg-amber-100 text-amber-700",
  Pending: "bg-red-100 text-red-700",
};

const REASON_LABEL = Object.fromEntries(NOT_STARTED_REASONS.map((r) => [r.id, r.label]));

function naira(amount: number): string {
  return `₦${Math.max(0, Math.round(amount)).toLocaleString()}`;
}

export default function AdminJourneyPage() {
  const [cohort, setCohort] = useState<CohortMember[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [level, setLevel] = useState("");
  const [batch, setBatch] = useState("");
  const [sessionSlot, setSessionSlot] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (branchId) params.set("branchId", branchId);
      if (level) params.set("level", level);
      if (batch) params.set("batch", batch);
      if (sessionSlot) params.set("sessionSlot", sessionSlot);

      const res = await fetch(`/api/admin/journey?${params.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Unable to load the cohort");

      setCohort(data.cohort || []);
      setSummary(data.summary || null);
      setSelected({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the cohort");
    } finally {
      setLoading(false);
    }
  }, [branchId, level, batch, sessionSlot]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/branches", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        setBranches(Array.isArray(data.branches) ? data.branches : []);
      } catch {
        // The filter still works without it; branch simply stays "All".
      }
    })();
  }, []);

  const neverStarted = useMemo(() => cohort.filter((row) => !row.classesStartedAt), [cohort]);
  const selectedIds = useMemo(() => Object.keys(selected).filter((id) => selected[id]), [selected]);

  /**
   * Signing off somebody who never started would tell a student who has not
   * attended a day that they finished the level — the exact bug this whole
   * feature replaced. So they can still be selected (the office may know
   * better than the register) but the count is put in front of the button.
   */
  const selectedNeverStarted = useMemo(
    () => selectedIds.filter((id) => cohort.find((row) => row.studentId === id && !row.classesStartedAt)).length,
    [selectedIds, cohort],
  );

  const eligible = useMemo(
    () => cohort.filter((row) => row.levelCompletedFor !== row.level && !row.heldBackAt),
    [cohort],
  );

  const [holdBusy, setHoldBusy] = useState<string | null>(null);

  const holdBack = async (studentId: string) => {
    const reason = window.prompt("Why is this student being held back? (shown to other admins, not the student)");
    if (reason === null) return;
    if (!reason.trim()) {
      setError("A reason is required to hold a student back");
      return;
    }
    setHoldBusy(studentId);
    setError(null);
    try {
      const res = await fetch("/api/admin/journey", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, heldBack: true, reason: reason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Unable to hold this student back");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to hold this student back");
    } finally {
      setHoldBusy(null);
    }
  };

  const clearHold = async (studentId: string) => {
    setHoldBusy(studentId);
    setError(null);
    try {
      const res = await fetch("/api/admin/journey", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, heldBack: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Unable to clear this hold");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to clear this hold");
    } finally {
      setHoldBusy(null);
    }
  };

  const signOff = async () => {
    if (selectedIds.length === 0) return;
    setSigning(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/journey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentIds: selectedIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Unable to sign these students off");

      setMessage(
        `${data.completed.length} student${data.completed.length === 1 ? "" : "s"} signed off. ` +
          `They will see their level-complete offer the next time they open the portal.` +
          (data.skipped.length ? ` ${data.skipped.length} skipped.` : ""),
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign these students off");
    } finally {
      setSigning(false);
    }
  };

  const stats = summary
    ? [
        { label: "In this cohort", value: summary.total, icon: <UsersIcon className="h-5 w-5" /> },
        { label: "Have started", value: summary.started, icon: <CheckCircleIcon className="h-5 w-5" /> },
        { label: "Never started", value: summary.neverStarted, icon: <PendingIcon className="h-5 w-5" /> },
        { label: "Stalled", value: summary.stalled, icon: <AlertIcon className="h-5 w-5" /> },
        { label: "Already signed off", value: summary.signedOff, icon: <FlagIcon className="h-5 w-5" /> },
      ]
    : [];

  return (
    <AdminShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Cohort sign-off</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            Marking a batch finished is the only thing that tells a student their level is complete and offers them the
            next one. Nothing here happens on a timer — the school says when a level ended.
          </p>
        </div>

        {/* Filters */}
        <div className="grid gap-3 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm">
            <span className="mb-1 block font-semibold text-[var(--muted)]">Branch</span>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2.5 text-sm"
            >
              <option value="">All branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-semibold text-[var(--muted)]">Level</span>
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2.5 text-sm"
            >
              <option value="">All levels</option>
              {LEVELS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-semibold text-[var(--muted)]">Batch month</span>
            <select
              value={batch}
              onChange={(e) => setBatch(e.target.value)}
              className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2.5 text-sm"
            >
              <option value="">All batches</option>
              {MONTH_NAMES.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-semibold text-[var(--muted)]">Sitting</span>
            <select
              value={sessionSlot}
              onChange={(e) => setSessionSlot(e.target.value)}
              className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2.5 text-sm"
            >
              <option value="">All sittings</option>
              <option value="morning">Morning</option>
              <option value="afternoon">Afternoon</option>
              <option value="evening">Evening</option>
            </select>
          </label>
        </div>

        {stats.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {stats.map((stat) => (
              <div key={stat.label} className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex items-center gap-2 text-[var(--accent-ink)]">{stat.icon}</div>
                <p className="mt-2 text-2xl font-bold text-[var(--foreground)]">{stat.value}</p>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{stat.label}</p>
              </div>
            ))}
          </div>
        ) : null}

        {message ? (
          <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-800">{message}</div>
        ) : null}
        {error ? (
          <div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">{error}</div>
        ) : null}

        {/* The block the office has never had before. */}
        {neverStarted.length > 0 ? (
          <div className="rounded-3xl border border-amber-300 bg-amber-50/70 p-5">
            <div className="flex items-center gap-2 text-amber-900">
              <AlertIcon className="h-5 w-5" />
              <h2 className="font-bold">{neverStarted.length} paid for a seat and never walked in</h2>
            </div>
            <p className="mt-1 text-sm leading-6 text-amber-900/80">
              Each of these has a seat and no first day. The reason is the one they gave the portal — the ones about
              money and class times your branch can fix in a phone call.
            </p>
            <div className="mt-4 space-y-2">
              {neverStarted.slice(0, 12).map((row) => (
                <div
                  key={row.studentId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[var(--surface-soft)] px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-[var(--foreground)]">{row.name}</p>
                    <p className="truncate text-xs text-[var(--muted)]">
                      {row.studentCode || row.email} · {row.level} · {row.branchName || "no branch"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-800">
                      {row.notStartedReason ? REASON_LABEL[row.notStartedReason] ?? row.notStartedReason : "Never answered"}
                    </span>
                    <span className="rounded-full bg-[var(--surface-alt)] px-2.5 py-1 font-semibold text-[var(--foreground-soft)]">
                      asked {row.notStartedCount}×
                    </span>
                    {row.outstanding > 0 ? (
                      <span className="rounded-full bg-red-100 px-2.5 py-1 font-semibold text-red-700">
                        owes {naira(row.outstanding)}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
              {neverStarted.length > 12 ? (
                <p className="text-xs text-amber-900/70">…and {neverStarted.length - 12} more in the table below.</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* The cohort */}
        <div className="overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
            <div>
              <h2 className="font-bold text-[var(--foreground)]">The cohort</h2>
              <p className="text-xs text-[var(--muted)]">
                {loading ? "Loading…" : `${cohort.length} students · ${eligible.length} not yet signed off`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  setSelected(Object.fromEntries(eligible.map((row) => [row.studentId, true])))
                }
                className="rounded-full border border-[var(--border-strong)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--surface-alt)]"
              >
                Select all not signed off
              </button>
              <button
                type="button"
                onClick={() => setSelected({})}
                className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--muted)] hover:bg-[var(--surface-alt)]"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead className="bg-[var(--surface-alt)] text-xs uppercase tracking-wide text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3 w-10" />
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Level</th>
                  <th className="px-4 py-3">Batch</th>
                  <th className="px-4 py-3">Started</th>
                  <th className="px-4 py-3">Through</th>
                  <th className="px-4 py-3">Fees</th>
                  <th className="px-4 py-3">Signed off</th>
                  <th className="px-4 py-3">Hold</th>
                </tr>
              </thead>
              <tbody>
                {cohort.map((row) => {
                  const done = row.levelCompletedFor === row.level;
                  return (
                    <tr key={row.studentId} className="border-t border-[var(--border)]">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={Boolean(selected[row.studentId])}
                          onChange={(e) =>
                            setSelected((current) => ({ ...current, [row.studentId]: e.target.checked }))
                          }
                          className="h-4 w-4 accent-[var(--accent)]"
                          aria-label={`Select ${row.name}`}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-[var(--foreground)]">{row.name}</p>
                        <p className="text-xs text-[var(--muted)]">{row.studentCode || row.email}</p>
                      </td>
                      <td className="px-4 py-3 font-semibold">{row.level}</td>
                      <td className="px-4 py-3 text-[var(--muted)]">{row.batch || "—"}</td>
                      <td className="px-4 py-3">
                        {row.classesStartedAt ? (
                          <>
                            <span className="text-[var(--foreground)]">
                              {new Date(row.classesStartedAt).toLocaleDateString(undefined, {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })}
                            </span>
                            <span className="ml-1 text-xs text-[var(--muted)]">({row.startConfirmedVia})</span>
                          </>
                        ) : (
                          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                            never
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {row.percent === null ? (
                          <span className="text-[var(--muted)]">—</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--border)]">
                              <div
                                className="h-full rounded-full bg-[var(--accent)]"
                                style={{ width: `${Math.min(100, row.percent)}%` }}
                              />
                            </div>
                            <span className="text-xs font-semibold text-[var(--muted)]">
                              day {row.daysElapsed}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                            PAYMENT_TONE[row.paymentStatus] ?? "bg-[var(--surface-alt)] text-[var(--foreground-soft)]"
                          }`}
                        >
                          {row.paymentStatus}
                        </span>
                        {row.outstanding > 0 ? (
                          <p className="mt-1 text-xs text-red-600">{naira(row.outstanding)} open</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        {done ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                            <CheckCircleIcon className="h-3.5 w-3.5" /> {row.levelCompletedFor}
                          </span>
                        ) : row.heldBackAt ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700"
                            title={row.heldBackReason ?? undefined}
                          >
                            <AlertIcon className="h-3.5 w-3.5" /> Held back
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--muted)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {row.heldBackAt ? (
                          <button
                            type="button"
                            onClick={() => clearHold(row.studentId)}
                            disabled={holdBusy === row.studentId}
                            className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--surface-alt)] disabled:opacity-40"
                          >
                            {holdBusy === row.studentId ? "…" : "Clear hold"}
                          </button>
                        ) : !done ? (
                          <button
                            type="button"
                            onClick={() => holdBack(row.studentId)}
                            disabled={holdBusy === row.studentId}
                            className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--muted)] hover:bg-[var(--surface-alt)] disabled:opacity-40"
                          >
                            {holdBusy === row.studentId ? "…" : "Hold back"}
                          </button>
                        ) : (
                          <span className="text-xs text-[var(--muted)]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!loading && cohort.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-[var(--muted)]">
                      No students match these filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        {/* The switch. */}
        <div className="sticky bottom-4 rounded-3xl border-2 border-[var(--accent)] bg-[var(--surface)] p-5 shadow-2xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="font-bold text-[var(--foreground)]">
                {selectedIds.length} selected
              </p>
              <p className="text-sm text-[var(--muted)]">
                Signing off tells each of them their level is complete and offers them the next one.
              </p>
              {selectedNeverStarted > 0 ? (
                <p className="mt-1 text-sm font-semibold text-amber-700">
                  {selectedNeverStarted} of these never recorded a first day. Sign them off only if you know they
                  attended.
                </p>
              ) : null}
            </div>
            <button
              type="button"
              disabled={signing || selectedIds.length === 0}
              onClick={signOff}
              className="rounded-full bg-[var(--accent)] px-7 py-3.5 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-40"
            >
              {signing ? "Signing off…" : "Mark this batch finished"}
            </button>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
