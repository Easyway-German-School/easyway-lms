"use client";

/**
 * The people the assistant just found, as rows you can act on.
 *
 * WHY THIS EXISTS RATHER THAN LETTING THE MODEL LIST NAMES.
 *
 * A language model asked for eighteen students will write out a list of
 * eighteen names, and somewhere around the twelfth it will drop one, merge two,
 * or invent a level. That is not a failure of a bad model — it is what
 * generating prose from a table does. So the model never lists anybody: it says
 * how many and why, and the actual rows come straight from the tool result to
 * this table, untouched by it. The prose is the summary; the table is the
 * record, and only one of them is allowed to be the thing you act on.
 *
 * It also holds every matching row, not the twenty-five the model was shown.
 * The model reads a sample so a local CPU can answer in under a minute; the
 * office gets all of them, because "select all 38 and message them" is the
 * entire point of having asked.
 *
 * ACTIONS ARE REVERSIBLE ONLY. Notify and export. No promoting, no marking
 * paid, no level changes — those live on their own pages with their own
 * confirmations, and a bulk write driven by a list a model assembled is exactly
 * where you would discover it had misread "not paid" as "not fully paid".
 */

import { useMemo, useState } from "react";
import {
  CheckIcon,
  DownloadIcon,
  SendIcon,
  UsersIcon,
  AlertIcon,
} from "@/components/icons";

export type CohortRow = {
  id: string;
  name: string;
  email: string;
  studentCode: string | null;
  level: string;
  branch: string | null;
  status: string;
  goal: string | null;
  owed?: number;
  paymentState?: "unpaid" | "partial" | "paid";
  daysSinceSeen?: number | null;
  lastSeen?: string | null;
  startedClasses: boolean;
  registeredOn: string;
};

export type Cohort = { label: string; rows: CohortRow[]; truncated: boolean };

const naira = (value: number) => `NGN ${Math.round(value).toLocaleString()}`;

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  // Excel opens a field starting with = as a formula. Prefixing a quote is the
  // standard defence and matters here because student names are user input.
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export default function CohortResult({
  cohort,
  /** Whether this admin may message people. Export stays available regardless. */
  canMessage,
}: {
  cohort: Cohort;
  canMessage: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(cohort.rows.map((r) => r.id)));
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const showMoney = cohort.rows.some((row) => row.owed !== undefined);
  const showAttendance = cohort.rows.some((row) => row.daysSinceSeen !== undefined);
  const allSelected = selected.size === cohort.rows.length && cohort.rows.length > 0;

  const totalOwed = useMemo(
    () => cohort.rows.filter((row) => selected.has(row.id)).reduce((sum, row) => sum + (row.owed ?? 0), 0),
    [cohort.rows, selected],
  );

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exportCsv = () => {
    const rows = cohort.rows.filter((row) => selected.has(row.id));
    const headers = [
      "Name",
      "Email",
      "Student code",
      "Level",
      "Branch",
      "Status",
      "Goal",
      "Started classes",
      "Registered",
      ...(showMoney ? ["Owed (NGN)", "Payment state"] : []),
      ...(showAttendance ? ["Last seen", "Days since seen"] : []),
    ];

    const body = rows.map((row) =>
      [
        row.name,
        row.email,
        row.studentCode ?? "",
        row.level,
        row.branch ?? "",
        row.status,
        row.goal ?? "",
        row.startedClasses ? "yes" : "no",
        row.registeredOn,
        ...(showMoney ? [row.owed ?? 0, row.paymentState ?? ""] : []),
        ...(showAttendance ? [row.lastSeen ?? "never", row.daysSinceSeen ?? ""] : []),
      ]
        .map(csvEscape)
        .join(","),
    );

    // BOM first: without it Excel on Windows reads UTF-8 names as mojibake,
    // and this school's register is full of names with diacritics.
    const blob = new Blob(["﻿" + [headers.map(csvEscape).join(","), ...body].join("\r\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `easyway-${cohort.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const send = async () => {
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/admin/assistant/cohort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentIds: [...selected], title, message }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error ?? "That did not send.");
        return;
      }
      setResult(`Sent to ${data.delivered} student${data.delivered === 1 ? "" : "s"}.`);
      setComposing(false);
      setTitle("");
      setMessage("");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <UsersIcon className="h-4 w-4 text-[var(--accent)]" />
            {cohort.rows.length} student{cohort.rows.length === 1 ? "" : "s"}
          </p>
          <p className="mt-0.5 truncate text-xs text-slate-500">{cohort.label}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-500">
            {selected.size} selected
            {showMoney && totalOwed > 0 ? ` · ${naira(totalOwed)} owed` : ""}
          </span>
          <button
            type="button"
            onClick={exportCsv}
            disabled={selected.size === 0}
            className="flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
          >
            <DownloadIcon className="h-3.5 w-3.5" />
            Export CSV
          </button>
          {canMessage && (
            <button
              type="button"
              onClick={() => setComposing((current) => !current)}
              disabled={selected.size === 0}
              className="flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-3 py-2 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-40"
            >
              <SendIcon className="h-3.5 w-3.5" />
              Message these {selected.size}
            </button>
          )}
        </div>
      </div>

      {cohort.truncated && (
        <p className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          This is the first 500 matches. Narrow the question — by branch, level or batch — to be sure you are
          seeing everybody.
        </p>
      )}

      {composing && (
        <div className="space-y-2.5 border-b border-slate-200 bg-slate-50 px-4 py-4">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
            Goes to the bell and the phone of {selected.size} student{selected.size === 1 ? "" : "s"}
          </p>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value.slice(0, 120))}
            placeholder="Subject — e.g. Your tuition balance"
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
          />
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value.slice(0, 2000))}
            rows={4}
            placeholder="Write it as you would say it at the desk. Ask the assistant above to draft it if you like."
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={send}
              disabled={sending || !title.trim() || !message.trim()}
              className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-40"
            >
              {sending ? "Sending…" : `Send to ${selected.size}`}
            </button>
            <button
              type="button"
              onClick={() => setComposing(false)}
              className="rounded-full border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600 transition hover:bg-white"
            >
              Cancel
            </button>
            <span className="text-[11px] text-slate-500">
              This one is not undoable. Everything else on this panel is.
            </span>
          </div>
        </div>
      )}

      {(result || error) && (
        <p
          className={`px-4 py-2.5 text-xs font-semibold ${
            error ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {error ?? result}
        </p>
      )}

      {/* Its own scroller: a 500-row table must never make the page scroll
          sideways, and the admin area is used from a phone at the front desk. */}
      <div className="max-h-[26rem] overflow-auto">
        <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="w-10 px-3 py-2.5">
                <button
                  type="button"
                  aria-label={allSelected ? "Clear selection" : "Select all"}
                  onClick={() =>
                    setSelected(allSelected ? new Set() : new Set(cohort.rows.map((row) => row.id)))
                  }
                  className={`grid h-4 w-4 place-items-center rounded border ${
                    allSelected ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-slate-300 bg-white"
                  }`}
                >
                  {allSelected && <CheckIcon className="h-3 w-3" strokeWidth={3} />}
                </button>
              </th>
              <th className="px-3 py-2.5 font-semibold">Student</th>
              <th className="px-3 py-2.5 font-semibold">Level</th>
              <th className="px-3 py-2.5 font-semibold">Branch</th>
              {showMoney && <th className="px-3 py-2.5 font-semibold">Owed</th>}
              {showAttendance && <th className="px-3 py-2.5 font-semibold">Last seen</th>}
              <th className="px-3 py-2.5 font-semibold">Goal</th>
            </tr>
          </thead>
          <tbody>
            {cohort.rows.map((row) => {
              const isSelected = selected.has(row.id);
              return (
                <tr
                  key={row.id}
                  onClick={() => toggle(row.id)}
                  className={`cursor-pointer border-t border-slate-100 transition ${
                    isSelected ? "bg-[var(--accent)]/5" : "hover:bg-slate-50"
                  }`}
                >
                  <td className="px-3 py-2.5">
                    <span
                      className={`grid h-4 w-4 place-items-center rounded border ${
                        isSelected ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-slate-300"
                      }`}
                    >
                      {isSelected && <CheckIcon className="h-3 w-3" strokeWidth={3} />}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="block font-semibold text-slate-900">{row.name}</span>
                    <span className="block text-xs text-slate-500">{row.email}</span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-700">{row.level}</td>
                  <td className="px-3 py-2.5 text-slate-700">{row.branch ?? "—"}</td>
                  {showMoney && (
                    <td className="px-3 py-2.5">
                      <span
                        className={`font-semibold ${
                          (row.owed ?? 0) > 0 ? "text-rose-600" : "text-emerald-600"
                        }`}
                      >
                        {(row.owed ?? 0) > 0 ? naira(row.owed ?? 0) : "Paid up"}
                      </span>
                    </td>
                  )}
                  {showAttendance && (
                    <td className="px-3 py-2.5 text-slate-700">
                      {row.daysSinceSeen === null || row.daysSinceSeen === undefined ? (
                        <span className="font-semibold text-rose-600">Never</span>
                      ) : (
                        <span className={row.daysSinceSeen >= 14 ? "font-semibold text-amber-600" : ""}>
                          {row.daysSinceSeen}d ago
                        </span>
                      )}
                    </td>
                  )}
                  <td className="px-3 py-2.5 text-xs text-slate-600">{row.goal ?? "Not asked yet"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
