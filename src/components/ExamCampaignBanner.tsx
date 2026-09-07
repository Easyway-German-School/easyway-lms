"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRightIcon, ClockIcon } from "@/components/icons";
import {
  campaignPhase,
  deadlineCountdown,
  examDatesLabel,
  type ExamCampaignConfig,
} from "@/lib/exam-campaign";

/**
 * The pinned exam-campaign strip. Same data and actions as the daily popup
 * (ExamCampaignMoment) but it does not interrupt — it just sits at the top of
 * the community view and the dashboard for as long as the campaign runs and
 * the student has not marked themselves registered. This is the "always on
 * screen" half of the ask; the popup is the "once a day, in your face" half.
 *
 * Not dismissible on purpose: "I've already registered" is the only way to
 * clear it, and that also silences the popup and the reminder emails.
 */

type Props = {
  /** "banner" (full width, dashboard) or "pinned" (tighter, inside the community column). */
  variant?: "banner" | "pinned";
  className?: string;
};

export default function ExamCampaignBanner({ variant = "banner", className = "" }: Props) {
  const [config, setConfig] = useState<ExamCampaignConfig | null>(null);
  const [registered, setRegistered] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/student/exam-campaign", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!alive || !data?.campaign) return;
        setConfig(data.campaign as ExamCampaignConfig);
        setRegistered(Boolean(data.response?.registered));
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const markRegistered = useCallback(async () => {
    setSaving(true);
    try {
      await fetch("/api/student/exam-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "registered" }),
      });
      setRegistered(true);
    } catch {
      /* leave it up — the cron reminder is the backstop */
    } finally {
      setSaving(false);
    }
  }, []);

  if (!loaded || !config || registered) return null;
  const phase = campaignPhase(config);
  if (phase !== "open" && phase !== "closing-soon") return null;

  const countdown = deadlineCountdown(config);
  const closingSoon = phase === "closing-soon";
  const tight = variant === "pinned";

  const card = (
    <div
      className={`relative overflow-hidden rounded-2xl border text-white ${
        closingSoon ? "border-[#B91C1C]/40" : "border-[#0D7C7E]/40"
      } bg-gradient-to-br from-[#0D7C7E] via-[#0D7C7E] to-[#FF6600] ${tight ? "p-3.5" : "p-4 sm:p-5"} ${tight ? "" : className}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[10px] font-bold uppercase tracking-[0.24em] text-white/75">
          {config.examBody} exam · Lagos
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-bold">
          <ClockIcon className="h-3 w-3" />
          {countdown.started ? "closed" : `closes ${countdown.label}`}
        </span>
      </div>

      <p className={`mt-1.5 font-extrabold leading-snug ${tight ? "text-sm" : "text-base sm:text-lg"}`}>
        {config.title}
      </p>
      {!tight && (
        <p className="mt-1 text-xs text-white/80">
          {examDatesLabel(config)} · registered candidates get a free prep class.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href="/exams/osd"
          className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-xs font-bold text-[#0D7C7E] transition hover:bg-white/90"
        >
          Find out more <ArrowRightIcon className="h-3.5 w-3.5" />
        </Link>
        <button
          type="button"
          disabled={saving}
          onClick={markRegistered}
          className="rounded-full border border-white/40 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-white/10 disabled:opacity-60"
        >
          {saving ? "Saving…" : "I've registered"}
        </button>
      </div>
    </div>
  );

  // In the community column it sits as a bordered strip, like CommunityWins.
  if (tight) {
    return <div className={`border-b border-[var(--border)] px-3 py-2 ${className}`}>{card}</div>;
  }
  return card;
}
