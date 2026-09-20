"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { verdictKeyLabel } from "@/lib/portal-verdict";
import BackendMap from "./BackendMap";
import PatternsPanel from "./PatternsPanel";
import Sparkline from "./Sparkline";

/* ------------------------------------------------------------------------ */
/* Types                                                                     */
/* ------------------------------------------------------------------------ */

type Overview = {
  at: string;
  db: { ms: number };
  incidents: {
    active: number;
    open: number;
    acknowledged: number;
    bySeverity: Record<string, number>;
    regressions: number;
    driftOpen: number;
    newLastHour: number;
    activeLastHour: number;
    occurrences: number;
  };
  access: {
    students: number;
    known: number;
    openCount: number;
    lockedCount: number;
    byVerdict: Array<{ key: string; count: number }>;
    witnessed24h: number;
    showingLockWhileOpen: number;
  };
  backups: Array<{ kind: string; label: string; state: string; hoursSinceSuccess: number | null }>;
};

type Incident = {
  id: string;
  kind: string;
  source: string;
  severity: string;
  status: string;
  title: string;
  route: string | null;
  method: string | null;
  occurrences: number;
  reopenedCount: number;
  samples: Array<{ at: string; message: string; context?: Record<string, unknown> }> | null;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
};
type IncidentDetail = Incident & { message: string | null; stack: string | null; context: unknown };

type Tab = "overview" | "incidents" | "access" | "map" | "patterns";

const SEVERITY = {
  critical: { dot: "bg-red-500", text: "text-red-500", label: "Critical" },
  high: { dot: "bg-orange-500", text: "text-orange-500", label: "High" },
  medium: { dot: "bg-yellow-500", text: "text-yellow-600", label: "Medium" },
  low: { dot: "bg-slate-400", text: "text-slate-500", label: "Low" },
} as const;
const sev = (value: string) => SEVERITY[value as keyof typeof SEVERITY] ?? SEVERITY.low;

const card = "min-w-0 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm";

function ago(iso: string | null): string {
  if (!iso) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

/** Runs `fn` now and every `ms`, but not while the tab is hidden. */
function usePoll(fn: () => void, ms: number) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    ref.current();
    const id = setInterval(() => {
      if (document.visibilityState !== "hidden") ref.current();
    }, ms);
    const onVisible = () => document.visibilityState === "visible" && ref.current();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ms]);
}

/* ------------------------------------------------------------------------ */
/* Incident list (used by three tabs)                                        */
/* ------------------------------------------------------------------------ */

function IncidentList({
  kind,
  limit,
  expandId,
  compact,
}: {
  kind?: string;
  limit?: number;
  expandId?: string | null;
  compact?: boolean;
}) {
  const [status, setStatus] = useState<"active" | "resolved" | "ignored" | "all">("active");
  const [kindFilter, setKindFilter] = useState(kind ?? "");
  const [rows, setRows] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(expandId ?? null);
  const [detail, setDetail] = useState<Record<string, IncidentDetail>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ take: String(limit ?? 60) });
    if (status !== "all") params.set("status", status);
    if (kindFilter) params.set("kind", kindFilter);
    try {
      const response = await fetch(`/api/admin/developer/incidents?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      setRows(data.incidents);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [status, kindFilter, limit]);

  usePoll(load, 15_000);

  useEffect(() => {
    if (!openId || detail[openId]) return;
    fetch(`/api/admin/developer/incidents?id=${encodeURIComponent(openId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setDetail((cur) => ({ ...cur, [openId]: d.incident })))
      .catch(() => {});
  }, [openId, detail]);

  async function act(id: string, next: string) {
    setBusy(id);
    try {
      await fetch("/api/admin/developer/incidents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: next, note }),
      });
      setNote("");
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {!compact && (
        <div className="flex flex-wrap items-center gap-2">
          {(["active", "resolved", "ignored", "all"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatus(value)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                status === value ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]" : "border-[var(--border)] text-[var(--muted)]"
              }`}
            >
              {value === "active" ? "Needs attention" : value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
          {!kind && (
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              className="ml-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs"
            >
              <option value="">All kinds</option>
              <option value="error">Errors</option>
              <option value="complaint">Complaints</option>
              <option value="drift">Drift</option>
              <option value="health">Health</option>
            </select>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : failed ? (
        <p className="text-sm text-red-500">Could not load incidents.</p>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">
          {status === "active" ? "Nothing needs attention. The system has not recorded anything wrong." : "Nothing here."}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            const open = openId === row.id;
            const info = detail[row.id];
            return (
              <li key={row.id} className="min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : row.id)}
                  className="flex w-full min-w-0 items-start gap-3 p-3 text-left"
                >
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${sev(row.severity).dot}`} title={sev(row.severity).label} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{row.title}</span>
                    <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--muted)]">
                      <span className="uppercase tracking-wide">{row.kind}</span>
                      <span>×{row.occurrences}</span>
                      <span>last {ago(row.lastSeenAt)}</span>
                      <span>first {ago(row.firstSeenAt)}</span>
                      {row.status !== "open" && <span className="font-semibold">{row.status}</span>}
                      {row.reopenedCount > 0 && <span className="font-semibold text-red-500">came back {row.reopenedCount}×</span>}
                    </span>
                  </span>
                </button>

                {open && (
                  <div className="space-y-3 border-t border-[var(--border)] p-3 text-xs">
                    {!info ? (
                      <p className="text-[var(--muted)]">Loading detail…</p>
                    ) : (
                      <>
                        {info.message && <p className="whitespace-pre-wrap break-words">{info.message}</p>}
                        {info.samples && info.samples.length > 0 && (
                          <div>
                            <p className="mb-1 font-semibold">Last {info.samples.length} occurrences</p>
                            <ul className="space-y-1 text-[11px] text-[var(--muted)]">
                              {info.samples.map((s, i) => (
                                <li key={i} className="break-words">
                                  {ago(s.at)} — {s.message}
                                  {s.context ? <code className="ml-1 rounded bg-black/5 px-1">{JSON.stringify(s.context)}</code> : null}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {info.stack && (
                          <details>
                            <summary className="cursor-pointer font-semibold">Stack</summary>
                            <pre className="mt-1 max-h-56 overflow-auto rounded-lg bg-black/5 p-2 text-[10px] leading-snug">{info.stack}</pre>
                          </details>
                        )}
                        {info.resolutionNote && <p className="text-[var(--muted)]">Note: {info.resolutionNote}</p>}
                      </>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      {row.route && <code className="rounded bg-black/5 px-1.5 py-0.5 text-[10px]">{row.route}</code>}
                      <input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Note (optional)"
                        className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1"
                      />
                      {row.status === "open" && (
                        <button disabled={busy === row.id} onClick={() => act(row.id, "acknowledged")} className="rounded-lg border border-[var(--border)] px-2.5 py-1 font-semibold">
                          Acknowledge
                        </button>
                      )}
                      {(row.status === "open" || row.status === "acknowledged") && (
                        <>
                          <button disabled={busy === row.id} onClick={() => act(row.id, "resolved")} className="rounded-lg bg-emerald-600 px-2.5 py-1 font-semibold text-white">
                            Resolve
                          </button>
                          <button disabled={busy === row.id} onClick={() => act(row.id, "ignored")} className="rounded-lg border border-[var(--border)] px-2.5 py-1 font-semibold text-[var(--muted)]">
                            Ignore
                          </button>
                        </>
                      )}
                      {(row.status === "resolved" || row.status === "ignored") && (
                        <button disabled={busy === row.id} onClick={() => act(row.id, "open")} className="rounded-lg border border-[var(--border)] px-2.5 py-1 font-semibold">
                          Reopen
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Overview                                                                  */
/* ------------------------------------------------------------------------ */

const HISTORY = 40;

function Tile({ label, value, sub, tone, children }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string; children?: React.ReactNode }) {
  return (
    <div className={card}>
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">{label}</p>
      <p className={`mt-2 text-3xl font-bold tabular-nums ${tone ?? ""}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-[var(--muted)]">{sub}</p>}
      {children && <div className={`mt-3 ${tone ?? ""}`}>{children}</div>}
    </div>
  );
}

function OverviewPanel({ onOpenIncident }: { onOpenIncident: (id: string) => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [failed, setFailed] = useState(false);
  const [latency, setLatency] = useState<Array<number | null>>([]);
  const [rate, setRate] = useState<Array<number | null>>([]);
  const lastOccurrences = useRef<number | null>(null);

  usePoll(async () => {
    try {
      const response = await fetch("/api/admin/developer/overview", { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const next: Overview = await response.json();
      setData(next);
      setFailed(false);
      setLatency((cur) => [...cur, next.db.ms].slice(-HISTORY));
      // New occurrences since the previous poll — a rate, not a running total.
      const previous = lastOccurrences.current;
      setRate((cur) => [...cur, previous === null ? 0 : Math.max(0, next.incidents.occurrences - previous)].slice(-HISTORY));
      lastOccurrences.current = next.incidents.occurrences;
    } catch {
      setFailed(true);
      // A failed poll is a gap, not a zero: a database that stops answering must not draw as "fast".
      setLatency((cur) => [...cur, null].slice(-HISTORY));
    }
  }, 10_000);

  if (!data) return <p className="text-sm text-[var(--muted)]">{failed ? "Could not reach the server." : "Taking the pulse…"}</p>;

  const dbTone = data.db.ms < 200 ? "text-emerald-500" : data.db.ms < 600 ? "text-amber-500" : "text-red-500";
  const worstBackup = data.backups.find((b) => b.state !== "ok");
  const drift = data.access.showingLockWhileOpen;
  const totalRate = rate.reduce<number>((sum, v) => sum + (v ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Database" value={`${data.db.ms} ms`} sub="round trip, live" tone={dbTone}>
          <Sparkline values={latency} min={0} />
        </Tile>
        <Tile
          label="Needs attention"
          value={data.incidents.active}
          tone={data.incidents.bySeverity.critical || data.incidents.bySeverity.high ? "text-red-500" : data.incidents.active ? "text-amber-500" : "text-emerald-500"}
          sub={`${data.incidents.newLastHour} new in the last hour · ${data.incidents.regressions} came back`}
        >
          <Sparkline values={rate} min={0} />
          <p className="mt-1 text-[10px] text-[var(--muted)]">new errors per 10s · {totalRate} in this view</p>
        </Tile>
        <Tile
          label="Screens showing the wrong thing"
          value={drift}
          tone={drift ? "text-red-500" : "text-emerald-500"}
          sub={drift ? "students are looking at a lock the database says is open" : "every reported screen agrees with the database"}
        />
        <Tile
          label="Backups"
          value={worstBackup ? "Check" : "Healthy"}
          tone={worstBackup ? "text-red-500" : "text-emerald-500"}
          sub={worstBackup ? `${worstBackup.label}: ${worstBackup.state}` : `${data.backups.length} jobs on schedule`}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className={card}>
          <h2 className="text-base font-bold">Who is locked, and why</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {data.access.known} of {data.access.students} students have opened the portal since the witness went live.
          </p>
          <div className="mt-4 space-y-2.5">
            {data.access.byVerdict.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No student has reported in yet.</p>
            ) : (
              data.access.byVerdict.map((row) => {
                const pct = Math.max(2, Math.round((row.count / Math.max(data.access.known, 1)) * 100));
                return (
                  <div key={row.key}>
                    <div className="flex justify-between gap-3 text-xs">
                      <span className="min-w-0 truncate">{verdictKeyLabel(row.key)}</span>
                      <span className="font-bold tabular-nums">{row.count}</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-black/10">
                      <div className={`h-full rounded-full ${row.key === "open" ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className={card}>
          <h2 className="text-base font-bold">Happening now</h2>
          <p className="mb-3 mt-1 text-xs text-[var(--muted)]">Newest activity first. Click one to open it.</p>
          <ActiveFeed onOpen={onOpenIncident} />
        </section>
      </div>
    </div>
  );
}

function ActiveFeed({ onOpen }: { onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<Incident[] | null>(null);
  usePoll(async () => {
    try {
      const response = await fetch("/api/admin/developer/incidents?status=active&take=8", { cache: "no-store" });
      if (response.ok) setRows((await response.json()).incidents);
    } catch {
      /* keep the last feed on screen */
    }
  }, 10_000);

  if (!rows) return <p className="text-sm text-[var(--muted)]">Loading…</p>;
  if (rows.length === 0) return <p className="rounded-2xl border border-dashed border-[var(--border)] p-5 text-center text-sm text-[var(--muted)]">Quiet. Nothing has gone wrong.</p>;
  return (
    <ul className="space-y-1.5">
      {rows.map((row) => (
        <li key={row.id}>
          <button type="button" onClick={() => onOpen(row.id)} className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-black/5">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${sev(row.severity).dot}`} />
            <span className="min-w-0 flex-1 truncate text-xs font-medium">{row.title}</span>
            <span className="shrink-0 text-[10px] tabular-nums text-[var(--muted)]">×{row.occurrences} · {ago(row.lastSeenAt)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------------ */
/* Access drift                                                              */
/* ------------------------------------------------------------------------ */

function AccessPanel() {
  const [data, setData] = useState<Overview["access"] | null>(null);
  usePoll(async () => {
    try {
      const response = await fetch("/api/admin/developer/overview", { cache: "no-store" });
      if (response.ok) setData((await response.json()).access);
    } catch {
      /* keep last */
    }
  }, 15_000);

  return (
    <div className="space-y-6">
      <section className={card}>
        <h2 className="text-base font-bold">Does what students see match the database?</h2>
        <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
          Every student&apos;s portal reports what it actually put on screen. The server recomputes what it <em>should</em> show and
          compares. A mismatch is recorded below as <strong>drift</strong>: either the browser showed a lock its own data did not
          justify, or it is running on data older than the database by more than a race explains.
        </p>
        {data && (
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Lock on screen, database says open</p>
              <p className={`mt-1 text-3xl font-bold ${data.showingLockWhileOpen ? "text-red-500" : "text-emerald-500"}`}>{data.showingLockWhileOpen}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Reported in, last 24h</p>
              <p className="mt-1 text-3xl font-bold">{data.witnessed24h}<span className="text-base font-medium text-[var(--muted)]"> / {data.students}</span></p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Open · locked</p>
              <p className="mt-1 text-3xl font-bold">{data.openCount}<span className="text-base font-medium text-[var(--muted)]"> · {data.lockedCount}</span></p>
            </div>
          </div>
        )}
      </section>
      <section>
        <h3 className="mb-2 text-sm font-bold">Drift found</h3>
        <IncidentList kind="drift" />
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Patterns (teaching) — live state of the breakers and bulkheads            */
/* ------------------------------------------------------------------------ */

function PatternsTab() {
  const [resilience, setResilience] = useState<React.ComponentProps<typeof PatternsPanel>["resilience"]>([]);
  usePoll(async () => {
    try {
      const response = await fetch("/api/admin/developer/overview", { cache: "no-store" });
      if (response.ok) setResilience((await response.json()).resilience ?? []);
    } catch {
      /* keep the last reading */
    }
  }, 10_000);
  return <PatternsPanel resilience={resilience} />;
}

/* ------------------------------------------------------------------------ */
/* Shell                                                                     */
/* ------------------------------------------------------------------------ */

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Live" },
  { id: "incidents", label: "Incidents" },
  { id: "access", label: "Access drift" },
  { id: "map", label: "Backend map" },
  { id: "patterns", label: "Patterns" },
];

export default function MissionControl() {
  const [tab, setTab] = useState<Tab>("overview");
  const [expand, setExpand] = useState<string | null>(null);

  const openIncident = useMemo(
    () => (id: string) => {
      setExpand(id);
      setTab("incidents");
    },
    [],
  );

  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h1 className="flex items-center gap-3 text-3xl font-bold">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
          </span>
          Mission control
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
          What is broken, whether students&apos; screens agree with the database, and how the backend is wired — all read from the
          running system rather than remembered. Errors and complaints are recorded automatically and grouped, so a problem
          reported by fifty students is one line with a count, and a fix that did not hold comes back flagged.
        </p>
      </div>

      <nav className="flex flex-wrap gap-1.5 border-b border-[var(--border)] pb-3">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
              tab === item.id ? "bg-[var(--accent)] text-white" : "text-[var(--muted)] hover:bg-black/5"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === "overview" && <OverviewPanel onOpenIncident={openIncident} />}
      {tab === "incidents" && <IncidentList expandId={expand} />}
      {tab === "access" && <AccessPanel />}
      {tab === "map" && <BackendMap />}
      {tab === "patterns" && <PatternsTab />}
    </div>
  );
}
