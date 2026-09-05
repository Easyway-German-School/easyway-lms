"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * "Tell me about this, but not on my phone."
 *
 * Three channels per kind, because the honest answer is almost never "all or
 * nothing". A tutor wants new enrolments in the bell and not in their inbox;
 * they want a class starting to buzz the phone and nothing else to. One
 * master switch per kind would force them to choose between noise and silence,
 * and people who are forced to choose that way choose silence — which is how a
 * school ends up with a notification system nobody reads.
 *
 * Saves per row on change rather than behind a "Save" button. Each row is an
 * independent upsert, so there is no partial-form state to lose, and the thing
 * being changed is a preference — the cost of an accidental tap is one
 * mis-delivered notification, not a lost edit.
 */

type Row = {
  kind: string;
  label: string;
  detail: string;
  inApp: boolean;
  push: boolean;
  email: boolean;
  sms: boolean;
  mutable: boolean;
};

const CHANNELS = [
  { key: "inApp" as const, label: "Bell", hint: "In the portal" },
  { key: "push" as const, label: "Push", hint: "On your device" },
  { key: "email" as const, label: "Email", hint: "In your inbox" },
  { key: "sms" as const, label: "SMS", hint: "As a text message" },
];

export default function NotificationPreferences({ endpoint }: { endpoint: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      setRows(data.kinds ?? []);
    } catch {
      /* Leave the panel empty; nothing here is required to use the portal. */
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(kind: string, channel: "inApp" | "push" | "email" | "sms") {
    const current = rows.find((row) => row.kind === kind);
    if (!current || !current.mutable) return;

    const next = { ...current, [channel]: !current[channel] };
    // Optimistic: a checkbox that waits for a round trip before moving feels
    // broken on a Nigerian mobile line, and the failure path below puts it back.
    setRows((all) => all.map((row) => (row.kind === kind ? next : row)));
    setNote("");

    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, inApp: next.inApp, push: next.push, email: next.email, sms: next.sms }),
      });
      if (!response.ok) throw new Error("save failed");
      setNote("Saved.");
    } catch {
      setRows((all) => all.map((row) => (row.kind === kind ? current : row)));
      setNote("Could not save that — check your connection.");
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <p className="text-sm text-[var(--muted)]">Loading your notification settings…</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <h2 className="text-lg font-bold text-[var(--foreground)]">Notifications</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Choose how the school reaches you. Payment and account messages always come through.
      </p>

      <div className="mt-5 space-y-3">
        {rows.map((row) => (
          <div key={row.kind} className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
            <p className="text-sm font-semibold text-[var(--foreground)]">{row.label}</p>
            <p className="mt-0.5 text-xs leading-5 text-[var(--muted)]">{row.detail}</p>

            {/* Wraps rather than scrolling: three checkboxes must not need a
                horizontal swipe at 375px. */}
            <div className="mt-3 flex flex-wrap gap-2">
              {CHANNELS.map((channel) => {
                const on = row[channel.key];
                return (
                  <button
                    key={channel.key}
                    type="button"
                    disabled={!row.mutable}
                    onClick={() => void toggle(row.kind, channel.key)}
                    aria-pressed={on}
                    title={channel.hint}
                    className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      on
                        ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                        : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    {on ? "✓ " : ""}
                    {channel.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {note ? <p className="mt-4 text-xs text-[var(--muted)]">{note}</p> : null}
    </div>
  );
}
