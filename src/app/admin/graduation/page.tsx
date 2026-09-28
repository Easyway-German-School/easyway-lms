"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/AdminShell";
import { LevelUpIcon } from "@/components/icons";

/**
 * The graduation desk.
 *
 * A batch finishes; this is the one page where it is moved on. Every batch that
 * has ended (or ends within a fortnight) shows as a card per branch and level.
 * One button per card — or one at the top for everything — signs the level off,
 * issues the certificates, moves each learner to the next level and intake
 * (their portal locks on the new deposit until it is paid) and messages them.
 * Who is NOT ready, and why, is listed on the card; nobody is moved without
 * being ready, whichever button is pressed.
 *
 * The same rules run by themselves each morning once "Automatic" is switched on.
 */

type Verdict =
  | { state: "ready" }
  | { state: "blocked"; reason: "fees" | "never_started" | "held_back" | "top_of_ladder"; detail: string };

type DeskStudent = { studentId: string; name: string; email: string; sitting: string; verdict: Verdict };

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

type RunResult = {
  graduated: { studentId: string; name: string }[];
  skipped: { studentId: string; name: string; reason: string }[];
  certificatesIssued: number;
  certificatesPending: { name: string; reason: string }[];
  notified: number;
};

const CHUNK = 10;

const REASON_STYLE: Record<string, string> = {
  fees: "bg-rose-50 text-rose-800 ring-rose-300",
  never_started: "bg-amber-50 text-amber-800 ring-amber-300",
  held_back: "bg-sky-50 text-sky-800 ring-sky-300",
  top_of_ladder: "bg-slate-50 text-slate-700 ring-slate-300",
};

function when(iso: string) {
  return new Date(iso).toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Lagos" });
}

function timingLabel(cohort: { ended: boolean; daysToEnd: number; endsOn: string }) {
  if (cohort.ended) return `Finished ${when(cohort.endsOn)}`;
  if (cohort.daysToEnd <= 1) return "Finishes tomorrow";
  return `Finishes in ${cohort.daysToEnd} days (${when(cohort.endsOn)})`;
}

const empty = (): RunResult => ({ graduated: [], skipped: [], certificatesIssued: 0, certificatesPending: [], notified: 0 });

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

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/graduation", { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Could not load");
      setCohorts(json.cohorts);
      setRunning(json.running);
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

  const totalReady = useMemo(() => cohorts.reduce((sum, cohort) => sum + cohort.ready, 0), [cohorts]);
  const readyCohorts = useMemo(() => cohorts.filter((cohort) => cohort.ready > 0).length, [cohorts]);

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

  // Moves the ready learners of the given cohorts, ten at a time, so a big batch
  // never hangs on one long request and the office sees it advance.
  async function moveUp(targets: Cohort[]) {
    const ids = targets.flatMap((cohort) =>
      cohort.students.filter((student) => student.verdict.state === "ready").map((student) => student.studentId),
    );
    if (ids.length === 0) return;
    const levels = [...new Set(targets.map((cohort) => `${cohort.level} → ${cohort.nextLevel}`))].join(", ");
    if (
      !window.confirm(
        `Move ${ids.length} learner${ids.length === 1 ? "" : "s"} up (${levels})?\n\nThis signs the level off, issues certificates, moves them to the next level and intake, locks their portal until the new deposit is paid, and messages them. It cannot be recalled.`,
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
        const chunk = await post({ action: "graduate", studentIds: ids.slice(i, i + CHUNK) });
        total.graduated.push(...chunk.graduated);
        total.skipped.push(...chunk.skipped);
        total.certificatesIssued += chunk.certificatesIssued;
        total.certificatesPending.push(...chunk.certificatesPending);
        total.notified += chunk.notified;
      }
      setProgress({ done: ids.length, total: ids.length });
    } catch (e) {
      setError(
        `${e instanceof Error ? e.message : "That did not work"} — ${total.graduated.length} learner${total.graduated.length === 1 ? " was" : "s were"} moved before it stopped. Press the button again to carry on with the rest.`,
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

  return (
    <AdminShell>
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <LevelUpIcon className="h-8 w-8 text-[var(--accent)]" />
            <h1 className="text-3xl font-bold text-[var(--foreground)]">Graduation</h1>
          </div>
          <p className="text-[var(--muted)]">
            When a batch finishes, move it on here. One button signs the level off, issues the certificates, moves each
            learner to the next level and intake, locks their portal until the new deposit is paid, and tells them.
          </p>
        </div>

        {error && <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">{error}</div>}
        {loading && <p className="text-[var(--muted)]">Loading…</p>}

        <section className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="space-y-1">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--muted)]">Automatic</p>
            <p className="font-semibold text-[var(--foreground)]">
              {auto.enabled ? "On — batches are moved up the morning after they finish" : "Off — you move each batch yourself"}
            </p>
            <p className="max-w-xl text-sm text-[var(--muted)]">
              Automatic uses exactly the same rules: only learners who started, aren&apos;t held back and owe nothing on a
              past level. Everyone else stays here for you.
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
              Moving learners up… {progress.done} of {progress.total}
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--background)]">
              <div className="h-full bg-[#FF6600] transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
          </div>
        )}

        {result && (
          <section className="space-y-2 rounded-3xl border border-emerald-300 bg-emerald-50 p-5 text-sm text-emerald-900">
            <p className="text-base font-bold">
              Moved up {result.graduated.length} learner{result.graduated.length === 1 ? "" : "s"}
              {" · "}
              {result.certificatesIssued} certificate{result.certificatesIssued === 1 ? "" : "s"} issued
              {" · "}
              {result.notified} notified
            </p>
            {result.certificatesPending.length > 0 && (
              <p>
                No certificate yet for {result.certificatesPending.length}:{" "}
                {result.certificatesPending.map((p) => `${p.name} (${p.reason})`).join("; ")}
              </p>
            )}
            {result.skipped.length > 0 && (
              <div>
                <p className="font-semibold">Not moved ({result.skipped.length}):</p>
                <ul className="list-disc pl-5">
                  {result.skipped.map((s) => (
                    <li key={s.studentId}>
                      {s.name} — {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {!loading && !error && cohorts.length === 0 && (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">
            No batch has finished, or is within two weeks of finishing, right now.
            {running.length > 0 ? " The next ones due are listed at the bottom." : ""}
          </div>
        )}

        {totalReady > 0 && (
          <section className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-[#FF6600]/40 bg-[var(--surface)] p-5 shadow-sm">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#FF6600]">One press</p>
              <p className="text-xl font-bold text-[var(--foreground)]">
                {totalReady} learner{totalReady === 1 ? " is" : "s are"} ready across {readyCohorts} batch
                {readyCohorts === 1 ? "" : "es"}
              </p>
            </div>
            <button
              disabled={busy}
              onClick={() => moveUp(cohorts)}
              className="rounded-full bg-[#FF6600] px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
            >
              Move up everyone who is ready
            </button>
          </section>
        )}

        <div className="space-y-4">
          {cohorts.map((cohort) => (
            <section key={cohort.key} className="space-y-4 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--muted)]">
                    {cohort.branch} · {cohort.batch} batch{cohort.weekend ? " · weekend" : ""}
                  </p>
                  <h2 className="text-2xl font-bold text-[var(--foreground)]">
                    {cohort.level} → {cohort.nextLevel}
                  </h2>
                  <p className="text-sm text-[var(--muted)]">
                    {timingLabel(cohort)}
                    {cohort.landing
                      ? ` · moves into ${cohort.landing.label}, ${cohort.landing.hasStarted ? "already under way" : `opens ${when(cohort.landing.startsOn)}`}`
                      : ""}
                  </p>
                </div>
                <button
                  disabled={busy || cohort.ready === 0}
                  onClick={() => moveUp([cohort])}
                  className="rounded-full bg-[#FF6600] px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:opacity-90 disabled:opacity-40"
                >
                  {cohort.ready === 0 ? "Nobody ready yet" : `Move up ${cohort.ready} to ${cohort.nextLevel}`}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-300">
                  {cohort.ready} ready
                </span>
                {cohort.blocked > 0 && (
                  <span className="rounded-full bg-amber-50 px-3 py-1 font-semibold text-amber-800 ring-1 ring-inset ring-amber-300">
                    {cohort.blocked} need a look
                  </span>
                )}
                <button onClick={() => toggleOpen(cohort.key)} className="ml-auto font-semibold text-[var(--accent)] underline">
                  {open.has(cohort.key) ? "Hide learners" : `See ${cohort.students.length} learner${cohort.students.length === 1 ? "" : "s"}`}
                </button>
              </div>

              {open.has(cohort.key) && (
                <ul className="divide-y divide-[var(--border)] rounded-2xl bg-[var(--background)] text-sm">
                  {cohort.students.map((student) => (
                    <li key={student.studentId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                      <Link href={`/admin/students/${student.studentId}`} className="font-medium text-[var(--foreground)] hover:underline">
                        {student.name}
                      </Link>
                      {student.verdict.state === "ready" ? (
                        <span className="text-xs font-semibold text-emerald-700">Ready</span>
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
            </section>
          ))}
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
                      {batch.branch} · {batch.level} · {batch.batch} batch — {batch.count} learner{batch.count === 1 ? "" : "s"}
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

        <p className="border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)]">
          Need the individual steps, or to move up someone who still owes on a past level (super admin, with a reason)?{" "}
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
