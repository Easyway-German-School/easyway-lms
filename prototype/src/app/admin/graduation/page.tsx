"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/AdminShell";
import { LevelUpIcon } from "@/components/icons";

/**
 * Finished batches — the one place a batch is moved on.
 *
 * Grouped by BATCH first (August, September…), because that is how the school
 * thinks: "August has ended". Levels are the subset inside each batch. One
 * button per batch does the whole job for everyone in it:
 *
 *   ready to move up   signed off, certificate, moved to the next level and
 *                      intake, then sent Becca's next-level message
 *   only owe on the    NOT moved (the money rule stands) but still sent the
 *   level just done    message — their Pay button settles the old balance and
 *                      the new deposit in one payment, and signs the level off
 *   never started /    left alone, listed with the reason
 *   held back
 *
 * Every learner who is messaged gets the same thing at the same moment: the pop
 * on their dashboard, a bell + push, and a designed email. Their tutor gets one
 * note. The same rules run each morning once "Automatic" is on.
 */

type Verdict =
  | { state: "ready" }
  | { state: "blocked"; reason: "fees" | "unpaid" | "never_started" | "held_back" | "top_of_ladder"; detail: string };

type DeskStudent = { studentId: string; name: string; email: string; sitting: string; verdict: Verdict; offered: boolean };

type Cohort = {
  key: string;
  branch: string;
  level: string;
  nextLevel: string | null;
  batch: string;
  label: string;
  weekend: boolean;
  endsOn: string;
  daysToEnd: number;
  ended: boolean;
  landing: { label: string; startsOn: string; hasStarted: boolean } | null;
  ready: number;
  owes: number;
  blocked: number;
  students: DeskStudent[];
};

type RunningBatch = {
  key: string;
  branch: string;
  level: string;
  batch: string;
  label: string;
  endsOn: string;
  daysToEnd: number;
  count: number;
};

type Auto = { enabled: boolean; lastRunAt: string | null; lastRunSummary: string | null };

type Accounting = {
  total: number;
  onDesk: number;
  running: number;
  notOpenYet: number;
  noBatch: number;
  topOfLadder: number;
};

type RunResult = {
  graduated: { studentId: string; name: string }[];
  invited: { studentId: string; name: string; detail: string }[];
  skipped: { studentId: string; name: string; reason: string }[];
  certificatesIssued: number;
  certificatesPending: { name: string; reason: string }[];
  notified: number;
  tutorsNotified: number;
};

/** One level inside a batch, across every branch. */
type LevelGroup = {
  level: string;
  nextLevel: string | null;
  branches: string[];
  endsOn: string;
  ended: boolean;
  daysToEnd: number;
  landing: Cohort["landing"];
  students: Array<DeskStudent & { branch: string }>;
};

type BatchGroup = {
  /** The intake the learners joined, as the school says it: "August". */
  name: string;
  /** The teaching span: "August – September 2026". */
  label: string;
  weekend: boolean;
  levels: LevelGroup[];
  endsOn: string;
  ended: boolean;
  daysToEnd: number;
  total: number;
  ready: number;
  owes: number;
  blocked: number;
};

const CHUNK = 10;

const REASON_LABEL: Record<string, string> = {
  unpaid: "have not paid the deposit — left alone",
  never_started: "never started — left alone",
  held_back: "held back by the office",
  top_of_ladder: "at the top level",
};

const REASON_STYLE: Record<string, string> = {
  unpaid: "bg-rose-50 text-rose-800 ring-rose-300",
  fees: "bg-amber-50 text-amber-800 ring-amber-300",
  never_started: "bg-rose-50 text-rose-800 ring-rose-300",
  held_back: "bg-sky-50 text-sky-800 ring-sky-300",
  top_of_ladder: "bg-slate-50 text-slate-700 ring-slate-300",
};

function when(iso: string) {
  return new Date(iso).toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Lagos" });
}

function timingLabel(group: { ended: boolean; daysToEnd: number; endsOn: string }) {
  if (group.ended) return `Finished ${when(group.endsOn)}`;
  if (group.daysToEnd <= 1) return "Finishes tomorrow";
  return `Finishes in ${group.daysToEnd} days (${when(group.endsOn)})`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const empty = (): RunResult => ({
  graduated: [],
  invited: [],
  skipped: [],
  certificatesIssued: 0,
  certificatesPending: [],
  notified: 0,
  tutorsNotified: 0,
});

/** Batch first, then level, then branch is just a tag on each learner. */
function groupByBatch(cohorts: Cohort[]): BatchGroup[] {
  const batches = new Map<string, Map<string, LevelGroup>>();
  const meta = new Map<string, { name: string; label: string; weekend: boolean }>();
  for (const cohort of cohorts) {
    // Same intake month AND same teaching span: a weekend sitting runs longer, so it is its own batch.
    const groupKey = `${cohort.batch}|${cohort.label}`;
    meta.set(groupKey, { name: cohort.batch, label: cohort.label, weekend: cohort.weekend });
    const levels = batches.get(groupKey) ?? new Map<string, LevelGroup>();
    const group = levels.get(cohort.level) ?? {
      level: cohort.level,
      nextLevel: cohort.nextLevel,
      branches: [],
      endsOn: cohort.endsOn,
      ended: cohort.ended,
      daysToEnd: cohort.daysToEnd,
      landing: cohort.landing,
      students: [],
    };
    if (!group.branches.includes(cohort.branch)) group.branches.push(cohort.branch);
    // A weekend sitting can finish later than the weekday one in the same batch.
    if (cohort.endsOn > group.endsOn) {
      group.endsOn = cohort.endsOn;
      group.daysToEnd = Math.max(group.daysToEnd, cohort.daysToEnd);
    }
    group.ended = group.ended && cohort.ended;
    group.students.push(...cohort.students.map((student) => ({ ...student, branch: cohort.branch })));
    levels.set(cohort.level, group);
    batches.set(groupKey, levels);
  }

  return [...batches.entries()]
    .map(([groupKey, levelMap]) => {
      const { name, label, weekend } = meta.get(groupKey)!;
      const levels = [...levelMap.values()].sort((a, b) => a.level.localeCompare(b.level));
      const students = levels.flatMap((level) => level.students);
      return {
        name,
        label,
        weekend,
        levels,
        endsOn: levels.reduce((latest, level) => (level.endsOn > latest ? level.endsOn : latest), levels[0].endsOn),
        ended: levels.every((level) => level.ended),
        daysToEnd: Math.max(...levels.map((level) => level.daysToEnd)),
        total: students.length,
        ready: students.filter((s) => s.verdict.state === "ready").length,
        owes: students.filter((s) => s.verdict.state === "blocked" && s.verdict.reason === "fees").length,
        blocked: students.filter((s) => s.verdict.state === "blocked" && s.verdict.reason !== "fees").length,
      };
    })
    .sort((a, b) => a.daysToEnd - b.daysToEnd || a.label.localeCompare(b.label));
}

const batchTitle = (batch: { name: string; weekend: boolean }) => `${batch.name} batch${batch.weekend ? " · weekend sitting" : ""}`;

/** Who a press will touch: everyone ready, plus the owing who have not been invited yet. */
function targetsOf(students: DeskStudent[]) {
  const move = students.filter((s) => s.verdict.state === "ready").map((s) => s.studentId);
  const invite = students
    .filter((s) => s.verdict.state === "blocked" && s.verdict.reason === "fees" && !s.offered)
    .map((s) => s.studentId);
  return { move, invite, ids: [...move, ...invite] };
}

export default function GraduationPage() {
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [running, setRunning] = useState<RunningBatch[]>([]);
  const [auto, setAuto] = useState<Auto>({ enabled: false, lastRunAt: null, lastRunSummary: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [showRunning, setShowRunning] = useState(false);
  const [accounting, setAccounting] = useState<Accounting | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/graduation", { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Could not load");
      setCohorts(json.cohorts);
      setRunning(json.running);
      setAccounting(json.accounting ?? null);
      setAuto(json.auto);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const batches = useMemo(() => groupByBatch(cohorts), [cohorts]);

  async function post(payload: Record<string, unknown>) {
    const response = await fetch("/api/admin/graduation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.error || "That did not work");
    return json;
  }

  // Runs the given learners ten at a time, so a big batch never hangs on one
  // long request and the office sees it advance.
  async function run(title: string, students: DeskStudent[]) {
    const { move, invite, ids } = targetsOf(students);
    if (ids.length === 0) return;
    const parts = [
      move.length ? `move ${plural(move.length, "learner")} up to the next level (sign-off, certificate, new intake)` : "",
      invite.length ? `invite ${plural(invite.length, "learner")} who still owe on this level (they are not moved)` : "",
    ].filter(Boolean);
    if (
      !window.confirm(
        `${title}\n\nThis will ${parts.join(" and ")}.\n\nEvery one of them gets Becca's next-level message — the pop on their dashboard, a notification and an email — and their tutors get a note. It cannot be recalled.`,
      )
    )
      return;

    setBusy(true);
    setError("");
    setResult(null);
    const total = empty();
    try {
      for (let i = 0; i < ids.length; i += CHUNK) {
        setProgress({ done: i, total: ids.length });
        const chunk: RunResult = await post({ action: "graduate", studentIds: ids.slice(i, i + CHUNK) });
        total.graduated.push(...chunk.graduated);
        total.invited.push(...chunk.invited);
        total.skipped.push(...chunk.skipped);
        total.certificatesIssued += chunk.certificatesIssued;
        total.certificatesPending.push(...chunk.certificatesPending);
        total.notified += chunk.notified;
        total.tutorsNotified += chunk.tutorsNotified;
      }
      setProgress({ done: ids.length, total: ids.length });
    } catch (e) {
      setError(
        `${e instanceof Error ? e.message : "That did not work"} — ${plural(total.graduated.length + total.invited.length, "learner")} done before it stopped. Press the button again to carry on with the rest.`,
      );
    } finally {
      setResult(total);
      setBusy(false);
      setProgress(null);
      await load();
    }
  }

  async function toggleAuto() {
    setBusy(true);
    setError("");
    try {
      const json = await post({ action: "setAuto", enabled: !auto.enabled });
      setAuto(json.auto);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work");
    } finally {
      setBusy(false);
    }
  }

  const toggleOpen = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const everyone = useMemo(() => targetsOf(batches.flatMap((batch) => batch.levels.flatMap((level) => level.students))), [batches]);

  return (
    <AdminShell>
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <LevelUpIcon className="h-8 w-8 text-[var(--accent)]" />
            <h1 className="text-3xl font-bold text-[var(--foreground)]">Finished batches</h1>
          </div>
          <p className="text-[var(--muted)]">
            When a batch ends, press its button. Learners who are ready move up to the next level; everyone in the batch
            gets a pop-up, a notification and an email inviting them to confirm their seat — with a Pay button that works.
            Their tutors are told too.
          </p>
        </div>

        {error && <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">{error}</div>}
        {loading && <p className="text-[var(--muted)]">Loading…</p>}

        <section className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="space-y-1">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--muted)]">Automatic</p>
            <p className="font-semibold text-[var(--foreground)]">
              {auto.enabled
                ? "On — the morning after a batch ends, it is done for you"
                : "Off — you press the button for each batch yourself"}
            </p>
            <p className="max-w-xl text-sm text-[var(--muted)]">
              Same rules as the buttons below: ready learners move up, learners who owe on the finished level are invited
              (not moved), and anyone who never started or was held back is left for you.
              {auto.lastRunSummary && auto.lastRunAt ? ` Last run ${when(auto.lastRunAt)}: ${auto.lastRunSummary}` : ""}
            </p>
          </div>
          <button
            disabled={busy}
            onClick={toggleAuto}
            role="switch"
            aria-checked={auto.enabled}
            className={`rounded-full px-5 py-2.5 text-sm font-bold shadow-sm transition disabled:opacity-50 ${
              auto.enabled ? "bg-emerald-600 text-white" : "border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--background)]"
            }`}
          >
            {auto.enabled ? "Automatic is on" : "Turn automatic on"}
          </button>
        </section>

        {progress && (
          <div className="space-y-2 rounded-2xl bg-[var(--surface)] p-4 shadow-sm">
            <p className="text-sm font-semibold text-[var(--foreground)]">
              Working through the batch… {progress.done} of {progress.total}
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--background)]">
              <div className="h-full bg-[#FF6600] transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
          </div>
        )}

        {result && (
          <section className="space-y-2 rounded-3xl border border-emerald-300 bg-emerald-50 p-5 text-sm text-emerald-900">
            <p className="text-base font-bold">
              Moved up {result.graduated.length}
              {" · "}
              invited {result.invited.length} more
              {" · "}
              {result.notified} message{result.notified === 1 ? "" : "s"} sent
              {" · "}
              {result.certificatesIssued} certificate{result.certificatesIssued === 1 ? "" : "s"} issued
              {result.tutorsNotified > 0 ? ` · ${plural(result.tutorsNotified, "tutor")} told` : ""}
            </p>
            {result.certificatesPending.length > 0 && (
              <p>
                No certificate yet for {result.certificatesPending.length}:{" "}
                {result.certificatesPending.map((p) => `${p.name} (${p.reason})`).join("; ")}
              </p>
            )}
            {result.skipped.length > 0 && (
              <div>
                <p className="font-semibold">Left for you ({result.skipped.length}):</p>
                <ul className="list-disc pl-5">
                  {result.skipped.map((s) => (
                    <li key={s.studentId}>
                      {s.name} — {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p>
              See who has opened it, held a seat or paid on{" "}
              <Link href="/admin/next-level" className="font-semibold underline">
                Next level follow-up
              </Link>
              .
            </p>
          </section>
        )}

        {!loading && !error && batches.length === 0 && (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">
            No batch has finished, or is within two weeks of finishing, right now.
            {running.length > 0 ? " The next ones due are listed at the bottom." : ""}
          </div>
        )}

        {batches.length > 1 && everyone.ids.length > 0 && (
          <section className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-[#FF6600]/40 bg-[var(--surface)] p-5 shadow-sm">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#FF6600]">Everything at once</p>
              <p className="text-xl font-bold text-[var(--foreground)]">
                {plural(everyone.move.length, "learner")} to move up
                {everyone.invite.length ? `, ${everyone.invite.length} to invite` : ""} across {plural(batches.length, "batch")}
              </p>
            </div>
            <button
              disabled={busy}
              onClick={() => run("Every batch on this page", batches.flatMap((batch) => batch.levels.flatMap((level) => level.students)))}
              className="rounded-full bg-[#FF6600] px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
            >
              Do every batch
            </button>
          </section>
        )}

        <div className="space-y-5">
          {batches.map((batch) => {
            const students = batch.levels.flatMap((level) => level.students);
            const todo = targetsOf(students);
            return (
              <section key={`${batch.name}|${batch.label}`} className="space-y-4 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--muted)]">Batch</p>
                    <h2 className="text-3xl font-bold text-[var(--foreground)]">{batchTitle(batch)}</h2>
                    <p className="text-sm text-[var(--muted)]">
                      {plural(batch.total, "learner")} · teaching {batch.label} · {timingLabel(batch)}
                    </p>
                  </div>
                  <button
                    disabled={busy || todo.ids.length === 0}
                    onClick={() => run(batchTitle(batch), students)}
                    className="rounded-full bg-[#FF6600] px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:opacity-90 disabled:opacity-40"
                  >
                    {todo.ids.length === 0
                      ? batch.owes > 0
                        ? "Everyone has been invited"
                        : "Nobody ready yet"
                      : `Move up ${todo.move.length}${todo.invite.length ? ` · invite ${todo.invite.length}` : ""}`}
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-300">
                    {batch.ready} ready to move up
                  </span>
                  {batch.owes > 0 && (
                    <span className="rounded-full bg-amber-50 px-3 py-1 font-semibold text-amber-800 ring-1 ring-inset ring-amber-300">
                      {batch.owes} owe on this level — invited, not moved
                    </span>
                  )}
                  {Object.entries(
                    students.reduce<Record<string, number>>((counts, student) => {
                      if (student.verdict.state === "blocked" && student.verdict.reason !== "fees") {
                        counts[student.verdict.reason] = (counts[student.verdict.reason] ?? 0) + 1;
                      }
                      return counts;
                    }, {}),
                  ).map(([reason, count]) => (
                    <span
                      key={reason}
                      className={`rounded-full px-3 py-1 font-semibold ring-1 ring-inset ${REASON_STYLE[reason] ?? REASON_STYLE.top_of_ladder}`}
                    >
                      {count} {REASON_LABEL[reason] ?? "need a look"}
                    </span>
                  ))}
                </div>

                <div className="space-y-3">
                  {batch.levels.map((level) => {
                    const key = `${batch.name}|${batch.label}|${level.level}`;
                    const levelTodo = targetsOf(level.students);
                    const shown = open.has(key);
                    return (
                      <div key={key} className="rounded-2xl bg-[var(--background)] p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-lg font-bold text-[var(--foreground)]">
                              {level.level} → {level.nextLevel}
                            </p>
                            <p className="text-xs text-[var(--muted)]">
                              {plural(level.students.length, "learner")} · {level.branches.join(", ")}
                              {level.landing
                                ? ` · moves into ${level.landing.label}, ${level.landing.hasStarted ? "already under way" : `opens ${when(level.landing.startsOn)}`}`
                                : ""}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            <button onClick={() => toggleOpen(key)} className="text-xs font-semibold text-[var(--accent)] underline">
                              {shown ? "Hide learners" : "See learners"}
                            </button>
                            {batch.levels.length > 1 && (
                              <button
                                disabled={busy || levelTodo.ids.length === 0}
                                onClick={() => run(`${batchTitle(batch)} · ${level.level} only`, level.students)}
                                className="rounded-full border border-[var(--border)] px-4 py-1.5 text-xs font-bold text-[var(--foreground)] transition hover:bg-[var(--surface)] disabled:opacity-40"
                              >
                                Just {level.level}
                              </button>
                            )}
                          </div>
                        </div>

                        {shown && (
                          <ul className="mt-3 divide-y divide-[var(--border)] rounded-xl bg-[var(--surface)] text-sm">
                            {[...level.students]
                              .sort(
                                (a, b) =>
                                  Number(a.verdict.state === "ready") - Number(b.verdict.state === "ready") ||
                                  a.name.localeCompare(b.name),
                              )
                              .map((student) => (
                                <li key={student.studentId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                                  <span>
                                    <Link href={`/admin/students/${student.studentId}`} className="font-medium text-[var(--foreground)] hover:underline">
                                      {student.name}
                                    </Link>
                                    {level.branches.length > 1 && <span className="ml-2 text-xs text-[var(--muted)]">{student.branch}</span>}
                                  </span>
                                  {student.verdict.state === "ready" ? (
                                    <span className="text-xs font-semibold text-emerald-700">Will move up</span>
                                  ) : student.verdict.reason === "fees" ? (
                                    <span
                                      className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${REASON_STYLE.fees}`}
                                    >
                                      {student.offered ? "Invited — " : "Will be invited — "}
                                      {student.verdict.detail}
                                    </span>
                                  ) : (
                                    <span
                                      className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${REASON_STYLE[student.verdict.reason] ?? REASON_STYLE.top_of_ladder}`}
                                    >
                                      {student.verdict.detail}
                                    </span>
                                  )}
                                </li>
                              ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        {running.length > 0 && (
          <section className="space-y-3">
            <button onClick={() => setShowRunning((v) => !v)} className="text-sm font-semibold text-[var(--accent)] underline">
              {showRunning ? "Hide" : "Show"} batches still running ({running.reduce((sum, r) => sum + r.count, 0)} learners)
            </button>
            {showRunning && (
              <ul className="divide-y divide-[var(--border)] rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-sm">
                {running.map((batch) => (
                  <li key={batch.key} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                    <span className="text-[var(--foreground)]">
                      {batch.batch} batch · {batch.level} · {batch.branch} — {plural(batch.count, "learner")}
                    </span>
                    <span className="text-[var(--muted)]">
                      Finishes {when(batch.endsOn)} ({batch.daysToEnd} days)
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {accounting && (
          <section className="space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 text-sm">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--muted)]">Where is everybody?</p>
            <p className="text-[var(--foreground)]">
              <strong>{accounting.total}</strong> active learners. Only a batch that has <em>ended</em> (or ends within two weeks) is listed above.
            </p>
            <ul className="grid gap-1 text-[var(--muted)] sm:grid-cols-2">
              <li><strong className="text-[var(--foreground)]">{accounting.onDesk}</strong> are on this page</li>
              <li><strong className="text-[var(--foreground)]">{accounting.running}</strong> are in a batch still running — they appear when it ends</li>
              <li><strong className="text-[var(--foreground)]">{accounting.notOpenYet}</strong> are waiting for a batch that has not opened yet</li>
              <li><strong className="text-[var(--foreground)]">{accounting.noBatch}</strong> have no readable batch on their record</li>
              {accounting.topOfLadder > 0 && (
                <li><strong className="text-[var(--foreground)]">{accounting.topOfLadder}</strong> are already at the top level</li>
              )}
            </ul>
          </section>
        )}

        <p className="border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)]">
          Who has opened their invitation, held a seat or paid? Chasing the ones gone quiet?{" "}
          <Link href="/admin/next-level" className="underline">
            Next level follow-up
          </Link>
          {" · "}
          Need the individual steps, or to move up someone who still owes (super admin, with a reason)?{" "}
          <Link href="/admin/journey" className="underline">
            Cohort sign-off
          </Link>
          {" · "}
          <Link href="/admin/completions" className="underline">
            Batch completions
          </Link>
          {" · "}
          <Link href="/admin/promotions" className="underline">
            Promotions
          </Link>
          {" · "}
          <Link href="/admin/upcoming-intake" className="underline">
            Upcoming intake
          </Link>
        </p>
      </div>
    </AdminShell>
  );
}
