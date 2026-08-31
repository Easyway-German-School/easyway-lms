"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/AdminShell";
import { LEVELS } from "@/lib/levels";
import { MONTH_NAMES } from "@/lib/batch";
import { CheckCircleIcon } from "@/components/icons";

/**
 * Batch & level completions — a read-only roll-call.
 *
 * Every student in a cohort lands in exactly one bucket, all of it derived.
 * This page classifies and exports; it does NOT sign anyone off or move anyone
 * up — those stay on /admin/journey and /admin/promotions so there is one place
 * each state actually changes. The links at the top go there.
 */

type Bucket =
  | "neverStarted"
  | "heldBack"
  | "promoted"
  | "levelCompleted"
  | "awaitingSignoff"
  | "inProgress";

type Row = {
  studentId: string;
  name: string;
  email: string;
  studentCode: string | null;
  level: string;
  batch: string | null;
  sessionSlot: string;
  branchName: string | null;
  classesStartedAt: string | null;
  percent: number | null;
  daysElapsed: number | null;
  levelCompletedFor: string | null;
  heldBackReason: string | null;
  paymentStatus: string;
  outstanding: number;
  bucket: Bucket;
  courseworkAverage: number | null;
  courseworkGrade: string | null;
  belowPassMark: boolean;
  marksOwed: number;
  examsPassed: number;
  examsTaken: number;
  attendancePercent: number | null;
};

type Payload = {
  passMark: number;
  buckets: Record<Bucket, number>;
  summary: { total: number; finished: number; belowPassMark: number; marksIncomplete: number; owing: number };
  students: Row[];
};

type Branch = { id: string; name: string };

const BUCKET_LABEL: Record<Bucket, string> = {
  neverStarted: "Never started",
  heldBack: "Held back",
  promoted: "Moved up",
  levelCompleted: "Level completed",
  awaitingSignoff: "Awaiting sign-off",
  inProgress: "In progress",
};

const BUCKET_TONE: Record<Bucket, string> = {
  neverStarted: "bg-slate-100 text-slate-700",
  heldBack: "bg-red-100 text-red-700",
  promoted: "bg-emerald-100 text-emerald-700",
  levelCompleted: "bg-sky-100 text-sky-700",
  awaitingSignoff: "bg-amber-100 text-amber-800",
  inProgress: "bg-[var(--surface-alt)] text-[var(--foreground-soft)]",
};

const PAYMENT_TONE: Record<string, string> = {
  Completed: "bg-emerald-100 text-emerald-700",
  Partial: "bg-amber-100 text-amber-700",
  Pending: "bg-red-100 text-red-700",
};

function toCsv(rows: Row[]): string {
  const header = [
    "Student ID", "Name", "Email", "Branch", "Level", "Batch", "Sitting", "Status",
    "Coursework avg", "Grade", "Below pass mark", "Marks owed", "Exams passed", "Exams taken",
    "Attendance %", "Payment", "Outstanding",
  ];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((r) => [
    r.studentCode, r.name, r.email, r.branchName, r.level, r.batch, r.sessionSlot, BUCKET_LABEL[r.bucket],
    r.courseworkAverage ?? "", r.courseworkGrade ?? "", r.belowPassMark ? "yes" : "no", r.marksOwed,
    r.examsPassed, r.examsTaken, r.attendancePercent ?? "", r.paymentStatus, r.outstanding,
  ].map(esc).join(","));
  return [header.map(esc).join(","), ...lines].join("\n");
}

export default function AdminCompletionsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [level, setLevel] = useState("");
  const [batch, setBatch] = useState("");
  const [sessionSlot, setSessionSlot] = useState("");
  const [bucketFilter, setBucketFilter] = useState<Bucket | "">("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/branches", { cache: "no-store" });
        const json = await res.json();
        setBranches(json.branches ?? []);
      } catch {
        /* filter just stays empty */
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (branchId) params.set("branchId", branchId);
      if (level) params.set("level", level);
      if (batch) params.set("batch", batch);
      if (sessionSlot) params.set("sessionSlot", sessionSlot);
      const res = await fetch(`/api/admin/completions?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Unable to load completions");
      setData(await res.json());
      setSelected({});
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [branchId, level, batch, sessionSlot]);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(
    () => (data?.students ?? []).filter((r) => !bucketFilter || r.bucket === bucketFilter),
    [data, bucketFilter],
  );
  const selectedIds = Object.keys(selected).filter((id) => selected[id]);

  function downloadCsv() {
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `completions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function printSheets() {
    const ids = selectedIds.length ? selectedIds : rows.map((r) => r.studentId);
    if (ids.length === 0) return;
    window.open(`/admin/completions/sheets?ids=${ids.join(",")}`, "_blank");
  }

  return (
    <AdminShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Batch &amp; level completions</h1>
          <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">
            Every student in a cohort, sorted into where they are on the finish line — plus whether their
            marks and attendance are actually complete. This page reports; it does not change anyone&apos;s
            level. Use{" "}
            <Link href="/admin/journey" className="underline">Cohort sign-off</Link> to mark a batch finished
            and <Link href="/admin/promotions" className="underline">Promotions</Link> to move students up.
          </p>
        </div>

        <div className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm">
            <span className="mb-1 block font-semibold text-[var(--muted)]">Branch</span>
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm">
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-semibold text-[var(--muted)]">Level</span>
            <select value={level} onChange={(e) => setLevel(e.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm">
              <option value="">All levels</option>
              {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-semibold text-[var(--muted)]">Batch month</span>
            <select value={batch} onChange={(e) => setBatch(e.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm">
              <option value="">All batches</option>
              {MONTH_NAMES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-semibold text-[var(--muted)]">Sitting</span>
            <select value={sessionSlot} onChange={(e) => setSessionSlot(e.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm">
              <option value="">All sittings</option>
              <option value="morning">Morning</option>
              <option value="afternoon">Afternoon</option>
              <option value="evening">Evening</option>
            </select>
          </label>
        </div>

        {error ? <div className="rounded-xl bg-red-100 p-4 text-sm text-red-700">{error}</div> : null}

        {data ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setBucketFilter("")}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${bucketFilter === "" ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--border)]"}`}
            >
              All · {data.summary.total}
            </button>
            {(Object.keys(BUCKET_LABEL) as Bucket[]).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBucketFilter((current) => (current === b ? "" : b))}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${bucketFilter === b ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--border)]"}`}
              >
                {BUCKET_LABEL[b]} · {data.buckets[b]}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button onClick={downloadCsv} disabled={rows.length === 0} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-[var(--surface-alt)] disabled:opacity-50">
            Export CSV
          </button>
          <button onClick={printSheets} disabled={rows.length === 0} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-[var(--surface-alt)] disabled:opacity-50">
            Print {selectedIds.length ? `${selectedIds.length} ` : "all "}result sheet{selectedIds.length === 1 ? "" : "s"}
          </button>
          {data ? (
            <span className="text-xs text-[var(--muted)]">
              {data.summary.belowPassMark} below pass mark · {data.summary.marksIncomplete} with unmarked skills · {data.summary.owing} owing fees
            </span>
          ) : null}
        </div>

        {loading ? (
          <div className="py-12 text-center text-[var(--muted)]">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center">
            <CheckCircleIcon className="mx-auto h-9 w-9 text-emerald-500" />
            <p className="mt-2 font-semibold">Nobody matches these filters</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-[var(--surface)]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-sm">
                <thead className="border-b bg-[var(--surface-alt)] text-xs uppercase tracking-wide text-[var(--muted)]">
                  <tr>
                    <th className="px-3 py-3 w-8" />
                    <th className="px-3 py-3">Student</th>
                    <th className="px-3 py-3">Level</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Coursework</th>
                    <th className="px-3 py-3">Exams</th>
                    <th className="px-3 py-3">Attendance</th>
                    <th className="px-3 py-3">Fees</th>
                    <th className="px-3 py-3">Sheet</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.studentId} className="border-b hover:bg-[var(--surface-alt)]">
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          aria-label={`Select ${r.name}`}
                          checked={Boolean(selected[r.studentId])}
                          onChange={(e) => setSelected((s) => ({ ...s, [r.studentId]: e.target.checked }))}
                        />
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-semibold">{r.name}</p>
                        <p className="text-xs text-[var(--muted)]">
                          {r.studentCode && <span className="font-mono">{r.studentCode} · </span>}
                          {r.branchName ?? "no branch"} · {r.batch ?? "no batch"}
                        </p>
                      </td>
                      <td className="px-3 py-3 font-semibold">{r.level}</td>
                      <td className="px-3 py-3">
                        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${BUCKET_TONE[r.bucket]}`}>
                          {BUCKET_LABEL[r.bucket]}
                        </span>
                        {r.bucket === "heldBack" && r.heldBackReason ? (
                          <p className="mt-1 text-xs text-red-600">{r.heldBackReason}</p>
                        ) : null}
                      </td>
                      <td className="px-3 py-3">
                        {r.courseworkAverage === null ? (
                          <span className="text-[var(--muted)]">not marked</span>
                        ) : (
                          <span className={r.belowPassMark ? "font-semibold text-red-600" : ""}>
                            {r.courseworkAverage} ({r.courseworkGrade})
                          </span>
                        )}
                        {r.marksOwed > 0 ? (
                          <p className="text-xs text-amber-700">{r.marksOwed} skill{r.marksOwed === 1 ? "" : "s"} owed</p>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-[var(--muted)]">
                        {r.examsTaken === 0 ? "—" : `${r.examsPassed}/${r.examsTaken}`}
                      </td>
                      <td className="px-3 py-3 text-[var(--muted)]">
                        {r.attendancePercent === null ? "—" : `${r.attendancePercent}%`}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${PAYMENT_TONE[r.paymentStatus] ?? "bg-[var(--surface-alt)] text-[var(--foreground-soft)]"}`}>
                          {r.paymentStatus}
                        </span>
                        {r.outstanding > 0 ? (
                          <p className="mt-1 text-xs text-red-600">₦{r.outstanding.toLocaleString()} open</p>
                        ) : null}
                      </td>
                      <td className="px-3 py-3">
                        <Link href={`/admin/students/${r.studentId}/sheet`} className="text-xs font-semibold text-[var(--accent)] underline">
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
