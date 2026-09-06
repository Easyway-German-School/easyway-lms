"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import AdminBriefView, { type Brief } from "@/components/admin/AdminBriefView";
import PrivacyToggle from "@/components/PrivacyToggle";
import { usePrivacyMode } from "@/lib/use-privacy-mode";
import { PulseIcon } from "@/components/icons";

/**
 * The office brief — what happened today, this week, this month, and what to do
 * about it. The dashboard answers "how are we doing overall"; this answers
 * "what moved since I last looked", which is the question an accountant and a
 * super admin actually run the desk on.
 *
 * Every figure is a live query (see lib/admin-brief.ts). The "what to act on"
 * list is the one model call, and it degrades to plain flags when the model is
 * unavailable.
 */

const PERIODS = [
  { key: "daily", label: "Today" },
  { key: "weekly", label: "This week" },
  { key: "monthly", label: "This month" },
] as const;

export default function AdminBriefingPage() {
  const { hidden } = usePrivacyMode();
  const [period, setPeriod] = useState<"daily" | "weekly" | "monthly">("daily");
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/brief?period=${p}`, { cache: "no-store" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not load the brief.");
      }
      setBrief(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the brief.");
      setBrief(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [load, period]);

  return (
    <AdminShell>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[var(--accent)]/10 text-[var(--accent)]">
              <PulseIcon className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Office brief</h1>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {brief
                  ? `${brief.rangeLabel[0].toUpperCase()}${brief.rangeLabel.slice(1)} vs ${brief.comparedTo} · read straight from the records`
                  : "Registrations, tuition paid, and what to chase — daily, weekly, monthly."}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PrivacyToggle />
            <button
              type="button"
              onClick={() => void load(period)}
              disabled={loading}
              className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold transition hover:bg-[var(--surface-alt)] disabled:opacity-50"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="inline-flex rounded-full border border-[var(--border)] bg-[var(--surface)] p-1 text-sm font-semibold">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPeriod(p.key)}
              className={`rounded-full px-4 py-1.5 transition ${
                period === p.key
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-3xl border border-red-300 bg-red-50 p-5 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading && !brief ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-[var(--surface-alt)]" />
            ))}
          </div>
        ) : brief ? (
          <div className={loading ? "opacity-60 transition" : "transition"}>
            <AdminBriefView brief={brief} hidden={hidden} />
          </div>
        ) : null}
      </div>
    </AdminShell>
  );
}
