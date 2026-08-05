"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { AlertIcon, BellIcon, CheckIcon, MailIcon, SendIcon } from "@/components/icons";

/**
 * One page that answers "who hears about what, and how".
 *
 * Every row is a kind of event. The three ticks are the three channels, and
 * they are genuinely independent: a class starting five minutes from now wants
 * push and the bell but emphatically not email, and a payment receipt wants
 * email whether or not anybody has push enabled.
 *
 * "Default" vs "Set" is shown per row on purpose. A kind with no stored row
 * follows the code, which means a later change to the defaults reaches it —
 * and an admin should be able to see which rows they have pinned and which are
 * still following along.
 */

type Plan = {
  inApp: boolean;
  push: boolean;
  email: boolean;
  identity: "support" | "noreply";
  configured: boolean;
};

type Payload = {
  groups: Array<{ group: string; kinds: string[] }>;
  labels: Record<string, string>;
  plans: Record<string, Plan>;
  addresses: { support: string; noreply: string };
  transport: { configured: boolean; via: "mailersend" | "smtp" | "none" };
};

export default function NotificationSettingsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/notification-settings", { cache: "no-store" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Unable to load notification settings");
      setData(payload);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function update(kind: string, patch: Partial<Plan>) {
    setBusy(kind);
    // Optimistic: a checkbox that waits for a round trip before moving feels
    // broken, and the reload underneath corrects it if the write is refused.
    setData((current) =>
      current
        ? { ...current, plans: { ...current.plans, [kind]: { ...current.plans[kind], ...patch, configured: true } } }
        : current,
    );
    try {
      const res = await fetch("/api/admin/notification-settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, ...patch }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Could not save");
      setSaved(kind);
      window.setTimeout(() => setSaved((s) => (s === kind ? null : s)), 1800);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function reset(kind: string) {
    setBusy(kind);
    try {
      await fetch(`/api/admin/notification-settings?kind=${encodeURIComponent(kind)}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminShell>
      <div className="min-w-0">
        <div className="mb-5 flex items-start gap-3 sm:gap-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[var(--accent)]/10 text-[var(--accent)] sm:h-12 sm:w-12">
            <BellIcon className="h-5 w-5 sm:h-6 sm:w-6" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold sm:text-3xl">Notifications &amp; email</h1>
            <p className="mt-1 text-sm text-slate-500">
              What the school tells people, and how it reaches them. The bell, their phone and their
              inbox are separate switches — one event can use all three or just one.
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-2xl bg-red-500/10 p-4 text-sm font-medium text-red-700">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0">{error}</span>
          </div>
        )}

        {/* ---- Is anything actually deliverable? --------------------------
            Shown first and loudly. A page of ticked "email" boxes over a
            transport that cannot authenticate is the most misleading screen
            the admin area could offer. */}
        {data && !data.transport.configured && (
          <div className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-4">
            <p className="flex items-center gap-2 text-sm font-bold text-amber-900">
              <AlertIcon className="h-4 w-4 shrink-0" /> No email is going out
            </p>
            <p className="mt-1.5 text-sm leading-6 text-amber-800">
              Nothing below marked <strong>Email</strong> can be delivered until an SMTP sender is
              configured. In-app and push are unaffected and still work. Everything the school tries
              to email is queued and retried, so nothing is lost — it will flush once a working
              sender is set.
            </p>
          </div>
        )}

        {/* ---- The two senders ------------------------------------------- */}
        {data && (
          <div className="mb-5 grid gap-3 sm:grid-cols-2">
            <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <SendIcon className="h-4 w-4 shrink-0 text-[var(--accent)]" /> Support sender
              </p>
              <p className="mt-1 truncate font-mono text-xs text-slate-600">{data.addresses.support}</p>
              <p className="mt-1.5 text-xs text-slate-500">
                Anything a person wrote, or that a student might reasonably answer. Replies land in
                this mailbox.
              </p>
            </div>
            <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <MailIcon className="h-4 w-4 shrink-0 text-slate-400" /> Automated sender
              </p>
              <p className="mt-1 truncate font-mono text-xs text-slate-600">{data.addresses.noreply}</p>
              <p className="mt-1.5 text-xs text-slate-500">
                Receipts and confirmations. Replies still route to support rather than bouncing.
              </p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-slate-500">Loading…</div>
        ) : !data ? null : (
          <div className="space-y-5">
            {data.groups.map((group) => (
              <section key={group.group} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <header className="border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                  <h2 className="text-sm font-bold text-slate-900">{group.group}</h2>
                </header>

                <div className="divide-y divide-slate-100">
                  {group.kinds.map((kind) => {
                    const plan = data.plans[kind];
                    if (!plan) return null;
                    const isBusy = busy === kind;

                    return (
                      <div key={kind} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-slate-800">{data.labels[kind] ?? kind}</p>
                            {saved === kind && (
                              <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-600">
                                <CheckIcon className="h-3 w-3" /> Saved
                              </span>
                            )}
                            {!plan.configured && (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-500">
                                Default
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 font-mono text-[11px] text-slate-400">{kind}</p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {(["inApp", "push", "email"] as const).map((channel) => {
                            const on = plan[channel];
                            const label = channel === "inApp" ? "Bell" : channel === "push" ? "Push" : "Email";
                            return (
                              <button
                                key={channel}
                                type="button"
                                disabled={isBusy}
                                aria-pressed={on}
                                onClick={() => update(kind, { [channel]: !on } as Partial<Plan>)}
                                className={`rounded-xl border px-3 py-2 text-xs font-semibold transition disabled:opacity-50 ${
                                  on
                                    ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                                    : "border-slate-200 text-slate-500 hover:bg-slate-50"
                                }`}
                              >
                                {label}
                              </button>
                            );
                          })}

                          <select
                            value={plan.identity}
                            disabled={isBusy || !plan.email}
                            onChange={(e) => update(kind, { identity: e.target.value as Plan["identity"] })}
                            title="Which address the emailed copy comes from"
                            className="rounded-xl border border-slate-200 px-2.5 py-2 text-xs disabled:opacity-40"
                          >
                            <option value="noreply">from: automated</option>
                            <option value="support">from: support</option>
                          </select>

                          {plan.configured && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => reset(kind)}
                              className="rounded-xl border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-500 transition hover:bg-slate-50 disabled:opacity-50"
                            >
                              Reset
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}

            <p className="pb-2 text-center text-xs text-slate-500">
              Emails are queued, not sent inline — a failed send retries with widening backoff and
              never blocks the action that triggered it.
            </p>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
