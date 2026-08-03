"use client";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import TwoFactorCard from "@/components/TwoFactorCard";
import { AlertIcon, CheckCircleIcon, RefreshIcon, ShieldIcon } from "@/components/icons";

type AuditEntry = {
  id: string;
  at: string;
  action: string;
  model: string | null;
  recordId: string | null;
  summary: string | null;
  affectedCount: number;
  actorEmail: string | null;
  actorRole: string | null;
  source: string;
  ip: string | null;
  route: string | null;
  severity: string;
  restorable: boolean;
  restoredAt: string | null;
};

type BackupStatus = {
  kind: string;
  label: string;
  lastSuccessAt: string | null;
  hoursSinceSuccess: number | null;
  staleAfterHours: number;
  lastError: string | null;
  state: "ok" | "stale" | "failing" | "never";
};

type BackupRun = {
  id: string;
  kind: string;
  status: string;
  snapshotId: string | null;
  sizeBytes: number | null;
  error: string | null;
  startedAt: string;
};

const STATE_COPY: Record<BackupStatus["state"], { label: string; tone: string }> = {
  ok: { label: "Healthy", tone: "text-emerald-600" },
  stale: { label: "Overdue", tone: "text-red-600" },
  failing: { label: "Last run failed", tone: "text-red-600" },
  never: { label: "Never run", tone: "text-amber-600" },
};

export default function AdminSecurityPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [statuses, setStatuses] = useState<BackupStatus[]>([]);
  const [runs, setRuns] = useState<BackupRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [onlyRestorable, setOnlyRestorable] = useState(false);
  const [modelFilter, setModelFilter] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (onlyRestorable) params.set("restorable", "true");
    if (modelFilter) params.set("model", modelFilter);

    const [auditRes, backupRes] = await Promise.all([
      fetch(`/api/admin/security/audit?${params.toString()}`),
      fetch("/api/admin/security/backups"),
    ]);

    if (auditRes.ok) {
      const data = await auditRes.json();
      setEntries(data.entries || []);
    }
    if (backupRes.ok) {
      const data = await backupRes.json();
      setStatuses(data.statuses || []);
      setRuns(data.recent || []);
    }
    setLoading(false);
  }, [onlyRestorable, modelFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function restore(entry: AuditEntry) {
    const confirmed = window.confirm(
      `Put back ${entry.affectedCount} ${entry.model} record${entry.affectedCount === 1 ? "" : "s"}?\n\n` +
        `Deleted ${new Date(entry.at).toLocaleString()} by ${entry.actorEmail || "unknown"}.\n\n` +
        `This only restores these records. Anything deleted alongside them is a separate entry.`,
    );
    if (!confirmed) return;

    setBusyId(entry.id);
    setMessage("");
    const res = await fetch(`/api/admin/security/audit/${entry.id}`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setMessage(data?.message || (res.ok ? "Restored." : "Could not restore."));
    setBusyId(null);
    load();
  }

  const models = Array.from(
    new Set(entries.map((entry) => entry.model).filter(Boolean) as string[]),
  ).sort();

  return (
    <AdminShell>
      <div className="min-w-0 space-y-8">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold">
            <ShieldIcon />
            Security &amp; recovery
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
            Everything that changed the school&apos;s records, who changed it, and the button that
            puts it back. Deleted records are kept rather than removed, so undoing a mistake here
            does not mean rolling the whole school back to yesterday.
          </p>
        </div>

        {/* ------------------------------------------------------------ */}
        {/* Your own second factor                                        */}
        {/* ------------------------------------------------------------ */}
        {/* First, above backups, because it is the only thing on this page
            that an admin acts on for themselves rather than reads about. */}
        <TwoFactorCard />

        {/* ------------------------------------------------------------ */}
        {/* Backup health                                                 */}
        {/* ------------------------------------------------------------ */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Backups</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {statuses.map((status) => {
              const copy = STATE_COPY[status.state];
              return (
                <div
                  key={status.kind}
                  className="min-w-0 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold">{status.label}</p>
                    <span className={copy.tone}>
                      {status.state === "ok" ? <CheckCircleIcon /> : <AlertIcon />}
                    </span>
                  </div>
                  <p className={`mt-2 text-sm font-semibold ${copy.tone}`}>{copy.label}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {status.lastSuccessAt
                      ? `Last good copy ${status.hoursSinceSuccess}h ago (${new Date(
                          status.lastSuccessAt,
                        ).toLocaleString()})`
                      : "No successful run recorded yet."}
                  </p>
                  {status.lastError ? (
                    <p className="mt-2 break-words text-xs text-red-600">{status.lastError}</p>
                  ) : null}
                </div>
              );
            })}
            {!loading && statuses.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No backup jobs have reported in yet.</p>
            ) : null}
          </div>

          {runs.length > 0 ? (
            <details className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <summary className="cursor-pointer text-sm font-semibold">Recent runs</summary>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-xs">
                  <thead className="text-[var(--muted)]">
                    <tr>
                      <th className="py-2 pr-4">When</th>
                      <th className="py-2 pr-4">Job</th>
                      <th className="py-2 pr-4">Result</th>
                      <th className="py-2 pr-4">Size</th>
                      <th className="py-2">Snapshot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => (
                      <tr key={run.id} className="border-t border-[var(--border)]">
                        <td className="py-2 pr-4">{new Date(run.startedAt).toLocaleString()}</td>
                        <td className="py-2 pr-4">{run.kind}</td>
                        <td
                          className={`py-2 pr-4 font-semibold ${
                            run.status === "success" ? "text-emerald-600" : "text-red-600"
                          }`}
                        >
                          {run.status}
                        </td>
                        <td className="py-2 pr-4">
                          {run.sizeBytes ? `${(run.sizeBytes / 1_048_576).toFixed(1)} MB` : "—"}
                        </td>
                        <td className="py-2 font-mono">{run.snapshotId?.slice(0, 12) || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </section>

        {/* ------------------------------------------------------------ */}
        {/* Audit trail                                                   */}
        {/* ------------------------------------------------------------ */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Activity trail</h2>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={onlyRestorable}
                  onChange={(event) => setOnlyRestorable(event.target.checked)}
                />
                <span>Only what can be put back</span>
              </label>
              <select
                value={modelFilter}
                onChange={(event) => setModelFilter(event.target.value)}
                className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              >
                <option value="">All records</option>
                {models.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={load}
                className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold"
              >
                <RefreshIcon />
                Refresh
              </button>
            </div>
          </div>

          {message ? (
            <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
              {message}
            </p>
          ) : null}

          <div className="overflow-x-auto rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">What happened</th>
                  <th className="px-4 py-3">Who</th>
                  <th className="px-4 py-3">From</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-t border-[var(--border)] align-top">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-[var(--muted)]">
                      {new Date(entry.at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          entry.severity === "alert"
                            ? "font-semibold text-red-600"
                            : entry.severity === "notice"
                              ? "font-semibold text-amber-600"
                              : ""
                        }
                      >
                        {entry.summary || `${entry.action} ${entry.model ?? ""}`}
                      </span>
                      {entry.restoredAt ? (
                        <span className="ml-2 text-xs text-emerald-600">
                          restored {new Date(entry.restoredAt).toLocaleDateString()}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className="break-all">{entry.actorEmail || "—"}</div>
                      <div className="text-[var(--muted)]">{entry.actorRole || entry.source}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--muted)]">
                      <div>{entry.ip || "—"}</div>
                      <div className="break-all">{entry.route || ""}</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {entry.restorable ? (
                        <button
                          type="button"
                          disabled={busyId === entry.id}
                          onClick={() => restore(entry)}
                          className="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {busyId === entry.id ? "Restoring…" : "Put back"}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {!loading && entries.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                      Nothing recorded yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AdminShell>
  );
}
