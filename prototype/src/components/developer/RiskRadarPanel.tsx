"use client";

import { useCallback, useState } from "react";
import type { RecoveryMatch, RiskPrediction } from "@/lib/developer-recovery";

type RadarResult = {
  generatedAt: string;
  windowDays: number;
  patternsExamined: number;
  observations: { incidents: number; userReports: number };
  observationLimitPerSource: number;
  predictions: RiskPrediction[];
  repositoryIndex: {
    issues: number;
    pullRequests: number;
    commits: number;
    generatedAt: string;
  };
};

const card = "min-w-0 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm";

function sourceLabel(source: RecoveryMatch["source"]): string {
  if (source === "incident") return "Incident";
  if (source === "user report") return "User report";
  if (source === "pull request") return "Pull request";
  if (source === "issue") return "Issue";
  return "Commit";
}

function riskStyle(risk: RiskPrediction["risk"]): string {
  if (risk === "high") return "border-red-400/40 bg-red-500/10 text-red-600";
  if (risk === "elevated") return "border-amber-400/40 bg-amber-500/10 text-amber-700";
  return "border-sky-400/40 bg-sky-500/10 text-sky-700";
}

export default function RiskRadarPanel({
  onInvestigate,
  onOpenIncident,
}: {
  onInvestigate: (query: string) => void;
  onOpenIncident: (id: string) => void;
}) {
  const [result, setResult] = useState<RadarResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scan = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/developer/recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "risk-radar" }),
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? `Risk scan failed (HTTP ${response.status}).`);
      setResult(data as RadarResult);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not scan the recorded history.");
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="space-y-4">
      <section className={card}>
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Mission Controls · early warning</p>
            <h2 className="mt-1 text-xl font-bold">Risk radar</h2>
            <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
              This checks recorded incidents and bug reports from the last 90 days, plus active incidents from any date,
              for recurring or accelerating patterns,
              then compares the strongest signals with the repository&apos;s recorded fixes. It shows evidence and a transparent
              risk index—not a promise that a future event will happen.
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void scan()}
            className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Scanning history…" : "Scan for repeat risks"}
          </button>
        </div>
      </section>

      {error && <p role="alert" className="rounded-2xl border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}

      {!result && !busy && !error && (
        <section className={`${card} text-sm text-[var(--muted)]`}>
          Press <strong>Scan for repeat risks</strong> to compare recorded incidents and submitted bug reports against recent activity and past fixes.
        </section>
      )}

      {busy && !result && <p role="status" className="text-sm text-[var(--muted)]">Comparing recent problems with recorded history…</p>}

      {result && (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
            <span>Examined {result.patternsExamined} patterns</span>
            <span>{result.observations.incidents} incidents</span>
            <span>{result.observations.userReports} bug/improvement reports</span>
            <span>
              History index: {result.repositoryIndex.issues} issues · {result.repositoryIndex.pullRequests} pull requests ·{" "}
              {result.repositoryIndex.commits} commits
            </span>
            <span>Scanned {new Date(result.generatedAt).toLocaleString()}</span>
          </div>

          {(result.observations.incidents >= result.observationLimitPerSource ||
            result.observations.userReports >= result.observationLimitPerSource) && (
            <p role="status" className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-xs text-amber-800">
              This scan reached the {result.observationLimitPerSource}-record limit for at least one source. Additional records may
              not be included, so treat these results as a partial view.
            </p>
          )}

          {result.predictions.length === 0 ? (
            <section className={card}>
              <h3 className="font-semibold">No active repeat-risk signals found</h3>
              <p className="mt-1 text-sm text-[var(--muted)]">
                That means this scan found no active incident, recurring resolution, or issue pattern reported at least twice this week
                in the available 90-day records. It does not prove nothing can go wrong; unreported problems and older external support
                history are not in this data.
              </p>
            </section>
          ) : (
            <ul className="space-y-3">
              {result.predictions.map((prediction) => (
                <li key={prediction.id} className={card}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase ${riskStyle(prediction.risk)}`}>
                      {prediction.risk} risk
                    </span>
                    <span className="text-xs font-semibold">Risk index {prediction.score}/100</span>
                    <span className="text-xs text-[var(--muted)]">{prediction.confidence}</span>
                    <span className={`text-xs font-semibold ${prediction.trend === "rising" ? "text-red-600" : "text-[var(--muted)]"}`}>
                      {prediction.trend === "rising" ? "↑ reports rising" : prediction.trend === "cooling" ? "↓ cooling" : "→ steady"}
                    </span>
                  </div>

                  <h3 className="mt-3 break-words text-base font-bold">{prediction.title}</h3>
                  <p className="mt-1 text-sm">{prediction.scenario}</p>

                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
                    <span>{prediction.counts.reports7d} reports in 7 days</span>
                    <span>{prediction.counts.reportsBefore7d} in the previous 23 days</span>
                    <span>{prediction.counts.activeNow} active incidents</span>
                    <span>{prediction.counts.recurrences} recorded returns after resolution</span>
                    <span>{prediction.counts.affectedRoutes} affected routes</span>
                  </div>

                  {prediction.evidence.length > 0 && (
                    <div className="mt-4">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">Evidence from this system</p>
                      <ul className="mt-2 space-y-2">
                        {prediction.evidence.map((item) => (
                          <li key={`${item.source}-${item.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-black/[0.03] p-2.5 text-xs">
                            <span className="font-semibold">{item.source === "incident" ? "Incident" : "User report"}</span>
                            <span className="min-w-0 flex-1 break-words">{item.title}</span>
                            {item.route && <code className="text-[10px] text-[var(--muted)]">{item.route}</code>}
                            <span className="text-[var(--muted)]">{new Date(item.date).toLocaleDateString()}</span>
                            {item.source === "incident" && (
                              <button
                                type="button"
                                onClick={() => onOpenIncident(item.id)}
                                className="font-semibold text-[var(--accent)] underline underline-offset-2"
                              >
                                Open diagnosis
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {prediction.history.length > 0 && (
                    <div className="mt-4">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">Related repository history</p>
                      <ul className="mt-2 space-y-1.5">
                        {prediction.history.map((item) => (
                          <li key={`${item.source}-${item.id}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                            <span className="rounded-full bg-black/5 px-2 py-0.5 font-semibold">{sourceLabel(item.source)}</span>
                            {item.url ? (
                              <a href={item.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 break-words font-medium text-[var(--accent)] underline underline-offset-2">
                                {item.title}
                              </a>
                            ) : (
                              <span className="min-w-0 flex-1 break-words">{item.title}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => onInvestigate(`${prediction.title} ${prediction.evidence[0]?.route ?? ""}`)}
                      className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold"
                    >
                      Investigate this pattern →
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <p className="text-[11px] text-[var(--muted)]">
            Risk index is a heuristic, not a calibrated probability. “Confidence” describes how much historical evidence supports
            the pattern, not certainty about the future. Scanning and investigating are read-only; any repair still needs an admin
            confirmation and is checked by the existing repair flow.
          </p>
        </>
      )}
    </div>
  );
}
