"use client";

import { useCallback, useEffect, useState } from "react";
import type { RecoveryMatch } from "@/lib/developer-recovery";

type RecoveryResult = {
  matches: RecoveryMatch[];
  indexed: {
    matchingIncidents: number;
    matchingUserReports: number;
    issues: number;
    pullRequests: number;
    commits: number;
    repositoryGeneratedAt: string;
  };
};

const card = "min-w-0 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm";

async function loadRecoveryMatches(query: string, signal?: AbortSignal): Promise<RecoveryResult> {
  const response = await fetch("/api/admin/developer/recovery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    ...(signal ? { signal } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `Could not search recovery history (HTTP ${response.status}).`);
  return data as RecoveryResult;
}

function sourceLabel(source: RecoveryMatch["source"]): string {
  if (source === "incident") return "Incident";
  if (source === "user report") return "User report";
  if (source === "pull request") return "Pull request";
  if (source === "issue") return "Issue";
  return "Commit";
}

export default function RecoveryPanel({
  initialQuery,
  onOpenIncident,
}: {
  initialQuery: string;
  onOpenIncident: (id: string) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [result, setResult] = useState<RecoveryResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoSearching = initialQuery.trim().length >= 3 && !result && !error;

  const search = useCallback(async (value: string) => {
    if (value.trim().length < 3) {
      setError("Describe the problem in at least 3 characters.");
      setResult(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(await loadRecoveryMatches(value));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not search recovery history.");
      setResult(null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!initialQuery) return;
    const controller = new AbortController();
    let active = true;
    void loadRecoveryMatches(initialQuery, controller.signal)
      .then((data) => {
        if (active) setResult(data);
      })
      .catch((cause) => {
        if (active && !controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Could not search recovery history.");
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [initialQuery]);

  return (
    <div className="space-y-4">
      <section className={card}>
        <h2 className="text-base font-bold">Search past problems and fixes</h2>
        <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">
          Search recorded incidents and scrubbed user reports alongside repository issues, merged pull requests, and commits.
          Similarity is based on matching problem language and common technical equivalents; repository records link to source and incidents can be opened.
        </p>
        <form
          className="mt-4 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            void search(query);
          }}
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={500}
            placeholder="Describe the error, what the user saw, or where it happened…"
            aria-label="Problem to search for"
            className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm"
          />
          <button
            type="submit"
            disabled={busy || autoSearching || query.trim().length < 3}
            className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy || autoSearching ? "Searching…" : "Find similar"}
          </button>
        </form>
        <p className="mt-3 text-xs text-[var(--muted)]">
          Search suggests documented history; it does not edit or deploy code. For data corrections, open the incident and use
          Diagnose &amp; fix, which rechecks the evidence and requires an admin action.
        </p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          External support chats and files are not included; only repository history and reports already stored in this app are searched.
        </p>
      </section>

      {error && <p role="alert" className="rounded-2xl border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}

      {result && (
        <>
          <p className="text-xs text-[var(--muted)]">
            {result.indexed.matchingIncidents} matching incidents · {result.indexed.matchingUserReports} matching user reports · repository snapshot from{" "}
            {new Date(result.indexed.repositoryGeneratedAt).toLocaleDateString()}: {result.indexed.issues} issues,{" "}
            {result.indexed.pullRequests} pull requests and {result.indexed.commits} commits
          </p>
          {result.matches.length === 0 ? (
            <div className={`${card} text-sm text-[var(--muted)]`}>
              No close match was found. Check the incident list or add a clear resolution note when this problem is fixed so it can help next time.
            </div>
          ) : (
            <ul className="space-y-3">
              {result.matches.map((match) => (
                <li key={`${match.source}-${match.id}`} className={card}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-black/5 px-2.5 py-1 text-[11px] font-semibold">{sourceLabel(match.source)}</span>
                    <span className={`text-[11px] font-semibold ${match.match === "strong" ? "text-emerald-600" : "text-amber-600"}`}>
                      {match.match === "strong" ? "Strong match" : "Related"} · {match.score}%
                    </span>
                    {match.status && <span className="text-[11px] text-[var(--muted)]">{match.status}</span>}
                    {typeof match.occurrences === "number" && <span className="text-[11px] text-[var(--muted)]">×{match.occurrences}</span>}
                    {(match.reopenedCount ?? 0) > 0 && (
                      <span className="text-[11px] font-semibold text-red-500">recurred {match.reopenedCount}×</span>
                    )}
                  </div>
                  <h3 className="mt-2 break-words text-sm font-bold">{match.title}</h3>
                  {match.resolutionNote ? (
                    <div className="mt-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">Recorded resolution</p>
                      <p className="mt-1 whitespace-pre-wrap break-words">{match.resolutionNote}</p>
                    </div>
                  ) : match.detail ? (
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm text-[var(--muted)]">{match.detail}</p>
                  ) : (
                    <p className="mt-2 text-sm text-[var(--muted)]">No resolution was recorded for this incident.</p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                    <span className="text-[var(--muted)]">{new Date(match.date).toLocaleDateString()}</span>
                    {match.source === "incident" ? (
                      <button
                        type="button"
                        onClick={() => onOpenIncident(match.id)}
                        className="font-semibold text-[var(--accent)] underline underline-offset-2"
                      >
                        Open incident and diagnosis
                      </button>
                    ) : match.url ? (
                      <a
                        href={match.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-[var(--accent)] underline underline-offset-2"
                      >
                        Open source record
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
