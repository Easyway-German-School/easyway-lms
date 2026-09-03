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

type AutoRelease = { enabled: boolean; delayDays: number };

type Payload = {
  groups: Array<{ group: string; kinds: string[] }>;
  labels: Record<string, string>;
  plans: Record<string, Plan>;
  addresses: { support: string; noreply: string };
  transport: { configured: boolean; via: "mailersend" | "smtp" | "none" };
  autoRelease: AutoRelease;
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

  async function saveAutoRelease(patch: Partial<AutoRelease>) {
    setBusy("autoRelease");
    setData((current) =>
      current ? { ...current, autoRelease: { ...current.autoRelease, ...patch } } : current,
    );
    try {
      const next = { ...(data?.autoRelease ?? { enabled: true, delayDays: 2 }), ...patch };
      const res = await fetch("/api/admin/notification-settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ autoRelease: next }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Could not save");
      setSaved("autoRelease");
      window.setTimeout(() => setSaved((s) => (s === "autoRelease" ? null : s)), 1800);
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
            <p className="mt-1 text-sm text-[var(--muted)]">
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
            <div className="min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
                <SendIcon className="h-4 w-4 shrink-0 text-[var(--accent)]" /> Support sender
              </p>
              <p className="mt-1 truncate font-mono text-xs text-[var(--muted)]">{data.addresses.support}</p>
              <p className="mt-1.5 text-xs text-[var(--muted)]">
                Anything a person wrote, or that a student might reasonably answer. Replies land in
                this mailbox.
              </p>
            </div>
            <div className="min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
                <MailIcon className="h-4 w-4 shrink-0 text-[var(--muted)]" /> Automated sender
              </p>
              <p className="mt-1 truncate font-mono text-xs text-[var(--muted)]">{data.addresses.noreply}</p>
              <p className="mt-1.5 text-xs text-[var(--muted)]">
                Receipts and confirmations. Replies still route to support rather than bouncing.
              </p>
            </div>
          </div>
        )}

        {/* ---- Automatic result release -------------------------------- */}
        {data && (
          <div className="mb-5 min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
                  <BellIcon className="h-4 w-4 shrink-0 text-[var(--accent)]" /> Automatic mock-result release
                  {saved === "autoRelease" && (
                    <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-600">
                      <CheckIcon className="h-3 w-3" /> Saved
                    </span>
                  )}
                </p>
                <p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">
                  When on, a mock / pretest sitting releases its results to students and their
                  parents on its own — once every student in the class is marked and the delay
                  below has passed. A tutor can still release early or hold a class back from the
                  gradebook. Real ÖSD/telc sittings are never touched by this.
                </p>
              </div>
              <button
                type="button"
                disabled={busy === "autoRelease"}
                aria-pressed={data.autoRelease.enabled}
                onClick={() => saveAutoRelease({ enabled: !data.autoRelease.enabled })}
                className={`rounded-xl border px-3 py-2 text-xs font-semibold transition disabled:opacity-50 ${
                  data.autoRelease.enabled
                    ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                    : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-alt)]"
                }`}
              >
                {data.autoRelease.enabled ? "On" : "Off"}
              </button>
            </div>
            <label className="mt-3 flex items-center gap-2 text-xs text-[var(--muted)]">
              Release
              <input
                type="number"
                min={0}
                max={60}
                disabled={busy === "autoRelease" || !data.autoRelease.enabled}
                value={data.autoRelease.delayDays}
                onChange={(e) =>
                  setData((current) =>
                    current
                      ? { ...current, autoRelease: { ...current.autoRelease, delayDays: Number(e.target.value) } }
                      : current,
                  )
                }
                onBlur={(e) => saveAutoRelease({ delayDays: Math.max(0, Math.min(60, Number(e.target.value) || 0)) })}
                className="w-16 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-center text-xs disabled:opacity-40"
              />
              day(s) after the exam date.
            </label>
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-[var(--muted)]">Loading…</div>
        ) : !data ? null : (
          <div className="space-y-5">
            {data.groups.map((group) => (
              <section key={group.group} className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
                <header className="border-b border-[var(--border)] bg-[var(--surface-alt)]/70 px-4 py-3">
                  <h2 className="text-sm font-bold text-[var(--foreground)]">{group.group}</h2>
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
                            <p className="font-medium text-[var(--foreground)]">{data.labels[kind] ?? kind}</p>
                            {saved === kind && (
                              <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-600">
                                <CheckIcon className="h-3 w-3" /> Saved
                              </span>
                            )}
                            {!plan.configured && (
                              <span className="rounded-full bg-[var(--surface-alt)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--muted)]">
                                Default
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 font-mono text-[11px] text-[var(--muted)]">{kind}</p>
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
                                    : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface-alt)]"
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
                            className="rounded-xl border border-[var(--border)] px-2.5 py-2 text-xs disabled:opacity-40"
                          >
                            <option value="noreply">from: automated</option>
                            <option value="support">from: support</option>
                          </select>

                          {plan.configured && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => reset(kind)}
                              className="rounded-xl border border-[var(--border)] px-2.5 py-2 text-xs font-semibold text-[var(--muted)] transition hover:bg-[var(--surface-alt)] disabled:opacity-50"
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

            <p className="pb-2 text-center text-xs text-[var(--muted)]">
              Emails are queued, not sent inline — a failed send retries with widening backoff and
              never blocks the action that triggered it.
            </p>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
