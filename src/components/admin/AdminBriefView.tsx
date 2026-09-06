"use client";

import Secret from "@/components/Secret";
import { TrendingUpIcon, TrendingDownIcon, SparklesIcon, AlertIcon, CheckCircleIcon } from "@/components/icons";

/**
 * Renders one office brief — headline, the figures with their deltas, and the
 * "what to act on" list. Shared by the full /admin/briefing page and the
 * once-a-day login card so the two never drift.
 *
 * Every figure goes through <Secret> so the dashboard's "Hide figures" toggle
 * blanks the brief too.
 */

export type BriefMetric = {
  key: string;
  label: string;
  value: number;
  display: string;
  format: "count" | "naira" | "percent";
  prev: number | null;
  prevDisplay: string | null;
  deltaPct: number | null;
  higherIsBetter: boolean;
  hint?: string;
};

export type BriefFlag = { level: "good" | "watch" | "bad"; text: string };

export type Brief = {
  period: "daily" | "weekly" | "monthly";
  rangeLabel: string;
  comparedTo: string;
  generatedAt: string;
  headline: string;
  metrics: BriefMetric[];
  flags: BriefFlag[];
  advice: string[] | null;
  scope: { money: boolean; students: boolean; attendance: boolean };
};

function DeltaBadge({ metric }: { metric: BriefMetric }) {
  if (metric.deltaPct === null) {
    return (
      <span className="text-[11px] font-medium text-[var(--muted)]">
        {metric.prev === 0 && metric.value > 0 ? "new" : `vs ${metric.prevDisplay ?? "—"}`}
      </span>
    );
  }
  const up = metric.deltaPct >= 0;
  const good = metric.higherIsBetter ? up : !up;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-bold ${
        metric.deltaPct === 0
          ? "text-[var(--muted)]"
          : good
            ? "text-emerald-600"
            : "text-red-600"
      }`}
    >
      {metric.deltaPct !== 0 &&
        (up ? <TrendingUpIcon className="h-3 w-3" /> : <TrendingDownIcon className="h-3 w-3" />)}
      {up ? "+" : ""}
      {metric.deltaPct}%
    </span>
  );
}

export default function AdminBriefView({
  brief,
  hidden = false,
  compact = false,
}: {
  brief: Brief;
  hidden?: boolean;
  compact?: boolean;
}) {
  const flagIcon = (level: BriefFlag["level"]) =>
    level === "good" ? (
      <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
    ) : (
      <AlertIcon
        className={`mt-0.5 h-4 w-4 shrink-0 ${level === "bad" ? "text-red-600" : "text-amber-600"}`}
      />
    );

  return (
    <div className="space-y-5">
      <p className="text-lg font-bold leading-snug text-[var(--foreground)]">{brief.headline}</p>

      <div
        className={`grid gap-3 ${
          compact ? "grid-cols-2 sm:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-3"
        }`}
      >
        {brief.metrics.map((m) => (
          <div
            key={m.key}
            className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5"
            title={m.hint}
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
              {m.label}
            </p>
            <div className="mt-1.5 flex items-baseline justify-between gap-2">
              <span className="text-2xl font-black tracking-tight text-[var(--foreground)]">
                <Secret hidden={hidden}>{m.display}</Secret>
              </span>
              {!hidden && <DeltaBadge metric={m} />}
            </div>
            {m.hint && !compact && (
              <p className="mt-1 text-[11px] leading-snug text-[var(--muted)]">{m.hint}</p>
            )}
          </div>
        ))}
      </div>

      {Boolean(brief.advice?.length || brief.flags.length) && (
        <div className="rounded-2xl border border-[var(--accent)]/25 bg-[var(--accent)]/5 p-4">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.16em] text-[var(--accent)]">
            <SparklesIcon className="h-3.5 w-3.5" />
            {brief.advice?.length ? "What to act on" : "Flags"}
          </p>
          <ul className="mt-2.5 space-y-2">
            {brief.advice?.length
              ? brief.advice.map((line, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm leading-snug text-[var(--foreground)]">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                    {line}
                  </li>
                ))
              : brief.flags.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm leading-snug text-[var(--foreground)]">
                    {flagIcon(f.level)}
                    {f.text}
                  </li>
                ))}
          </ul>
          {brief.advice?.length ? (
            <p className="mt-3 text-[10px] text-[var(--muted)]">
              Written from the figures above. Numbers are always from a live lookup.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
