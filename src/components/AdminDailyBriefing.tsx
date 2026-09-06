"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Secret from "@/components/Secret";
import { usePrivacyMode } from "@/lib/use-privacy-mode";
import { CrossIcon, PulseIcon, SparklesIcon } from "@/components/icons";
import type { Brief } from "@/components/admin/AdminBriefView";

/**
 * The office's "good morning" — once a day, on the first admin page they land
 * on, a card with what happened yesterday/so far today and the one thing worth
 * doing about it. The admin counterpart to the students' Becca brief.
 *
 * Once per day: a localStorage date-key, stamped on close. Never on the full
 * brief page itself (they are already looking at it), and it waits a beat after
 * mount so it does not race the page in.
 */

const SEEN_KEY = "easyway:admin-brief-seen";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function seenToday(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === today();
  } catch {
    return false;
  }
}

export default function AdminDailyBriefing() {
  const pathname = usePathname();
  const { hidden } = usePrivacyMode();
  const [brief, setBrief] = useState<Brief | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (pathname === "/admin/briefing") return;
    if (seenToday()) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/admin/brief?period=daily", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data: Brief = await res.json();
        if (cancelled) return;
        setBrief(data);
        setOpen(true);
      } catch {
        /* No brief, no card — the dashboard still has the activity strip. */
      }
    }, 1200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pathname]);

  const dismiss = () => {
    try {
      window.localStorage.setItem(SEEN_KEY, today());
    } catch {
      /* Still close it for this view. */
    }
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open || !brief) return null;

  const topMetrics = brief.metrics.slice(0, 4);
  const topAction = brief.advice?.[0] ?? brief.flags[0]?.text ?? null;
  // The advice line links to the list it is about, when we mapped one; else
  // fall back to whichever headline metric has a destination.
  const topActionHref =
    (brief.advice?.length ? brief.adviceTargets?.[0] : null) ??
    topMetrics.find((m) => m.href)?.href ??
    null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/40 p-4 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_28px_80px_rgba(15,23,42,0.3)]">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
              <PulseIcon className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
                Office brief
              </p>
              <p className="text-sm font-bold">Good morning</p>
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="rounded-full p-1.5 text-[var(--muted)] transition hover:bg-[var(--surface-alt)]"
          >
            <CrossIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <p className="text-base font-bold leading-snug text-[var(--foreground)]">{brief.headline}</p>

          <div className="grid grid-cols-2 gap-2.5">
            {topMetrics.map((m) => {
              const inner = (
                <>
                  <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
                    {m.label}
                  </p>
                  <p className="mt-0.5 text-lg font-black tracking-tight text-[var(--foreground)]">
                    <Secret hidden={hidden}>{m.display}</Secret>
                  </p>
                </>
              );
              const cls = "block rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-3 text-left";
              return m.href ? (
                <Link key={m.key} href={m.href} onClick={dismiss} className={`${cls} transition hover:border-[var(--accent)]/40`}>
                  {inner}
                </Link>
              ) : (
                <div key={m.key} className={cls}>
                  {inner}
                </div>
              );
            })}
          </div>

          {topAction && (
            <div className="rounded-2xl border border-[var(--accent)]/25 bg-[var(--accent)]/5 p-3.5">
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--accent)]">
                <SparklesIcon className="h-3 w-3" />
                {brief.advice?.length ? "Do this first" : "Heads up"}
              </p>
              {topActionHref ? (
                <Link
                  href={topActionHref}
                  onClick={dismiss}
                  className="mt-1.5 block text-sm leading-snug text-[var(--foreground)] underline-offset-2 hover:underline"
                >
                  {topAction}
                </Link>
              ) : (
                <p className="mt-1.5 text-sm leading-snug text-[var(--foreground)]">{topAction}</p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-3">
          <button
            type="button"
            onClick={dismiss}
            className="text-sm font-semibold text-[var(--muted)] transition hover:text-[var(--foreground)]"
          >
            Dismiss
          </button>
          <Link
            href="/admin/briefing"
            onClick={dismiss}
            className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white transition hover:brightness-110"
          >
            Open full brief
          </Link>
        </div>
      </div>
    </div>
  );
}
