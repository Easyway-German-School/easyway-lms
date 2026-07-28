"use client";

import { useEffect, useState, useRef } from "react";
import AdminShell from "@/components/AdminShell";

interface ActionResult {
  success: boolean;
  message: string;
  details?: unknown;
  data?: unknown;
}

interface ConnectorConfig {
  id: string;
  name: string;
  description: string;
  docsUrl: string;
  configured: boolean;
  connectionUrl?: string;
  config: Array<{ key: string; value: string | null }>;
  testResult?: ActionResult;
  dataResult?: ActionResult;
  syncResult?: ActionResult;
}

interface SyncStatus {
  connectorId: string;
  status: 'idle' | 'syncing' | 'error';
  lastSync?: Date;
  nextSync?: Date;
  errorMessage?: string;
  itemsSync?: number;
}

interface IntegrationsResponse {
  connectors: ConnectorConfig[];
}

export default function AdminIntegrationsPage() {
  const [connectors, setConnectors] = useState<ConnectorConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncStatuses, setSyncStatuses] = useState<Record<string, SyncStatus>>({});
  const [loadingById, setLoadingById] = useState<Record<string, boolean>>({});
  const statusCheckInterval = useRef<NodeJS.Timeout | null>(null);

  // Load connectors on mount
  useEffect(() => {
    async function loadConnectors() {
      try {
        const res = await fetch("/api/admin/integrations");
        if (!res.ok) throw new Error("Failed to load integrations");
        const data: IntegrationsResponse = await res.json();
        setConnectors(data.connectors || []);
        setError(null);
        
        // Initialize auto-sync for each connector
        for (const connector of data.connectors || []) {
          initializeConnectorSync(connector.id);
        }
      } catch (err) {
        console.error(err);
        setError("Unable to load integration connectors.");
      } finally {
        setLoading(false);
      }
    }

    loadConnectors();

    return () => {
      if (statusCheckInterval.current) {
        clearInterval(statusCheckInterval.current);
      }
    };
  }, []);

  // Periodically check sync status
  useEffect(() => {
    statusCheckInterval.current = setInterval(() => {
      checkAllSyncStatuses();
    }, 5000); // Check every 5 seconds

    return () => {
      if (statusCheckInterval.current) {
        clearInterval(statusCheckInterval.current);
      }
    };
  }, []);

  async function initializeConnectorSync(connectorId: string) {
    try {
      const res = await fetch("/api/admin/integrations/sync-init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectorId, autoSync: true, intervalMinutes: 30 }),
      });

      if (!res.ok) throw new Error("Failed to initialize sync");
      const data = await res.json();
      setSyncStatuses((prev) => ({
        ...prev,
        [connectorId]: data.status || { connectorId, status: 'idle' },
      }));
    } catch (err) {
      console.error(`Failed to initialize sync for ${connectorId}:`, err);
      setSyncStatuses((prev) => ({
        ...prev,
        [connectorId]: { connectorId, status: 'error', errorMessage: 'Failed to initialize auto-sync' },
      }));
    }
  }

  async function checkAllSyncStatuses() {
    try {
      const res = await fetch("/api/admin/integrations/sync-status");
      if (!res.ok) return;
      const data = await res.json();
      setSyncStatuses(data.statuses || {});
    } catch (err) {
      console.error("Failed to check sync statuses:", err);
    }
  }

  async function forceSync(connectorId: string) {
    try {
      const res = await fetch("/api/admin/integrations/sync-force", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectorId }),
      });

      if (!res.ok) throw new Error("Failed to force sync");
      await checkAllSyncStatuses();
    } catch (err) {
      console.error(`Failed to force sync for ${connectorId}:`, err);
    }
  }

  async function handleTestConnector(connectorId: string) {
    setLoadingById((prev) => ({ ...prev, [connectorId]: true }));
    try {
      const res = await fetch(`/api/admin/integrations?connectorId=${encodeURIComponent(connectorId)}`);
      const result: ActionResult = await res.json();
      setConnectors((prev) => prev.map((c) => (c.id === connectorId ? { ...c, testResult: result } : c)));
    } catch {
      setConnectors((prev) => prev.map((c) => (c.id === connectorId ? { ...c, testResult: { success: false, message: "Test request failed." } } : c)));
    } finally {
      setLoadingById((prev) => ({ ...prev, [connectorId]: false }));
    }
  }

  async function handleFetchConnectorData(connectorId: string) {
    setLoadingById((prev) => ({ ...prev, [connectorId]: true }));
    try {
      const res = await fetch(`/api/admin/integrations?connectorId=${encodeURIComponent(connectorId)}&action=data`);
      const result: ActionResult = await res.json();
      setConnectors((prev) => prev.map((c) => (c.id === connectorId ? { ...c, dataResult: result } : c)));
    } catch {
      setConnectors((prev) => prev.map((c) => (c.id === connectorId ? { ...c, dataResult: { success: false, message: "Data fetch failed." } } : c)));
    } finally {
      setLoadingById((prev) => ({ ...prev, [connectorId]: false }));
    }
  }

  async function handleSyncConnector(connectorId: string) {
    setLoadingById((prev) => ({ ...prev, [connectorId]: true }));
    try {
      const res = await fetch(`/api/admin/integrations?connectorId=${encodeURIComponent(connectorId)}&action=sync`, {
        method: "POST",
      });
      const result: ActionResult = await res.json();
      setConnectors((prev) => prev.map((c) => (c.id === connectorId ? { ...c, syncResult: result } : c)));
      await checkAllSyncStatuses();
    } catch {
      setConnectors((prev) => prev.map((c) => (c.id === connectorId ? { ...c, syncResult: { success: false, message: "Sync request failed." } } : c)));
    } finally {
      setLoadingById((prev) => ({ ...prev, [connectorId]: false }));
    }
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'syncing':
        return '#3b82f6'; // blue
      case 'error':
        return '#ef4444'; // red
      case 'idle':
        return '#10b981'; // green
      default:
        return '#6b7280'; // gray
    }
  }

  function formatTime(date?: Date): string {
    if (!date) return 'Never';
    const now = new Date();
    const diff = (now.getTime() - new Date(date).getTime()) / 1000;
    if (diff < 60) return `${Math.floor(diff)}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(date).toLocaleDateString();
  }

  return (
    <AdminShell>
      <div className="p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Admin Integrations</p>
            <h1 className="text-3xl font-bold">External LMS & Community Connectors</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">Configure external systems like Moodle, Canvas, Discourse, or Open edX here.</p>
          </div>
        </div>

        {loading ? (
          <div className="rounded-3xl bg-[var(--surface)] p-6">Loading connectors…</div>
        ) : error ? (
          <div className="rounded-3xl bg-red-100 p-6 text-red-700">{error}</div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            {connectors.map((connector) => (
              <div key={connector.id} className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold">{connector.name}</h2>
                    <p className="mt-2 text-sm text-[var(--muted)]">{connector.description}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${connector.configured ? "bg-emerald-100 text-emerald-700" : "bg-yellow-100 text-yellow-700"}`}>
                    {connector.configured ? "Configured" : "Not configured"}
                  </span>
                </div>

                <div className="mt-4 space-y-3 rounded-3xl bg-[var(--surface-alt)] p-4">
                  <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">Connection</p>
                  <div className="text-sm">
                    <p>
                      <span className="font-medium">URL: </span>
                      {connector.connectionUrl || "Not set"}
                    </p>
                    {connector.config.map((entry) => (
                      <p key={entry.key} className="text-[var(--muted)] text-sm">
                        {entry.key}: {entry.value || "Not set"}
                      </p>
                    ))}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  <a href={connector.docsUrl} target="_blank" rel="noreferrer" className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:bg-[var(--surface-alt)]">
                    Documentation
                  </a>
                  <button
                    onClick={() => handleTestConnector(connector.id)}
                    disabled={!!loadingById[connector.id]}
                    className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--surface)] transition hover:bg-[var(--accent)]/90 disabled:opacity-50"
                  >
                    {loadingById[connector.id] ? "Testing…" : "Test connection"}
                  </button>
                  <button
                    onClick={() => handleFetchConnectorData(connector.id)}
                    disabled={!!loadingById[connector.id]}
                    className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:bg-[var(--surface-alt)] disabled:opacity-50"
                  >
                    {loadingById[connector.id] ? "Fetching…" : "Fetch sample data"}
                  </button>
                  <button
                    onClick={() => handleSyncConnector(connector.id)}
                    disabled={!!loadingById[connector.id]}
                    className="rounded-full border border-[var(--border)] bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                  >
                    {loadingById[connector.id] ? "Syncing…" : "Sync now"}
                  </button>
                </div>

                {connector.testResult && (
                  <div className="mt-4 rounded-3xl border border-[var(--border)] bg-white p-4 text-sm">
                    <p className={`font-semibold ${connector.testResult.success ? "text-emerald-700" : "text-red-700"}`}>
                      {connector.testResult.success ? "Connection successful" : "Connection failed"}
                    </p>
                    <p className="mt-2 text-[var(--muted)]">{connector.testResult.message}</p>
                    {connector.testResult.details != null && (
                      <pre className="mt-3 max-h-48 overflow-auto rounded bg-slate-100 p-3 text-xs text-slate-700">
                        {JSON.stringify(connector.testResult.details, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
                {connector.dataResult && (
                  <div className="mt-4 rounded-3xl border border-[var(--border)] bg-white p-4 text-sm">
                    <p className={`font-semibold ${connector.dataResult.success ? "text-emerald-700" : "text-red-700"}`}>
                      {connector.dataResult.success ? "Sample data retrieved" : "Data fetch failed"}
                    </p>
                    <p className="mt-2 text-[var(--muted)]">{connector.dataResult.message}</p>
                    {connector.dataResult.data != null ? (
                      <pre className="mt-3 max-h-48 overflow-auto rounded bg-slate-100 p-3 text-xs text-slate-700">
                        {JSON.stringify(connector.dataResult.data, null, 2)}
                      </pre>
                    ) : null}
                    {connector.dataResult.details != null ? (
                      <pre className="mt-3 max-h-32 overflow-auto rounded bg-rose-50 p-3 text-xs text-rose-700">
                        {JSON.stringify(connector.dataResult.details, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                )}
                {connector.syncResult && (
                  <div className="mt-4 rounded-3xl border border-[var(--border)] bg-white p-4 text-sm">
                    <p className={`font-semibold ${connector.syncResult.success ? "text-emerald-700" : "text-red-700"}`}>
                      {connector.syncResult.success ? "Sync successful" : "Sync failed"}
                    </p>
                    <p className="mt-2 text-[var(--muted)]">{connector.syncResult.message}</p>
                    {connector.syncResult.details != null ? (
                      <pre className="mt-3 max-h-32 overflow-auto rounded bg-slate-100 p-3 text-xs text-slate-700">
                        {JSON.stringify(connector.syncResult.details, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminShell>
  );
}
