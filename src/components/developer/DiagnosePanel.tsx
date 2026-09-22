"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Finding, RepairOffer } from "@/lib/diagnose";

type StudentHit = { id: string; studentCode: string | null; level: string; name: string | null; email: string };
type DiagnosisResult = {
  student: { id: string; name: string | null; email: string; studentCode: string | null; level: string };
  diagnosis: { findings: Finding[]; rulesRun: number; ruleErrors: Array<{ rule: string; error: string }> };
  paystack: { checked: boolean; emailChecked?: string; error?: string; transactionsSeen?: number };
  verdictKey: string;
};
type Outcome = { ok: boolean; verified: boolean; message: string; after?: DiagnosisResult };

export type DiagnoseTarget = { studentId?: string; userId?: string } | null;

const card = "min-w-0 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm";
const SEVERITY = {
  problem: { dot: "bg-red-500", ring: "border-red-400/50", label: "Problem", text: "text-red-500" },
  warning: { dot: "bg-amber-500", ring: "border-amber-400/50", label: "Worth a look", text: "text-amber-600" },
  info: { dot: "bg-sky-500", ring: "border-sky-400/40", label: "Explained", text: "text-sky-600" },
} as const;

const RULE_NAMES = [
  "Paystack has a payment we did not record",
  "Account missing its school (tenant) link",
  "Their screen out of sync with the database",
  "No student ID",
  "Why the portal is locked",
];

export default function DiagnosePanel({ target, onTargetUsed }: { target: DiagnoseTarget; onTargetUsed: () => void }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<StudentHit[]>([]);
  const [result, setResult] = useState<DiagnosisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null); // offer key awaiting confirmation
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      setResult(await response.json());
      setHits([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }, []);

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

  async function repair(offer: RepairOffer) {
    if (!result) return;
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
      if (data.after) setResult(data.after);
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
        <h2 className="text-base font-bold">Diagnose a student</h2>
        <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">
          When a student complains, find out what is actually wrong. This runs a fixed set of rules against their real records — no
          guessing, no AI — shows the evidence for every finding, and offers a repair only where one is safe. Nothing changes until you
          click, and every repair is checked afterwards and written to the audit trail.
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
                  Run again
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
                That means these {result.diagnosis.rulesRun} checks came back clean — <strong>not</strong> that nothing is wrong. It cannot see a bug in the
                code, or a problem none of these rules cover:
              </p>
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-[var(--muted)]">
                {RULE_NAMES.map((n) => <li key={n}>{n}</li>)}
              </ul>
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
                                        <button type="button" disabled={busy} onClick={() => repair(offer)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white">Yes, do it</button>
                                        <button type="button" onClick={() => setConfirming(null)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold">Cancel</button>
                                      </div>
                                    </>
                                  ) : (
                                    <button type="button" disabled={busy} onClick={() => setConfirming(key)} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white">
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
        </>
      )}
    </div>
  );
}
