"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import LevelHistoryManager from "@/components/admin/LevelHistoryManager";
import type { Finding, RepairId, RepairOffer } from "@/lib/diagnose";

type StudentHit = { id: string; studentCode: string | null; level: string; name: string | null; email: string };
type DiagnosisResult = {
  checkedAt: string;
  student: { id: string; name: string | null; email: string; studentCode: string | null; level: string };
  diagnosis: { findings: Finding[]; rulesRun: number; ruleErrors: Array<{ rule: string; error: string }> };
  paystack: { checked: boolean; emailChecked?: string; error?: string; transactionsSeen?: number };
  verdictKey: string;
};
type Outcome = { ok: boolean; verified: boolean; message: string; after?: DiagnosisResult };
type ScanProgress = { scanned: number; total: number };
type ScanFailure = { studentId: string; error: string };
type BatchRepairOutcome = {
  studentId: string;
  repairId: RepairId;
  outcome: Outcome;
};

export type DiagnoseTarget = { studentId?: string; userId?: string } | null;

const card = "min-w-0 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm";
const SEVERITY = {
  problem: { dot: "bg-red-500", ring: "border-red-400/50", label: "Problem", text: "text-red-500" },
  warning: { dot: "bg-amber-500", ring: "border-amber-400/50", label: "Worth a look", text: "text-amber-600" },
  info: { dot: "bg-sky-500", ring: "border-sky-400/40", label: "Explained", text: "text-sky-600" },
} as const;

const BATCHABLE_REPAIRS = new Set<RepairId>(["sync_tuition_charge", "assign_student_code"]);
const BATCH_SIZE = 10;

export default function DiagnosePanel({ target, onTargetUsed }: { target: DiagnoseTarget; onTargetUsed: () => void }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<StudentHit[]>([]);
  const [result, setResult] = useState<DiagnosisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null); // offer key awaiting confirmation
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [snapshotStale, setSnapshotStale] = useState(false);
  const [scanRows, setScanRows] = useState<DiagnosisResult[]>([]);
  const [scanFailures, setScanFailures] = useState<ScanFailure[]>([]);
  const [scanState, setScanState] = useState<"idle" | "running" | "done">("idle");
  const [scanProgress, setScanProgress] = useState<ScanProgress>({ scanned: 0, total: 0 });
  const [scanError, setScanError] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const [batchOutcomes, setBatchOutcomes] = useState<BatchRepairOutcome[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanAbort = useRef<AbortController | null>(null);

  const diagnose = useCallback(async (studentId: string, opts: { deep?: boolean; references?: string[] } = {}) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/developer/diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, deep: opts.deep === true, references: opts.references ?? [] }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? `HTTP ${response.status}`);
      setResult((await response.json()) as DiagnosisResult);
      setSnapshotStale(false);
      setHits([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!result) return;
    const markSnapshotStale = () => {
      if (document.visibilityState !== "visible") return;
      setSnapshotStale(true);
      setConfirming(null);
    };
    window.addEventListener("focus", markSnapshotStale);
    document.addEventListener("visibilitychange", markSnapshotStale);
    return () => {
      window.removeEventListener("focus", markSnapshotStale);
      document.removeEventListener("visibilitychange", markSnapshotStale);
    };
  }, [result]);

  // A complaint or drift incident hands us somebody to look at.
  useEffect(() => {
    if (!target) return;
    (async () => {
      let studentId = target.studentId;
      if (!studentId && target.userId) {
        const r = await fetch(`/api/admin/developer/diagnose?userId=${encodeURIComponent(target.userId)}`);
        studentId = (await r.json().catch(() => ({}))).studentId ?? undefined;
      }
      if (studentId) await diagnose(studentId);
      else setError("That account is not a student, so there is nothing to diagnose.");
      onTargetUsed();
    })();
  }, [target, diagnose, onTargetUsed]);

  function onSearch(value: string) {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    if (value.trim().length < 2) return setHits([]);
    timer.current = setTimeout(async () => {
      const r = await fetch(`/api/admin/developer/diagnose?q=${encodeURIComponent(value.trim())}`);
      if (r.ok) setHits((await r.json()).students ?? []);
    }, 300);
  }

  async function scanSchool() {
    if (scanState === "running") {
      scanAbort.current?.abort();
      return;
    }

    const controller = new AbortController();
    scanAbort.current = controller;
    setScanState("running");
    setScanProgress({ scanned: 0, total: 0 });
    setScanRows([]);
    setScanFailures([]);
    setScanError(null);
    setBatchMessage(null);
    setBatchOutcomes([]);

    let cursor: string | null = null;
    let scanned = 0;
    let total = 0;
    try {
      do {
        const response = await fetch("/api/admin/developer/diagnose/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cursor }),
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);

        const page = payload as {
          students: DiagnosisResult[];
          errors: ScanFailure[];
          scanned: number;
          total: number;
          nextCursor: string | null;
        };
        scanned += page.scanned;
        total = page.total;
        cursor = page.nextCursor;
        setScanRows((current) => [...current, ...page.students]);
        setScanFailures((current) => [...current, ...page.errors]);
        setScanProgress({ scanned, total });
      } while (cursor);
      setScanState("done");
    } catch (e) {
      if (!controller.signal.aborted) {
        setScanError(e instanceof Error ? e.message : "The school-wide scan could not finish.");
      }
      setScanState("idle");
    } finally {
      if (scanAbort.current === controller) scanAbort.current = null;
    }
  }

  const batchRepairs = scanRows.flatMap((student) =>
    student.diagnosis.findings.flatMap((finding) =>
      finding.offers
        .filter((offer) => BATCHABLE_REPAIRS.has(offer.id))
        .map((offer) => ({ studentId: student.student.id, repairId: offer.id })),
    ),
  );
  const uniqueBatchRepairs = [...new Map(batchRepairs.map((repair) => [`${repair.studentId}:${repair.repairId}`, repair])).values()];

  async function repairAllSafe() {
    if (batchBusy || uniqueBatchRepairs.length === 0) return;
    setBatchBusy(true);
    setScanError(null);
    setBatchMessage(null);
    setBatchOutcomes([]);
    setBatchProgress(0);
    let fixed = 0;
    let needsReview = 0;
    let completed = 0;
    try {
      for (let start = 0; start < uniqueBatchRepairs.length; start += BATCH_SIZE) {
        const items = uniqueBatchRepairs.slice(start, start + BATCH_SIZE);
        const response = await fetch("/api/admin/developer/repair/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);

        const results = payload.results as BatchRepairOutcome[];
        fixed += results.filter((result) => result.outcome.ok && result.outcome.verified).length;
        needsReview += results.filter((result) => !result.outcome.ok || !result.outcome.verified).length;
        completed += results.length;
        setBatchOutcomes((current) => [...current, ...results]);
        setBatchProgress(completed);
        setScanRows((current) => {
          const updated = new Map(results.flatMap((result) => result.outcome.after
            ? [[result.studentId, result.outcome.after] as const]
            : []));
          return current
            .map((student) => updated.get(student.student.id) ?? student)
            .filter((student) =>
              student.diagnosis.ruleErrors.length > 0 ||
              student.diagnosis.findings.some((finding) => finding.severity !== "info"),
            );
        });
      }
      setBatchMessage(
        `${fixed} repair${fixed === 1 ? "" : "s"} verified${needsReview ? `; ${needsReview} need${needsReview === 1 ? "s" : ""} review` : ""}.`,
      );
    } catch (e) {
      const reason = e instanceof Error ? e.message : "The batch repair could not finish.";
      setScanError(`Batch repair stopped after ${completed} of ${uniqueBatchRepairs.length} items: ${reason}`);
    } finally {
      setBatchBusy(false);
    }
  }

  async function repair(offer: RepairOffer) {
    if (!result || snapshotStale) return;
    setBusy(true);
    setError(null);
    setConfirming(null);
    try {
      const response = await fetch("/api/admin/developer/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: result.student.id, repairId: offer.id, params: offer.params }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setOutcome(data);
      if (data.after) {
        setResult(data.after);
        setSnapshotStale(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "The repair could not run.");
    } finally {
      setBusy(false);
    }
  }

  const problems = result?.diagnosis.findings.filter((f) => f.severity === "problem").length ?? 0;

  return (
    <div className="space-y-6">
      <section className={card}>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold">Scan the whole school</h2>
            <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">
              Check student access, class sitting, tutor assignment and private-session setup across the school. The scan is
              read-only and shows every student with a problem or warning; active live-room checks run in an individual diagnosis.
            </p>
          </div>
          <button
            type="button"
            disabled={batchBusy}
            onClick={() => void scanSchool()}
            className="rounded-xl bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            {scanState === "running" ? "Stop scan" : scanState === "done" ? "Scan again" : "Scan all students"}
          </button>
        </div>
        {scanState === "running" && (
          <p className="mt-3 text-xs text-[var(--muted)]" role="status">
            Checked {scanProgress.scanned}{scanProgress.total ? ` of ${scanProgress.total}` : ""} students…
          </p>
        )}
        {scanState === "done" && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
            <p role="status" className="text-[var(--muted)]">
              Scan complete: {scanProgress.scanned} of {scanProgress.total} students checked; {scanRows.length} need attention
              {scanFailures.length ? `; ${scanFailures.length} could not be checked` : ""}.
            </p>
            {uniqueBatchRepairs.length > 0 && (
              <button
                type="button"
                disabled={batchBusy}
                onClick={() => void repairAllSafe()}
                className="rounded-xl bg-emerald-600 px-3 py-2 font-semibold text-white disabled:opacity-50"
              >
                {batchBusy
                  ? `Repairing ${batchProgress} of ${uniqueBatchRepairs.length}…`
                  : `Fix ${uniqueBatchRepairs.length} safe record issue${uniqueBatchRepairs.length === 1 ? "" : "s"}`}
              </button>
            )}
          </div>
        )}
        <p className="mt-2 text-xs text-[var(--muted)]">
          Bulk repair only syncs tuition/enrolment records or issues missing student IDs. It does not create payment records,
          change or waive balances, and does not contact Paystack. Run an individual deep check to compare payments with Paystack.
        </p>
        {scanError && <p className="mt-3 rounded-xl border border-red-400/40 bg-red-500/10 p-3 text-xs text-red-500">{scanError}</p>}
        {batchMessage && <p className="mt-3 rounded-xl border border-emerald-400/40 bg-emerald-500/10 p-3 text-xs text-emerald-700">{batchMessage}</p>}
        {batchOutcomes.some((result) => !result.outcome.ok || !result.outcome.verified) && (
          <ul className="mt-3 space-y-1 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-xs text-amber-700">
            {batchOutcomes
              .filter((result) => !result.outcome.ok || !result.outcome.verified)
              .map((result) => (
                <li key={`${result.studentId}:${result.repairId}`}>
                  {result.studentId} · {result.repairId}: {result.outcome.message}
                </li>
              ))}
          </ul>
        )}
        {scanRows.length > 0 && (
          <div className="mt-4 space-y-3">
            {scanRows.map((student) => (
              <article key={student.student.id} className="rounded-2xl border border-[var(--border)] p-3">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{student.student.name ?? student.student.email}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {student.student.email} · {student.student.studentCode ?? "no student ID"} · {student.student.level}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setResult(student);
                      setOutcome(null);
                      setSnapshotStale(false);
                    }}
                    className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold"
                  >
                    Open diagnosis
                  </button>
                </div>
                <ul className="mt-2 space-y-1">
                  {student.diagnosis.findings
                    .filter((finding) => finding.severity !== "info")
                    .map((finding) => (
                      <li key={finding.rule} className="text-xs">
                        <span className={finding.severity === "problem" ? "font-semibold text-red-500" : "font-semibold text-amber-600"}>
                          {finding.title}
                        </span>
                        <span className="text-[var(--muted)]">
                          {finding.offers.some((offer) => BATCHABLE_REPAIRS.has(offer.id)) ? " · safe bulk fix available" : " · review individually"}
                        </span>
                      </li>
                    ))}
                  {student.diagnosis.ruleErrors.map((ruleError) => (
                    <li key={ruleError.rule} className="text-xs font-semibold text-amber-600">
                      {ruleError.rule} could not be checked: {ruleError.error}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        )}
        {scanFailures.length > 0 && (
          <section className="mt-4 rounded-2xl border border-amber-400/40 bg-amber-500/10 p-3">
            <h3 className="text-xs font-bold text-amber-700">Some records could not be checked</h3>
            <ul className="mt-2 space-y-1 text-xs text-amber-700">
              {scanFailures.map((failure) => (
                <li key={failure.studentId}>{failure.studentId}: {failure.error}</li>
              ))}
            </ul>
          </section>
        )}
        {scanState === "done" && scanRows.length === 0 && scanFailures.length === 0 && (
          <p className="mt-3 text-sm font-semibold text-emerald-600">No problem or warning findings in the current checks.</p>
        )}
      </section>

      <section className={card}>
        <h2 className="text-base font-bold">Diagnose a student</h2>
        <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">
          When a student complains, check payments, portal access, schedule settings, tutor assignments, private bookings and the
          tutor&apos;s current live room. This runs fixed rules against real records — no guessing, no AI — and shows the evidence.
          Class and schedule findings are guidance only; they never change student or tutor records automatically.
        </p>
        <div className="relative mt-4">
          <input
            value={query}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search by name, email or student ID…"
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm sm:max-w-md"
          />
          {hits.length > 0 && (
            <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-lg sm:max-w-md">
              {hits.map((h) => (
                <li key={h.id}>
                  <button type="button" onClick={() => { setQuery(""); setOutcome(null); diagnose(h.id); }} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-black/5">
                    <span className="min-w-0 flex-1 truncate font-medium">{h.name ?? h.email}</span>
                    <span className="shrink-0 text-xs text-[var(--muted)]">{h.studentCode ?? "no ID"} · {h.level}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {error && <p className="rounded-2xl border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}

      {outcome && (
        <div className={`rounded-2xl border p-4 text-sm ${outcome.ok && outcome.verified ? "border-emerald-400/40 bg-emerald-500/10" : outcome.ok ? "border-amber-400/40 bg-amber-500/10" : "border-red-400/40 bg-red-500/10"}`}>
          <p className="font-bold">{outcome.ok && outcome.verified ? "Fixed and checked" : outcome.ok ? "Done, but check it" : "Not done"}</p>
          <p className="mt-1">{outcome.message}</p>
        </div>
      )}

      {result && (
        <>
          <section className={card}>
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-bold">{result.student.name ?? result.student.email}</p>
                <p className="text-xs text-[var(--muted)]">{result.student.email} · {result.student.studentCode ?? "no student ID"} · {result.student.level}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => { setOutcome(null); diagnose(result.student.id); }} className="rounded-xl border border-[var(--border)] px-3 py-1.5 text-xs font-semibold">
                  Refresh records
                </button>
                <button type="button" disabled={busy} onClick={() => { setOutcome(null); diagnose(result.student.id, { deep: true }); }} className="rounded-xl bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white">
                  {busy ? "Working…" : "Deep check — ask Paystack"}
                </button>
              </div>
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">
              {result.paystack.checked
                ? `Paystack was asked about ${result.paystack.emailChecked} and reported ${result.paystack.transactionsSeen} successful payment${result.paystack.transactionsSeen === 1 ? "" : "s"}.`
                : result.paystack.error
                  ? `Paystack could not be checked: ${result.paystack.error}`
                  : "Paystack has not been asked. The deep check is read-only — it looks at what they paid there and compares it with what we recorded."}
            </p>
            {snapshotStale && (
              <p role="status" className="mt-3 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-xs text-amber-700">
                This diagnosis is a snapshot and may no longer match live records. Refresh records before relying on findings or running a repair.
              </p>
            )}
            {result.checkedAt && (
              <p className="mt-1 text-xs text-[var(--muted)]">
                Records checked {new Date(result.checkedAt).toLocaleString()}.
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Paystack reference from their receipt (optional)"
                className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs sm:max-w-sm"
              />
              <button type="button" disabled={busy || reference.trim().length < 4} onClick={() => { setOutcome(null); diagnose(result.student.id, { deep: true, references: [reference.trim()] }); }} className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold">
                Check this reference
              </button>
            </div>
          </section>

          {result.diagnosis.findings.length === 0 ? (
            <section className={card}>
              <p className="text-sm font-bold text-emerald-600">The rules found nothing wrong.</p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                That means these {result.diagnosis.rulesRun} current-record checks came back clean — <strong>not</strong> that nothing is wrong.
                This diagnosis does not inspect application code or contact Paystack unless you run the deep check:
              </p>
              {!result.paystack.checked && <p className="mt-2 text-xs text-amber-600">The first check only runs on a deep check — try that if they say they paid.</p>}
            </section>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-[var(--muted)]">{result.diagnosis.findings.length} finding{result.diagnosis.findings.length === 1 ? "" : "s"}{problems ? `, ${problems} that need attention` : ""} · {result.diagnosis.rulesRun} rules run</p>
              {result.diagnosis.findings.map((f) => {
                const tone = SEVERITY[f.severity];
                return (
                  <article key={f.rule} className={`${card} border ${tone.ring}`}>
                    <div className="flex items-start gap-3">
                      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${tone.dot}`} />
                      <div className="min-w-0 flex-1">
                        <p className={`text-[10px] font-bold uppercase tracking-[0.16em] ${tone.text}`}>{tone.label}</p>
                        <h3 className="mt-0.5 text-base font-bold">{f.title}</h3>
                        <p className="mt-2 whitespace-pre-line text-sm text-[var(--muted)]">{f.detail}</p>

                        <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                          {f.evidence.map((e, i) => (
                            <div key={i} className="flex justify-between gap-3 border-b border-[var(--border)] py-1">
                              <dt className="text-[var(--muted)]">{e.label}</dt>
                              <dd className="min-w-0 truncate text-right font-medium">{e.value}</dd>
                            </div>
                          ))}
                        </dl>

                        {f.offers.length === 0 ? (
                          <p className="mt-3 text-xs text-[var(--muted)]">No one-click repair for this — it needs a person&apos;s judgement.</p>
                        ) : (
                          <div className="mt-4 space-y-2">
                            {f.offers.map((offer) => {
                              const key = `${offer.id}:${offer.params.reference ?? ""}`;
                              return (
                                <div key={key} className="rounded-2xl border border-[var(--border)] p-3">
                                  {confirming === key ? (
                                    <>
                                      <p className="text-xs"><strong>This will:</strong> {offer.preview}</p>
                                      <div className="mt-2 flex gap-2">
                                        <button type="button" disabled={busy || snapshotStale} onClick={() => repair(offer)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white">Yes, do it</button>
                                        <button type="button" onClick={() => setConfirming(null)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold">Cancel</button>
                                      </div>
                                    </>
                                  ) : (
                                    <button type="button" disabled={busy || snapshotStale} onClick={() => setConfirming(key)} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white">
                                      {offer.label}
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {result.diagnosis.ruleErrors.length > 0 && (
            <p className="text-xs text-amber-600">{result.diagnosis.ruleErrors.length} check(s) could not run ({result.diagnosis.ruleErrors.map((e) => e.rule).join(", ")}) — the findings above are still valid, but incomplete.</p>
          )}
          <LevelHistoryManager key={result.student.id} studentId={result.student.id} currentLevel={result.student.level} />
        </>
      )}
    </div>
  );
}
