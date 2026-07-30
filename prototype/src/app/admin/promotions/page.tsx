"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { LEVELS } from "@/lib/levels";

/**
 * Students who finished a level but are still sitting in it.
 *
 * The office works this list at the end of every session. Promotion is manual
 * on purpose — an unpaid or struggling student gets held back — so the page
 * reports and the admin decides, rather than moving anyone automatically.
 */

type Candidate = {
  studentId: string;
  name: string;
  email: string;
  studentCode: string | null;
  level: string;
  nextLevel: string | null;
  sessionSlot: string;
  branchName: string | null;
  batch: string | null;
  monthsElapsed: number;
  monthsOverdue: number;
  paymentStatus: "Pending" | "Partial" | "Completed";
  totalPaid: number;
  tuitionFee: number;
  atTopOfLadder: boolean;
};

type Branch = { id: string; name: string };

const PAYMENT_TONE: Record<string, string> = {
  Completed: "bg-emerald-100 text-emerald-700",
  Partial: "bg-amber-100 text-amber-700",
  Pending: "bg-red-100 text-red-700",
};

function toCsv(rows: Candidate[]): string {
  const header = [
    "Student ID", "Name", "Email", "Branch", "Current level", "Next level",
    "Session", "Batch", "Months elapsed", "Months overdue", "Payment", "Paid", "Tuition",
  ];

  // Quote every field and double any inner quote — names and branches can
  // contain commas, and an unquoted CSV silently shifts every later column.
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

  const lines = rows.map((r) => [
    r.studentCode, r.name, r.email, r.branchName, r.level, r.nextLevel ?? "top of ladder",
    r.sessionSlot, r.batch, r.monthsElapsed, r.monthsOverdue, r.paymentStatus, r.totalPaid, r.tuitionFee,
  ].map(escape).join(","));

  return [header.map(escape).join(","), ...lines].join("\n");
}

export default function AdminPromotionsPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [level, setLevel] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [promoting, setPromoting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/branches", { cache: "no-store" });
        const data = await res.json();
        setBranches(data.branches ?? []);
      } catch {
        /* The filter just stays empty; the list still loads. */
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (branchId) params.set("branchId", branchId);
      if (level) params.set("level", level);

      const res = await fetch(`/api/admin/promotions?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Unable to load the list");

      const data = await res.json();
      setCandidates(data.candidates ?? []);
      // Stale ticks must not survive a reload, or a later promote would move
      // students the admin can no longer see.
      setSelected({});
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [branchId, level]);

  useEffect(() => { load(); }, [load]);

  const promotable = candidates.filter((c) => !c.atTopOfLadder);
  const selectedIds = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);

  async function promote() {
    if (selectedIds.length === 0) return;
    setPromoting(true);
    setNotice("");
    try {
      const res = await fetch("/api/admin/promotions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ studentIds: selectedIds }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not move these students");

      const result = await res.json();
      const skipped = result.skipped?.length ?? 0;
      setNotice(
        `Moved ${result.promoted.length} student${result.promoted.length === 1 ? "" : "s"} up a level` +
        (skipped > 0 ? `. ${skipped} skipped.` : "."),
      );
      setError("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not move these students");
    } finally {
      setPromoting(false);
    }
  }

  function download() {
    const blob = new Blob([toCsv(candidates)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `students-not-moved-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AdminShell>
      <div className="p-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Class promotions</h1>
          <p className="mt-1 text-sm text-slate-500">
            Students whose session has finished but who are still on the same level. Check the
            payment column before moving anyone — an unpaid student is usually held back.
          </p>
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-3">
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="rounded-lg border px-3 py-2 text-sm">
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select value={level} onChange={(e) => setLevel(e.target.value)} className="rounded-lg border px-3 py-2 text-sm">
            <option value="">All levels</option>
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>

          <button
            onClick={download}
            disabled={candidates.length === 0}
            className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
          >
            Export CSV
          </button>

          <button
            onClick={promote}
            disabled={promoting || selectedIds.length === 0}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {promoting ? "Moving…" : `Move ${selectedIds.length || ""} up a level`}
          </button>
        </div>

        {error && <div className="mb-4 rounded bg-red-100 p-4 text-red-700">{error}</div>}
        {notice && <div className="mb-4 rounded bg-emerald-100 p-4 text-emerald-800">{notice}</div>}

        {loading ? (
          <div className="py-12 text-center text-slate-500">Loading…</div>
        ) : candidates.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-3xl">✅</p>
            <p className="mt-2 font-semibold">Everyone is in the right class</p>
            <p className="mt-1 text-sm text-slate-500">
              No student has a finished session and an unchanged level.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-white">
            <table className="w-full">
              <thead className="border-b bg-slate-50 text-left text-sm">
                <tr>
                  <th className="px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label="Select every student that can be moved"
                      checked={promotable.length > 0 && selectedIds.length === promotable.length}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? Object.fromEntries(promotable.map((c) => [c.studentId, true]))
                            : {},
                        )
                      }
                    />
                  </th>
                  <th className="px-4 py-3 font-semibold">Student</th>
                  <th className="px-4 py-3 font-semibold">Branch</th>
                  <th className="px-4 py-3 font-semibold">Move</th>
                  <th className="px-4 py-3 font-semibold">Session</th>
                  <th className="px-4 py-3 font-semibold">Overdue</th>
                  <th className="px-4 py-3 font-semibold">Payment</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c.studentId} className="border-b text-sm hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${c.name}`}
                        disabled={c.atTopOfLadder}
                        checked={Boolean(selected[c.studentId])}
                        onChange={(e) => setSelected({ ...selected, [c.studentId]: e.target.checked })}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold">{c.name}</p>
                      <p className="text-xs text-slate-500">
                        {c.studentCode && <span className="font-mono">{c.studentCode} · </span>}
                        {c.email}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{c.branchName ?? "—"}</td>
                    <td className="px-4 py-3">
                      {c.atTopOfLadder ? (
                        <span className="text-xs text-slate-500">{c.level} · top of ladder</span>
                      ) : (
                        <span className="font-medium">{c.level} → {c.nextLevel}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 capitalize text-slate-600">{c.sessionSlot}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {c.monthsOverdue === 0
                        ? "just finished"
                        : `${c.monthsOverdue} month${c.monthsOverdue === 1 ? "" : "s"}`}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${PAYMENT_TONE[c.paymentStatus]}`}>
                        {c.paymentStatus}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
