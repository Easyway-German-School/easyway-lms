"use client";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { AlertIcon, PulseIcon, RefreshIcon } from "@/components/icons";
import type { DbInfraStatus } from "@/lib/db-infra-status";

const card = "rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5";
const usd = (x: number) => `$${x.toFixed(2)}`;

const healthStyle: Record<DbInfraStatus["health"], string> = {
  ok: "border-emerald-300 bg-emerald-50 text-emerald-900",
  warning: "border-amber-300 bg-amber-50 text-amber-900",
  critical: "border-red-300 bg-red-50 text-red-800",
  unknown: "border-[var(--border)] bg-[var(--surface)]",
};

const groupLabel: Record<string, string> = {
  "eduprime-db": "Database (primary + standby)",
  "eduprime-recorder": "Recording workers",
  "eduprime-scheduler": "Recorder schedulers",
  other: "Other",
};

const ago = (seconds: number | null) =>
  seconds === null ? "never" : seconds < 90 ? "just now" : seconds < 5400 ? `${Math.round(seconds / 60)} min ago` : `${Math.round(seconds / 3600)} h ago`;

export default function DbInfraPage() {
  const [status, setStatus] = useState<DbInfraStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/db-infra", { cache: "no-store" });
      const data = (await response.json()) as DbInfraStatus & { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not load database infrastructure status.");
      setStatus(data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load database infrastructure status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [load]);

  return (
    <AdminShell>
      <div className="mx-auto max-w-4xl space-y-6 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Database infrastructure</h1>
            <p className="text-sm text-[var(--muted)]">
              The self-hosted Postgres replacement for Neon — not live on the app yet, this is its own status board.
            </p>
          </div>
          <button onClick={load} disabled={loading} className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold disabled:opacity-50">
            <RefreshIcon /> Refresh
          </button>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
            <AlertIcon /> {error}
          </div>
        )}

        {status && (
          <>
            <div className={`${card} border-2 ${healthStyle[status.health]}`}>
              <div className="flex items-center gap-2 text-lg font-bold">
                <PulseIcon /> {status.headline}
              </div>
              {status.warnings.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                  {status.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className={card}>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-[var(--muted)]">Cluster</h2>
              {status.box ? (
                <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                  <Stat label="Last checked" value={ago(status.box.ageSeconds)} />
                  <Stat label="Postgres (primary)" value={status.box.postgresActive ? "active" : "DOWN"} />
                  <Stat label="PgBouncer (primary)" value={status.box.pgbouncerActive ? "active" : "DOWN"} />
                  <Stat label="Standby replication" value={status.box.standbyReplicationState ?? "unknown"} />
                  <Stat label="Disk used" value={status.box.diskPercentUsed !== null ? `${status.box.diskPercentUsed}%` : "unknown"} />
                  <Stat label="Connections" value={status.box.connections ?? "unknown"} />
                  <Stat label="Last backup" value={status.box.lastBackupAgeHours !== null ? `${status.box.lastBackupAgeHours}h ago` : "unknown"} />
                  <Stat label="WAL archive failures" value={String(status.box.archiverFailedCount ?? "unknown")} />
                </div>
              ) : (
                <p className="text-sm text-[var(--muted)]">No status report yet.</p>
              )}
            </div>

            <div className={card}>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-[var(--muted)]">
                Billing — real Linode spend, every tagged server
              </h2>
              {status.billing?.error ? (
                <p className="text-sm text-amber-800">{status.billing.error}</p>
              ) : status.billing ? (
                <>
                  <p className="mb-3 text-2xl font-bold">
                    {usd(status.billing.totalUsdPerMonth)}
                    <span className="text-sm font-normal text-[var(--muted)]"> / month, at current run-rate</span>
                  </p>
                  <div className="space-y-1 text-sm">
                    {Object.entries(status.billing.byGroup).map(([group, amount]) => (
                      <div key={group} className="flex justify-between">
                        <span>{groupLabel[group] ?? group}</span>
                        <span className="font-semibold">{usd(amount)}/mo</span>
                      </div>
                    ))}
                  </div>
                  <details className="mt-3 text-xs text-[var(--muted)]">
                    <summary className="cursor-pointer">Every server ({status.billing.instances.length})</summary>
                    <div className="mt-2 space-y-1">
                      {status.billing.instances.map((i) => (
                        <div key={i.label} className="flex justify-between">
                          <span>
                            {i.label} ({i.type}, {i.status})
                          </span>
                          <span>{usd(i.usdPerMonth)}/mo</span>
                        </div>
                      ))}
                    </div>
                  </details>
                </>
              ) : (
                <p className="text-sm text-[var(--muted)]">Loading…</p>
              )}
            </div>
          </>
        )}
      </div>
    </AdminShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}
