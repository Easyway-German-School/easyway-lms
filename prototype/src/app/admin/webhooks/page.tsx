"use client";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import {
  AlertIcon,
  CheckCircleIcon,
  CrossCircleIcon,
  KeyIcon,
  LinkIcon,
  PendingIcon,
  PlusIcon,
  RefreshIcon,
  TrashIcon,
} from "@/components/icons";

/**
 * Where this school wants to be told things.
 *
 * The endpoints and their delivery log have existed and worked since the
 * platform layer was built, reachable only by whoever was willing to POST JSON
 * at /api/admin/webhooks by hand. That is a reasonable place for a feature to
 * start and a bad place for it to stay: the people who most need to see a
 * failing endpoint — the office watching an integration go quiet — are exactly
 * the people who will not open a terminal to check.
 */

type Endpoint = {
  id: string;
  url: string;
  events: string;
  disabledAt: string | null;
  failureCount: number;
  createdAt: string;
  _count: { deliveries: number };
};

type Delivery = {
  id: string;
  event: string;
  status: string;
  attempts: number;
  lastStatus: number | null;
  lastError: string | null;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
};

/**
 * Mirrors the list the POST route validates against. Duplicated deliberately
 * rather than imported: this file is a client component, and pulling in the
 * route module to share one array would drag `prisma` into the browser bundle.
 * The route refuses anything not on its own list, so the cost of these drifting
 * apart is an option that returns a 400 — not an endpoint subscribed to
 * something nobody sends.
 */
const EVENTS = [
  { name: "student.enrolled", hint: "A student joined a class" },
  { name: "student.updated", hint: "Their details changed" },
  { name: "payment.recorded", hint: "Money came in" },
  { name: "attendance.recorded", hint: "A register was marked" },
  { name: "class.scheduled", hint: "A class was put on the calendar" },
  { name: "credit.low", hint: "Platform balance running out" },
];

function when(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusPill({ delivery }: { delivery: Delivery }) {
  const base = "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold";

  if (delivery.status === "delivered") {
    return (
      <span className={`${base} bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300`}>
        <CheckCircleIcon className="h-3 w-3" />
        {delivery.lastStatus ?? 200}
      </span>
    );
  }

  if (delivery.status === "failed") {
    return (
      <span className={`${base} bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300`}>
        <CrossCircleIcon className="h-3 w-3" />
        {delivery.lastStatus ?? "no reply"}
      </span>
    );
  }

  return (
    <span className={`${base} bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-300`}>
      <PendingIcon className="h-3 w-3" />
      retrying
    </span>
  );
}

export default function WebhooksPage() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [selected, setSelected] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);

  /**
   * Held until dismissed, exactly like a fresh API key. The signing secret is
   * hashed nowhere and stored plainly nowhere the school can read it back — if
   * this panel is cleared by a re-render, the only remedy is deleting the
   * endpoint and making another.
   */
  const [freshSecret, setFreshSecret] = useState<{ secret: string; url: string } | null>(null);

  const [draft, setDraft] = useState<{ url: string; events: string[] }>({ url: "", events: [] });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/webhooks", { cache: "no-store" });
      if (!response.ok) throw new Error(`Failed with ${response.status}`);
      const data = await response.json();
      setEndpoints(data.endpoints ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the endpoints.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDeliveries = useCallback(async (endpointId: string) => {
    const response = await fetch(`/api/admin/webhooks/${endpointId}/deliveries`, { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    setDeliveries(data.deliveries ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (selected) loadDeliveries(selected);
    else setDeliveries([]);
  }, [selected, loadDeliveries]);

  async function create() {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: draft.url,
          // No selection means everything. Subscribing to nothing is never what
          // somebody adding an endpoint meant, and the route rejects it.
          events: draft.events.length ? draft.events : ["*"],
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not add the endpoint.");
      setFreshSecret({ secret: data.secret, url: data.endpoint.url });
      setDraft({ url: "", events: [] });
      setError(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the endpoint.");
    } finally {
      setBusy(false);
    }
  }

  async function setEnabled(endpointId: string, enabled: boolean) {
    setBusy(true);
    try {
      await fetch(`/api/admin/webhooks/${endpointId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(endpointId: string) {
    setBusy(true);
    try {
      await fetch(`/api/admin/webhooks/${endpointId}`, { method: "DELETE" });
      if (selected === endpointId) setSelected(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell>
      <div className="min-w-0 space-y-8">
        <header>
          <h1 className="flex items-center gap-3 text-3xl font-bold">
            <LinkIcon className="h-7 w-7" />
            Webhooks
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
            Tell another system when something happens here — a student enrols, a payment lands,
            a register is marked. We POST the event to your URL and keep retrying if it does not
            answer.
          </p>
        </header>

        {error && (
          <div className="flex items-start gap-3 rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950/30">
            <AlertIcon className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="min-w-0">{error}</p>
          </div>
        )}

        {freshSecret && (
          <div className="rounded-3xl border-2 border-amber-400 bg-amber-50 p-5 dark:bg-amber-950/20">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <KeyIcon className="h-5 w-5" />
              Signing secret for {freshSecret.url} — copy this now
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              This is the only time it can be shown. Without it your receiver cannot tell our
              deliveries from anybody else&apos;s.
            </p>
            <code className="mt-3 block overflow-x-auto rounded-xl bg-[var(--surface)] p-3 font-mono text-xs">
              {freshSecret.secret}
            </code>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(freshSecret.secret)}
                className="rounded-full border border-[var(--border)] px-4 py-1.5 text-xs font-semibold"
              >
                Copy
              </button>
              <button
                type="button"
                onClick={() => setFreshSecret(null)}
                className="rounded-full px-4 py-1.5 text-xs font-semibold text-[var(--muted)]"
              >
                I have it
              </button>
            </div>
            <details className="mt-4 text-xs text-[var(--muted)]">
              <summary className="cursor-pointer font-semibold text-[var(--foreground)]">
                How your receiver checks a delivery is really from us
              </summary>
              <p className="mt-2 leading-relaxed">
                Every request carries <code className="font-mono">X-Easyway-Timestamp</code> and{" "}
                <code className="font-mono">X-Easyway-Signature</code>. Compute HMAC-SHA256 of{" "}
                <code className="font-mono">{"`${timestamp}.${rawBody}`"}</code> with this secret and
                compare it against the signature after the{" "}
                <code className="font-mono">sha256=</code> prefix. Reject anything with a timestamp
                older than five minutes — that is what stops somebody replaying a delivery they
                captured.
              </p>
            </details>
          </div>
        )}

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Endpoints</h2>
            <button
              type="button"
              onClick={load}
              className="flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-1.5 text-xs font-semibold"
            >
              <RefreshIcon className="h-4 w-4" />
              Refresh
            </button>
          </div>

          {loading ? (
            <p className="text-sm text-[var(--muted)]">Loading…</p>
          ) : endpoints.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-sm text-[var(--muted)]">
              No endpoints yet. Nothing that happens in this school is being announced anywhere.
            </p>
          ) : (
            <div className="space-y-3">
              {endpoints.map((endpoint) => {
                const open = endpoint.id === selected;
                return (
                  <div
                    key={endpoint.id}
                    className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setSelected(open ? null : endpoint.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="flex flex-wrap items-center gap-2 font-mono text-sm font-semibold">
                          <span className="min-w-0 break-all">{endpoint.url}</span>
                          {endpoint.disabledAt && (
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-sans font-semibold text-red-800 dark:bg-red-950/40 dark:text-red-300">
                              switched off after {endpoint.failureCount} failures
                            </span>
                          )}
                        </p>
                        <p className="mt-1.5 text-xs text-[var(--muted)]">
                          {endpoint.events === "*" ? "every event" : endpoint.events.split(",").join(" · ")}
                          {" — "}
                          {endpoint._count.deliveries} deliveries
                        </p>
                      </button>

                      <div className="flex shrink-0 items-center gap-3">
                        {endpoint.disabledAt ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setEnabled(endpoint.id, true)}
                            className="rounded-full border border-[var(--border)] px-4 py-1.5 text-xs font-semibold"
                          >
                            Switch back on
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setEnabled(endpoint.id, false)}
                            className="rounded-full border border-[var(--border)] px-4 py-1.5 text-xs font-semibold"
                          >
                            Pause
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => remove(endpoint.id)}
                          className="flex items-center gap-1 text-xs font-semibold text-red-600"
                        >
                          <TrashIcon className="h-4 w-4" />
                          Delete
                        </button>
                      </div>
                    </div>

                    {open && (
                      <div className="mt-4 border-t border-[var(--border)] pt-4">
                        <p className="mb-3 text-sm font-semibold">Recent deliveries</p>
                        {deliveries.length === 0 ? (
                          <p className="text-sm text-[var(--muted)]">
                            Nothing sent yet.
                          </p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[620px] text-left text-sm">
                              <thead className="text-xs text-[var(--muted)]">
                                <tr>
                                  <th className="py-2 pr-4">Event</th>
                                  <th className="py-2 pr-4">Result</th>
                                  <th className="py-2 pr-4">Tries</th>
                                  <th className="py-2 pr-4">When</th>
                                  <th className="py-2 pr-4">Error</th>
                                </tr>
                              </thead>
                              <tbody>
                                {deliveries.map((delivery) => (
                                  <tr key={delivery.id} className="border-t border-[var(--border)]">
                                    <td className="py-2 pr-4 font-mono text-xs">{delivery.event}</td>
                                    <td className="py-2 pr-4">
                                      <StatusPill delivery={delivery} />
                                    </td>
                                    <td className="py-2 pr-4">{delivery.attempts}</td>
                                    <td className="py-2 pr-4 text-xs text-[var(--muted)]">
                                      {when(delivery.deliveredAt ?? delivery.createdAt)}
                                    </td>
                                    <td className="max-w-[18rem] truncate py-2 pr-4 text-xs text-[var(--muted)]">
                                      {delivery.lastError ?? "—"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <PlusIcon className="h-5 w-5" />
            Add an endpoint
          </h2>

          <input
            value={draft.url}
            onChange={(e) => setDraft({ ...draft, url: e.target.value })}
            placeholder="https://your-system.example.com/hooks/easyway"
            className="w-full rounded-xl border border-[var(--border)] px-3 py-2 font-mono text-sm"
          />
          <p className="text-xs text-[var(--muted)]">
            Must be https, and must be a public address — student data does not travel over plain
            http, and an endpoint pointing inside a private network would let anyone with this
            screen make our servers fetch things on their behalf.
          </p>

          <div className="flex flex-wrap gap-2 pt-1">
            {EVENTS.map((event) => {
              const on = draft.events.includes(event.name);
              return (
                <button
                  key={event.name}
                  type="button"
                  title={event.hint}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      events: on
                        ? draft.events.filter((e) => e !== event.name)
                        : [...draft.events, event.name],
                    })
                  }
                  className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${
                    on ? "border-[var(--primary)] bg-[var(--primary)] text-white" : "border-[var(--border)]"
                  }`}
                >
                  {on && <CheckCircleIcon className="h-3 w-3" />}
                  {event.name}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-[var(--muted)]">
            {draft.events.length === 0
              ? "Nothing picked — this endpoint will receive every event."
              : `${draft.events.length} picked.`}
          </p>

          <button
            type="button"
            disabled={busy || !draft.url}
            onClick={create}
            className="rounded-full bg-[var(--primary)] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Add
          </button>
        </section>
      </div>
    </AdminShell>
  );
}
