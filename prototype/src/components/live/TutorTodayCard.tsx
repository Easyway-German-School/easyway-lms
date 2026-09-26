"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { BroadcastIcon, CheckCircleIcon, UsersIcon, VideoIcon } from "@/components/icons";

/**
 * TWO CLICKS TO LIVE.
 *
 * Everything this card needs — which of a tutor's classes is the one sitting
 * in front of them right now, whether today's register is done, whether a
 * room is already open — is answered server-side by `/api/lecturer/today` (see
 * `lib/tutor-today.ts`). That is the whole point: a tutor used to have to tell
 * the portal something it already knew (which class, which date) before they
 * could act on it. This card skips straight to the one action worth taking.
 *
 * "Go live" is click one. It opens that class's lobby with the class already
 * chosen — no group-chooser page in between, even for a tutor who teaches
 * three cohorts — and "Start the class" there is click two.
 *
 * Renders nothing once a room is actually open: `TutorLivePanel`, mounted
 * alongside this on the dashboard, owns that view (the join code, who has
 * turned up). The two are mutually exclusive by construction — this card
 * only ever shows the class that ISN'T live yet.
 */

export type TodayGroup = {
  key: string;
  label: string;
  batchRange: string;
  studentCount: number;
  state: "now" | "soon" | "done" | "later" | "not-today";
  note: string;
};

export type TodayState = {
  assigned: boolean;
  groups: TodayGroup[];
  focusKey: string | null;
  register: { total: number; marked: number; takenToday: boolean } | null;
  live: { id: string; title: string; joinCode: string; startedAt: string } | null;
};

const STATE_TONE: Record<TodayGroup["state"], string> = {
  now: "text-emerald-600 bg-emerald-500/10",
  soon: "text-amber-600 bg-amber-500/10",
  done: "text-[var(--muted)] bg-[var(--surface-alt)]",
  later: "text-[var(--muted)] bg-[var(--surface-alt)]",
  "not-today": "text-[var(--muted)] bg-[var(--surface-alt)]",
};

export default function TutorTodayCard({ className = "" }: { className?: string }) {
  const [data, setData] = useState<TodayState | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/lecturer/today", { cache: "no-store" });
      if (!res.ok) return;
      setData(await res.json());
    } catch {
      // A failed poll leaves whatever was last known on screen — same call
      // TutorLivePanel makes for the same reason.
    }
  }, []);

  /** A minute is plenty: unlike the roster panel, nobody is watching this tick by second. */
  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  return <TodayCardView data={data} className={className} />;
}

/** The card itself, from data already in hand — kept apart so it can be rendered and tested without a network. */
export function TodayCardView({ data, className = "" }: { data: TodayState | null; className?: string }) {
  if (!data || !data.assigned || data.live || data.groups.length === 0) return null;

  const focus = data.groups.find((group) => group.key === data.focusKey) ?? data.groups[0];
  const others = data.groups.filter((group) => group.key !== focus.key);
  const registerDone = data.register?.takenToday ?? false;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`overflow-hidden rounded-3xl border border-[#0D7C7E]/25 bg-gradient-to-br from-[#0D7C7E]/10 via-[var(--surface)] to-[var(--surface)] shadow-lg ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#0D7C7E]/15 text-[#0D7C7E]">
            <BroadcastIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] ${STATE_TONE[focus.state]}`}
            >
              {focus.note}
            </p>
            <h2 className="mt-1 truncate text-lg font-bold text-[var(--foreground)] sm:text-xl">{focus.label}</h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-[var(--muted)]">
              <UsersIcon className="h-3.5 w-3.5 shrink-0" />
              {focus.studentCount} student{focus.studentCount === 1 ? "" : "s"}
              <span aria-hidden="true">·</span>
              {registerDone ? (
                <span className="inline-flex items-center gap-1 font-medium text-emerald-600">
                  <CheckCircleIcon className="h-3.5 w-3.5" />
                  Register taken
                </span>
              ) : (
                <Link href="/lecturer/attendance" className="font-semibold text-[var(--accent)] hover:underline">
                  Register not taken yet
                </Link>
              )}
            </p>
          </div>
        </div>

        <Link
          href={`/live?group=${encodeURIComponent(focus.key)}`}
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[#0D7C7E] px-6 py-3 text-sm font-bold text-white shadow-lg transition hover:brightness-110"
        >
          <VideoIcon className="h-4 w-4" />
          Go live
        </Link>
      </div>

      {/* A tutor whose auto-picked focus is not the one they meant to start
          switches with one more click, rather than being stuck with a
          guess. Each pill still lands straight in that class's lobby. */}
      {others.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] px-5 pb-5 pt-4 sm:px-6">
          <span className="text-xs font-semibold text-[var(--foreground-soft)]">Not this one?</span>
          {others.map((group) => (
            <Link
              key={group.key}
              href={`/live?group=${encodeURIComponent(group.key)}`}
              className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs font-semibold text-[var(--foreground-soft)] transition hover:border-[#0D7C7E]/40 hover:text-[var(--foreground)]"
            >
              Go live · {group.label}
            </Link>
          ))}
        </div>
      )}
    </motion.div>
  );
}
