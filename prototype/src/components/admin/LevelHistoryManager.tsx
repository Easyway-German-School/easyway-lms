"use client";

import { useCallback, useEffect, useState } from "react";

type HistoryLevel = {
  level: string;
  status: "paid" | "owing" | "not_taken_here" | "unreviewed" | "no_record";
  chargeAmount: number | null;
  cashPaid: number;
  historicalPaidAmount: number;
  outstanding: number;
  reviewOutstanding: number;
  enrolment: { batchMonth: string | null; batchYear: number | null; outcome: string } | null;
};

type HistoryResponse = { currentLevel: string; levels: HistoryLevel[]; notice?: string };
type Classification = "paid" | "owing" | "not_taken_here";

const choices: Array<{ value: Classification; label: string }> = [
  { value: "paid", label: "Completed here and paid" },
  { value: "owing", label: "Completed here; confirmed owing" },
  { value: "not_taken_here", label: "Joined at this level; not taken here" },
];

function naira(amount: number) {
  return `₦${Math.round(amount).toLocaleString("en-NG")}`;
}

function statusLabel(level: HistoryLevel) {
  if (level.status === "unreviewed") return "Needs review";
  if (level.status === "no_record") return level.enrolment ? "Enrolment on file" : "No record";
  if (level.status === "not_taken_here") return "Not taken here";
  if (level.status === "owing" || level.outstanding > 0) return "Confirmed owing";
  return "Recorded as paid";
}

function selectedValue(level: HistoryLevel): Classification | "" {
  if (level.status === "unreviewed" || level.status === "no_record") return "";
  if (level.status === "not_taken_here") return "not_taken_here";
  if (level.status === "owing" || level.outstanding > 0) return "owing";
  return "paid";
}

export default function LevelHistoryManager({
  studentId,
  currentLevel,
}: {
  studentId: string;
  currentLevel: string;
}) {
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [selection, setSelection] = useState<Record<string, Classification | "">>({});
  const [loading, setLoading] = useState(true);
  const [busyLevel, setBusyLevel] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadHistory = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(
        `/api/admin/payments/history?studentId=${encodeURIComponent(studentId)}`,
        { cache: "no-store" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? `Unable to load history (HTTP ${response.status}).`);
      const data = payload as HistoryResponse;
      setHistory(data);
      setSelection(Object.fromEntries(data.levels.map((level) => [level.level, selectedValue(level)])));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load prior-level history.");
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  async function save(level: HistoryLevel) {
    const classification = selection[level.level];
    if (!classification || busyLevel) return;
    setBusyLevel(level.level);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/payments/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, level: level.level, classification }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? `Unable to save history (HTTP ${response.status}).`);
      setNotice(`${level.level} history saved as ${choices.find((choice) => choice.value === classification)?.label}.`);
      await loadHistory();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save prior-level history.");
    } finally {
      setBusyLevel("");
    }
  }

  return (
    <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em]">Prior-level history review</p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Unreviewed backfill estimates do not count as debt or lock access. Confirm each level only when you know the student&apos;s history.
        </p>
      </div>

      {loading ? <p className="mt-3 text-xs text-[var(--muted)]">Loading prior levels…</p> : null}
      {error ? <p role="alert" className="mt-3 text-xs text-red-600">{error}</p> : null}
      {notice ? <p role="status" className="mt-3 text-xs text-emerald-700">{notice}</p> : null}

      {!loading && history?.levels.length === 0 ? (
        <p className="mt-3 text-xs text-[var(--muted)]">
          {history.notice ?? `${currentLevel} is the first level on the ladder; there are no earlier levels to review.`}
        </p>
      ) : null}

      {history?.levels.map((level) => {
        const amount = level.reviewOutstanding || level.outstanding;
        return (
          <div key={level.level} className="mt-3 grid gap-2 border-t border-[var(--border)] pt-3 sm:grid-cols-[1fr_1.4fr_auto] sm:items-center">
            <div>
              <p className="text-sm font-semibold">{level.level} <span className="font-normal text-[var(--muted)]">· {statusLabel(level)}</span></p>
              <p className="text-[11px] text-[var(--muted)]">
                {level.chargeAmount === null ? "No tuition charge" : `Charge ${naira(level.chargeAmount)}`}
                {level.cashPaid > 0 ? ` · cash recorded ${naira(level.cashPaid)}` : ""}
                {level.historicalPaidAmount > 0 ? ` · historical credit ${naira(level.historicalPaidAmount)}` : ""}
                {level.reviewOutstanding > 0
                  ? ` · potential balance ${naira(level.reviewOutstanding)}`
                  : amount > 0
                    ? ` · balance ${naira(amount)}`
                    : ""}
                {level.enrolment
                  ? ` · enrolment${level.enrolment.batchMonth ? ` ${level.enrolment.batchMonth}${level.enrolment.batchYear ? ` ${level.enrolment.batchYear}` : ""}` : ""}`
                  : ""}
              </p>
            </div>
            <select
              value={selection[level.level] ?? ""}
              disabled={Boolean(busyLevel)}
              onChange={(event) =>
                setSelection((current) => ({
                  ...current,
                  [level.level]: event.target.value as Classification | "",
                }))
              }
              aria-label={`Classify ${level.level} history`}
              className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-2 text-xs"
            >
              <option value="">Choose verified history…</option>
              {choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
            </select>
            <button
              type="button"
              disabled={!selection[level.level] || Boolean(busyLevel)}
              onClick={() => void save(level)}
              className="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busyLevel === level.level ? "Saving…" : "Save"}
            </button>
          </div>
        );
      })}
    </section>
  );
}
