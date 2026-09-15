"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Mascot from "@/components/Mascot";
import { useMoment } from "@/lib/moment-queue";
import { ArrowRightIcon, CalendarIcon, CheckCircleIcon, ClockIcon, MapIcon } from "@/components/icons";
import {
  campaignPhase,
  deadlineCountdown,
  examDatesLabel,
  formatMoney,
  lowestFee,
  type ExamCampaignConfig,
} from "@/lib/exam-campaign";

/**
 * "THE ÖSD EXAM IS NOW IN LAGOS — REGISTER BEFORE IT CLOSES."
 *
 * Becca brings it once a calendar day, on the first portal page the student
 * lands on, for as long as the campaign runs and they have not marked
 * themselves registered. Deliberately SHORT — three facts, a countdown and
 * three buttons; the whole story is one tap away on /exams/osd.
 *
 * Queue-managed at priority 63 (see moment-queue.tsx): below a finished lesson
 * or an office reply, above the standing notification ask and the daily
 * briefing. Once-per-day is a localStorage day-key stamped ON CLOSE, so a
 * briefing the queue held back is not marked seen. "I've registered" writes
 * through to the server and stops the popup, the banner and the 3×/week
 * reminder for good.
 */

type Response = { registered: boolean; enquired: boolean };

function todayKey(): string {
  const n = new Date();
  return `${n.getFullYear()}-${n.getMonth() + 1}-${n.getDate()}`;
}

const STORAGE_KEY = "ew-exam-campaign-day";

export default function ExamCampaignMoment() {
  const router = useRouter();
  const [config, setConfig] = useState<ExamCampaignConfig | null>(null);
  const [response, setResponse] = useState<Response>({ registered: false, enquired: false });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;

    let seenToday = false;
    try {
      seenToday = window.localStorage.getItem(STORAGE_KEY) === todayKey();
    } catch {
      /* private mode — let it show */
    }
    if (seenToday) {
      setLoaded(true);
      return;
    }

    fetch("/api/student/exam-campaign", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!alive || !data?.campaign) return;
        setConfig(data.campaign as ExamCampaignConfig);
        setResponse(data.response ?? { registered: false, enquired: false });
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoaded(true);
      });

    return () => {
      alive = false;
    };
  }, []);

  const phase = config ? campaignPhase(config) : "disabled";
  const due =
    loaded &&
    !!config &&
    !response.registered &&
    (phase === "open" || phase === "closing-soon");

  const { open, close } = useMoment("exam-campaign", due);

  const stampAndClose = useCallback(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, todayKey());
    } catch {
      /* one repeat beats a crash */
    }
    close();
  }, [close]);

  const markRegistered = useCallback(async () => {
    setSaving(true);
    try {
      await fetch("/api/student/exam-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "registered" }),
      });
      setResponse((r) => ({ ...r, registered: true }));
    } catch {
      /* the popup still closes; the server retry is the reminder cron */
    } finally {
      setSaving(false);
      stampAndClose();
    }
  }, [stampAndClose]);

  const findOutMore = useCallback(() => {
    stampAndClose();
    router.push("/exams/osd");
  }, [router, stampAndClose]);

  if (!open || !config || typeof document === "undefined") return null;

  const countdown = deadlineCountdown(config);
  const closingSoon = phase === "closing-soon";

  return createPortal(
    <div
      className="fixed inset-0 z-[120] grid place-items-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={config.title}
    >
      <div className="my-auto w-full max-w-md overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.55)]">
        {/* Hero band */}
        <div className="relative overflow-hidden bg-gradient-to-br from-[#0D7C7E] via-[#0D7C7E] to-[#FF6600] px-6 pb-6 pt-7 text-white">
          <div className="flex items-start gap-3">
            <Mascot mood="presenting" className="h-20 w-20 shrink-0 drop-shadow-xl" />
            <div className="min-w-0 flex-1 pt-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-white/75">
                {config.examBody} exam · now in Nigeria
              </p>
              <h2 className="mt-1.5 text-lg font-extrabold leading-snug">{config.title}</h2>
            </div>
          </div>

          <div
            className={`mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${
              closingSoon ? "bg-white text-[#B91C1C]" : "bg-white/15 text-white"
            }`}
          >
            <ClockIcon className="h-3.5 w-3.5" />
            {countdown.started
              ? "Registration has closed"
              : `Registration closes ${countdown.label} · ${new Date(
                  `${config.registrationDeadline}T12:00:00Z`,
                ).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })}`}
          </div>
        </div>

        {/* Three facts */}
        <div className="space-y-2.5 px-6 pt-5">
          <Fact icon={<CalendarIcon className="h-4 w-4" />} label="Exam dates" value={examDatesLabel(config)} />
          <Fact
            icon={<MapIcon className="h-4 w-4" />}
            label="Where"
            value={`${config.venues[0]?.address ?? "Ikeja, Lagos"}`}
          />
          <Fact
            icon={<CheckCircleIcon className="h-4 w-4" />}
            label="Fees"
            value={`From ${formatMoney(lowestFee(config), config.currency)} · free prep class included`}
          />
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 p-6 pt-5">
          <button
            type="button"
            onClick={findOutMore}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-bold text-white transition hover:brightness-110"
          >
            Find out more <ArrowRightIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={markRegistered}
            className="rounded-full border border-[var(--border)] px-6 py-2.5 text-sm font-semibold text-[var(--foreground-soft)] transition hover:bg-[var(--surface-alt)] disabled:opacity-60"
          >
            {saving ? "Saving…" : "I've already registered"}
          </button>
          <button
            type="button"
            onClick={stampAndClose}
            className="mt-0.5 text-xs font-medium text-[var(--muted)]"
          >
            Remind me later
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-[var(--surface-alt)] p-3">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{label}</p>
        <p className="text-sm font-semibold text-[var(--foreground)]">{value}</p>
      </div>
    </div>
  );
}
