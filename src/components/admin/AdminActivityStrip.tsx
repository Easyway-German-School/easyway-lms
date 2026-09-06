"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Secret from "@/components/Secret";
import { usePrivacyMode } from "@/lib/use-privacy-mode";
import { ArrowRightIcon, TrendingDownIcon, TrendingUpIcon } from "@/components/icons";
import type { Brief, BriefMetric } from "@/components/admin/AdminBriefView";

/**
 * The dashboard's daily/weekly view — a slim band above the monthly KPI row.
 *
 * The dashboard has always been a monthly / all-time picture, which is the
 * right default. This adds the other question — "what moved today?" — without
 * re-plumbing the whole page: it is its own panel with its own Today / Week /
 * Month switch, reading the same /api/admin/brief the full Office brief page
 * uses. "Open brief" goes to that page for the written summary and the
 * "what to act on" list.
 */

const TABS = [
  { key: "daily", label: "Today" },
  { key: "weekly", label: "Week" },
  { key: "monthly", label: "Month" },
] as const;

/** The four figures worth putting on the dashboard itself. */
const HEADLINE_KEYS = ["registrations", "paidSameDay", "tuitionCollected", "stillUnpaid"];

function Delta({ metric }: { metric: BriefMetric }) {
  if (metric.deltaPct === null || metric.deltaPct === 0) return null;
  const up = metric.deltaPct >= 0;
  const good = metric.higherIsBetter ? up : !up;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] font-bold ${
        good ? "text-emerald-600" : "text-red-600"
      }`}
    >
      {up ? <TrendingUpIcon className="h-2.5 w-2.5" /> : <TrendingDownIcon className="h-2.5 w-2.5" />}
      {up ? "+" : ""}
      {metric.deltaPct}%
    </span>
  );
}

export default function AdminActivityStrip() {
  const { hidden } = usePrivacyMode();
  const [period, setPeriod] = useState<"daily" | "weekly" | "monthly">("daily");
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/brief?period=${p}`, { cache: "no-store" });
      if (!res.ok) {
        setFailed(true);
        setBrief(null);
        return;
      }
      setFailed(false);
      setBrief(await res.json());
    } catch {
      setFailed(true);
      setBrief(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [load, period]);

  // A role with neither students nor payments gets a 403 — just don't render.
  if (failed && !brief) return null;

  const shown = brief
    ? HEADLINE_KEYS.map((k) => brief.metrics.find((m) => m.key === k)).filter(
        (m): m is BriefMetric => Boolean(m),
      )
    : [];

  return (
    <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface-soft)] p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--foreground)]">
            Activity
          </h2>
          <div className="inline-flex rounded-full border border-[var(--border)] bg-[var(--surface)] p-0.5 text-xs font-semibold">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setPeriod(t.key)}
                className={`rounded-full px-3 py-1 transition ${
                  period === t.key
                    ? "bg-[var(--accent)] text-white"
                    : "text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <Link
          href="/admin/briefing"
          className="inline-flex items-center gap-1 text-xs font-bold text-[var(--accent)] hover:underline"
        >
          Open brief <ArrowRightIcon className="h-3.5 w-3.5" />
        </Link>
      </div>

      {brief && <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">{brief.headline}</p>}

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {loading && !brief
          ? [0, 1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-2xl bg-[var(--surface-alt)]" />
            ))
          : shown.map((m) => {
              const inner = (
                <>
                  <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
                    {m.label}
                  </p>
                  <div className="mt-1 flex items-baseline gap-1.5">
                    <span className="text-xl font-black tracking-tight text-[var(--foreground)]">
                      <Secret hidden={hidden}>{m.display}</Secret>
                    </span>
                    {!hidden && <Delta metric={m} />}
                  </div>
                </>
              );
              const cls =
                "block rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left transition";
              return m.href ? (
                <Link
                  key={m.key}
                  href={m.href}
                  title="Open the list"
                  className={`${cls} hover:border-[var(--accent)]/40 hover:shadow-sm`}
                >
                  {inner}
                </Link>
              ) : (
                <div key={m.key} className={cls}>
                  {inner}
                </div>
              );
            })}
      </div>
    </div>
  );
}
