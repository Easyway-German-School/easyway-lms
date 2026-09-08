"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/AdminShell";
import { RosterIcon } from "@/components/icons";

/**
 * The cohort console.
 *
 * The roster, grouped by branch → level → batch month, so the office can see
 * the shape of an intake at a glance — and, more to the point, see the
 * students who have no batch at all, or the wrong one. Those sit outside every
 * cohort the timetable, the promotion engine and the "message the September
 * intake" send can address. Tick them, pick a month, move them in.
 *
 * Each student also carries a READ-ONLY reading of whether they are starting a
 * batch or already mid-course (see lib/cohort-classify.ts) and an amber flag
 * when their stored batch month disagrees with the evidence. Nothing here acts
 * on that automatically — it is a worklist for a human.
 *
 * The only write is `admission.batch`. It does not enrol, promote, or bill —
 * those stay one-student-at-a-time on /admin/students.
 */

const NO_BATCH = "(no batch)";

type CohortStatus = "new" | "ongoing" | "returning" | "unknown";

type CohortClassification = {
  status: CohortStatus;
  confidence: "high" | "medium" | "low";
  evidence: string[];
  suggestedStartedAt: string | null;
  suggestedBatch: string | null;
  mismatch: string | null;
  officeConfirmed: boolean;
};

type Group = {
  branch: string;
  level: string;
  batch: string;
  count: number;
  started: number;
  ids: string[];
};

type StudentInfo = {
  name: string;
  email: string;
  studentCode: string | null;
  status: string;
  level: string;
  branchName: string | null;
  batch: string | null;
  startedClasses: boolean;
};

type CohortData = {
  groups: Group[];
  students: Record<string, StudentInfo>;
  total: number;
  truncated: boolean;
  noBatch: number;
  currentIntake: { month: string; year: number };
  months: string[];
  classifications: Record<string, CohortClassification>;
  classTally: Record<CohortStatus, number> & { mismatches: number };
};

type RowFilter = "all" | "mismatch" | "unknown";

const groupKey = (g: Group) => `${g.branch}||${g.level}||${g.batch}`;

const STATUS_META: Record<CohortStatus, { label: string; className: string; hint: string }> = {
  new: {
    label: "New",
    className: "bg-slate-100 text-slate-700 ring-slate-300",
    hint: "Fresh account this intake, nothing done yet — the current-intake default fits.",
  },
  ongoing: {
    label: "Ongoing",
    className: "bg-emerald-100 text-emerald-800 ring-emerald-300",
    hint: "Mid-course: has attended, been marked, or has classwork behind them.",
  },
  returning: {
    label: "Returning",
    className: "bg-indigo-100 text-indigo-800 ring-indigo-300",
    hint: "Ongoing and has finished at least one level with us before — continuing, not starting.",
  },
  unknown: {
    label: "Unclear",
    className: "bg-amber-100 text-amber-900 ring-amber-300",
    hint: "No signal either way. Could be a pre-attendance ongoing student or a no-show — needs a human.",
  },
};

export default function CohortsPage() {
  const [data, setData] = useState<CohortData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetMonth, setTargetMonth] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [rowFilter, setRowFilter] = useState<RowFilter>("all");
  /** Per-student worklist draft: which button is armed, and the "since" month. */
  const [resolveDraft, setResolveDraft] = useState<Record<string, { status: "new" | "ongoing"; month: string }>>({});
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/cohorts", { cache: "no-store" });
      if (res.ok) {
        const next: CohortData = await res.json();
        setData(next);
        setTargetMonth((prev) => prev || next.currentIntake.month);
      } else {
        setMsg("Could not load cohorts.");
      }
    } catch {
      setMsg("Could not load cohorts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const classifications = data?.classifications ?? {};

  const rowVisible = useCallback(
    (id: string) => {
      if (rowFilter === "all") return true;
      const c = classifications[id];
      if (!c) return false;
      if (rowFilter === "mismatch") return Boolean(c.mismatch);
      return c.status === "unknown";
    },
    [rowFilter, classifications],
  );

  const byBranch = useMemo(() => {
    const map = new Map<string, Group[]>();
    for (const g of data?.groups ?? []) {
      // When a filter is on, drop groups with nothing left to show.
      if (rowFilter !== "all" && !g.ids.some((id) => rowVisible(id))) continue;
      const list = map.get(g.branch) ?? [];
      list.push(g);
      map.set(g.branch, list);
    }
    return [...map.entries()];
  }, [data, rowFilter, rowVisible]);

  const toggleExpanded = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleStudent = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setGroupSelected = (ids: string[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const apply = async () => {
    if (selected.size === 0 || !targetMonth) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/admin/cohorts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentIds: [...selected], batch: targetMonth }),
      });
      const out = await res.json();
      if (res.ok) {
        setMsg(
          `Moved ${out.updated} student${out.updated === 1 ? "" : "s"} into the ${out.batch} intake` +
            (out.skipped ? ` (${out.skipped} skipped — not on your roster)` : "") +
            ".",
        );
        setSelected(new Set());
        await load();
      } else {
        setMsg(out.error || "Could not move those students.");
      }
    } catch {
      setMsg("Could not move those students.");
    } finally {
      setBusy(false);
    }
  };

  /** Confirm one "can't place" student as new, or ongoing since a given month. */
  const resolve = async (id: string, status: "new" | "ongoing", month?: string) => {
    setResolvingId(id);
    setMsg("");
    try {
      const body: Record<string, unknown> = { studentId: id, status };
      if (status === "ongoing" && month) {
        // An ongoing student started in the past: the most recent occurrence of
        // that month, first of the month.
        const now = new Date();
        const mi = data?.months.indexOf(month) ?? -1;
        const year = mi <= now.getMonth() ? now.getFullYear() : now.getFullYear() - 1;
        body.startedOn = `${year}-${String(mi + 1).padStart(2, "0")}-01`;
        body.batch = month;
      }
      const res = await fetch("/api/admin/cohorts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const out = await res.json();
      if (res.ok) {
        setMsg(
          status === "new"
            ? `Confirmed new${out.batch ? ` · filed in the ${out.batch} intake` : ""}.`
            : `Confirmed ongoing${month ? ` since ${month}` : ""}${out.classesStartedAt ? " · start date set" : ""}.`,
        );
        setResolveDraft((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        await load();
      } else {
        setMsg(out.error || "Could not save that.");
      }
    } catch {
      setMsg("Could not save that.");
    } finally {
      setResolvingId(null);
    }
  };

  const tally = data?.classTally;

  return (
    <AdminShell>
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <RosterIcon className="h-8 w-8 text-[var(--accent)]" />
            <h1 className="text-3xl font-bold text-[var(--foreground)]">Cohorts</h1>
          </div>
          <p className="text-[var(--muted)]">
            The roster by branch, level and batch month. Fix the students who landed outside
            a cohort, then message an intake from{" "}
            <Link href="/admin/assistant" className="text-[var(--accent)] underline">
              the assistant
            </Link>
            .
          </p>
          {data && (
            <p className="text-sm text-[var(--muted)]">
              Current intake: <strong className="text-[var(--foreground)]">{data.currentIntake.month} {data.currentIntake.year}</strong>{" "}
              — <Link href="/admin/settings" className="text-[var(--accent)] underline">change</Link>
              {data.truncated && " · showing the most recent 4,000 students"}
            </p>
          )}
        </div>

        {tally && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {(["new", "ongoing", "returning", "unknown"] as CohortStatus[]).map((s) => (
              <span
                key={s}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium ring-1 ring-inset ${STATUS_META[s].className}`}
                title={STATUS_META[s].hint}
              >
                {tally[s]} {STATUS_META[s].label.toLowerCase()}
              </span>
            ))}
            <span
              className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 font-semibold text-amber-800 ring-1 ring-inset ring-amber-300"
              title="Stored batch month disagrees with the evidence — a worklist, not an auto-fix."
            >
              ⚠ {tally.mismatches} in the wrong cohort
            </span>
          </div>
        )}

        {data && (tally?.mismatches || tally?.unknown) ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-[var(--muted)]">Show</span>
            {(
              [
                ["all", "Everyone"],
                ["mismatch", `Wrong cohort (${tally?.mismatches ?? 0})`],
                ["unknown", `Can't place (${tally?.unknown ?? 0})`],
              ] as [RowFilter, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setRowFilter(value)}
                className={`rounded-full px-3 py-1 font-medium ring-1 ring-inset transition ${
                  rowFilter === value
                    ? "bg-[var(--accent)] text-white ring-[var(--accent)]"
                    : "bg-[var(--surface)] text-[var(--muted)] ring-[var(--border)] hover:text-[var(--foreground)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}

        {msg && (
          <div className="rounded-lg bg-[var(--surface)] px-4 py-3 text-sm font-medium text-[var(--foreground)] shadow-sm">
            {msg}
          </div>
        )}

        {loading && <p className="text-[var(--muted)]">Loading…</p>}

        {data && !loading && (
          <>
            {data.noBatch > 0 && (
              <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                <strong>{data.noBatch}</strong> student{data.noBatch === 1 ? " has" : "s have"} no
                batch month. They are outside every cohort — no timetable end date, and no
                cohort message reaches them. Open the{" "}
                <span className="font-semibold">No branch → … → {NO_BATCH}</span> rows below,
                select them, and move them into an intake.
              </div>
            )}

            {byBranch.length === 0 && rowFilter !== "all" && (
              <p className="text-sm text-[var(--muted)]">Nothing matches that filter.</p>
            )}

            {byBranch.map(([branch, groups]) => (
              <div
                key={branch}
                className="overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-sm"
              >
                <div className="border-b border-[var(--border)] bg-[var(--background)] px-5 py-3 text-sm font-bold uppercase tracking-wide text-[var(--muted)]">
                  {branch}
                </div>
                <div className="divide-y divide-[var(--border)]">
                  {groups.map((g) => {
                    const key = groupKey(g);
                    const visibleIds = rowFilter === "all" ? g.ids : g.ids.filter(rowVisible);
                    if (visibleIds.length === 0) return null;
                    const isOpen = expanded.has(key);
                    const noBatch = g.batch === NO_BATCH;
                    const allSelected = visibleIds.every((id) => selected.has(id));
                    const groupMismatches = g.ids.filter((id) => classifications[id]?.mismatch).length;
                    return (
                      <div key={key} className={noBatch ? "bg-amber-50/60" : undefined}>
                        <button
                          onClick={() => toggleExpanded(key)}
                          className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-[var(--background)]"
                        >
                          <span className="flex items-center gap-2 font-medium text-[var(--foreground)]">
                            <span className="text-[var(--muted)]">{isOpen ? "▾" : "▸"}</span>
                            {g.level}
                            <span className={noBatch ? "font-semibold text-amber-700" : "text-[var(--muted)]"}>
                              · {g.batch}
                            </span>
                            {groupMismatches > 0 && (
                              <span
                                className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
                                title={`${groupMismatches} student${groupMismatches === 1 ? "" : "s"} whose stored batch disagrees with the evidence`}
                              >
                                ⚠ {groupMismatches}
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 text-sm text-[var(--muted)]">
                            {rowFilter === "all"
                              ? `${g.count} student${g.count === 1 ? "" : "s"} · ${g.started} started`
                              : `${visibleIds.length} of ${g.count} shown`}
                          </span>
                        </button>

                        {isOpen && (
                          <div className="bg-[var(--background)] px-5 py-3">
                            <button
                              onClick={() => setGroupSelected(visibleIds, !allSelected)}
                              className="mb-2 text-xs font-semibold text-[var(--accent)] underline"
                            >
                              {allSelected ? "Clear all shown" : `Select all ${visibleIds.length} shown`}
                            </button>
                            <ul className="space-y-1">
                              {visibleIds.map((id) => {
                                const s = data.students[id];
                                if (!s) return null;
                                const c = classifications[id];
                                return (
                                  <li key={id}>
                                    <label className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 hover:bg-[var(--surface)]">
                                      <input
                                        type="checkbox"
                                        checked={selected.has(id)}
                                        onChange={() => toggleStudent(id)}
                                        className="mt-1 h-4 w-4 rounded border-[var(--border)] accent-[var(--accent)]"
                                      />
                                      <span
                                        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                                          s.startedClasses ? "bg-emerald-500" : "bg-[var(--border)]"
                                        }`}
                                        title={s.startedClasses ? "Has a start date on file" : "No start date"}
                                      />
                                      <span className="min-w-0 flex-1">
                                        <span className="flex flex-wrap items-center gap-2">
                                          <span className="text-sm text-[var(--foreground)]">{s.name}</span>
                                          {s.studentCode && (
                                            <span className="text-xs text-[var(--muted)]">{s.studentCode}</span>
                                          )}
                                          {c && (
                                            <span
                                              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${STATUS_META[c.status].className} ${
                                                c.confidence === "low" ? "opacity-70" : ""
                                              }`}
                                              title={`${STATUS_META[c.status].hint}${
                                                c.evidence.length ? `\n\n• ${c.evidence.join("\n• ")}` : ""
                                              }`}
                                            >
                                              {STATUS_META[c.status].label}
                                              {c.confidence !== "high" ? " ?" : ""}
                                            </span>
                                          )}
                                          {s.status !== "active" && (
                                            <span className="text-xs uppercase text-[var(--muted)]">{s.status}</span>
                                          )}
                                        </span>
                                        {c?.mismatch && (
                                          <span className="mt-0.5 block text-xs text-amber-700">
                                            ⚠ {c.mismatch}
                                          </span>
                                        )}
                                        {c?.officeConfirmed && (
                                          <span className="mt-0.5 block text-xs text-[var(--muted)]">
                                            {c.evidence[0]}
                                          </span>
                                        )}
                                      </span>
                                    </label>

                                    {c?.status === "unknown" && !c.officeConfirmed && (
                                      <div className="ml-10 mt-1 flex flex-wrap items-center gap-2 text-xs">
                                        <span className="text-[var(--muted)]">Can&apos;t place —</span>
                                        <button
                                          type="button"
                                          disabled={resolvingId === id}
                                          onClick={() => resolve(id, "new")}
                                          className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-200 disabled:opacity-50"
                                        >
                                          New this intake
                                        </button>
                                        {resolveDraft[id]?.status === "ongoing" ? (
                                          <span className="inline-flex flex-wrap items-center gap-1.5">
                                            <span className="text-[var(--muted)]">ongoing since</span>
                                            <select
                                              value={resolveDraft[id]?.month ?? data.currentIntake.month}
                                              onChange={(e) =>
                                                setResolveDraft((p) => ({ ...p, [id]: { status: "ongoing", month: e.target.value } }))
                                              }
                                              className="rounded border border-[var(--border)] bg-[var(--background)] px-1.5 py-1 text-[var(--foreground)]"
                                            >
                                              {data.months.map((m) => (
                                                <option key={m} value={m}>{m}</option>
                                              ))}
                                            </select>
                                            <button
                                              type="button"
                                              disabled={resolvingId === id}
                                              onClick={() =>
                                                resolve(id, "ongoing", resolveDraft[id]?.month ?? data.currentIntake.month)
                                              }
                                              className="rounded-full bg-emerald-100 px-2.5 py-1 font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-300 hover:bg-emerald-200 disabled:opacity-50"
                                            >
                                              Confirm
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setResolveDraft((p) => {
                                                  const n = { ...p };
                                                  delete n[id];
                                                  return n;
                                                })
                                              }
                                              className="text-[var(--muted)] underline"
                                            >
                                              cancel
                                            </button>
                                          </span>
                                        ) : (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setResolveDraft((p) => ({ ...p, [id]: { status: "ongoing", month: data.currentIntake.month } }))
                                            }
                                            className="rounded-full bg-emerald-100 px-2.5 py-1 font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-300 hover:bg-emerald-200"
                                          >
                                            Ongoing…
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {selected.size > 0 && data && (
        <div className="sticky bottom-0 z-10 border-t border-[var(--border)] bg-[var(--surface)] px-6 py-3 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.25)]">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-semibold text-[var(--foreground)]">
              {selected.size} selected
              <button
                onClick={() => setSelected(new Set())}
                className="ml-3 text-xs font-medium text-[var(--muted)] underline"
              >
                clear
              </button>
            </span>
            <div className="flex items-center gap-2">
              <span className="text-sm text-[var(--muted)]">Move to</span>
              <select
                value={targetMonth}
                onChange={(e) => setTargetMonth(e.target.value)}
                className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
              >
                {data.months.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <button
                onClick={apply}
                disabled={busy}
                className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Moving…" : "Apply"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
