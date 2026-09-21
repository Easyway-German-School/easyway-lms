"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import Mascot from "@/components/Mascot";
import { useMoment } from "@/lib/moment-queue";
import { useStudentAccess } from "@/lib/useStudentAccess";

/**
 * "YOUR SEAT IS WAITING." — Becca's fee pop-up for a student who is locked out.
 *
 * The daily briefing already carries a balance reminder for a part-payer whose
 * portal is open, but it sits behind `hasAccess` — a student who has paid
 * nothing, or whose access was paused for an unpaid balance, never sees it. This
 * is the card for exactly them.
 *
 * Once a day at most, and the last thing the queue will offer: asking for money
 * before the tour, the goal question or a celebration is how a portal teaches
 * somebody to dismiss it. If the two-modal cap is spent it drops to the dock.
 *
 * The figures come from `useStudentAccess()` — the very payload the lock screen
 * renders — so the two can never quote different numbers. The office can switch
 * the whole thing off (Finance → Reminders); that switch is the one thing this
 * asks the server.
 */

const STORAGE_KEY = "ew-fee-reminder-day";

const naira = (value: number) => `₦${Math.max(0, Math.round(value)).toLocaleString("en-NG")}`;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

type Card = { headline: string; body: string; cta: string };

export default function FeeReminderMoment() {
  const { access, hasAccess } = useStudentAccess();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [seenToday, setSeenToday] = useState(false);

  useEffect(() => {
    try {
      setSeenToday(window.localStorage.getItem(STORAGE_KEY) === todayKey());
    } catch {
      /* private mode — show it; one repeat beats silence */
    }
  }, []);

  // Only ask the server once we know this student is locked out and would see a card.
  const locked = access !== null && !hasAccess;
  useEffect(() => {
    if (!locked || seenToday || enabled !== null) return;
    let cancelled = false;
    fetch("/api/student/fee-reminder", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setEnabled(data?.enabled === true);
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [locked, seenToday, enabled]);

  let card: Card | null = null;
  if (access && locked) {
    if (access.lockReason === "unsettled_balance" && access.outstandingBalance > 0) {
      card = {
        headline: "Your access is on hold",
        body: `${naira(access.outstandingBalance)} of your tuition is still owing. Settle it and your classes reopen straight away.`,
        cta: "Pay my balance",
      };
    } else if (access.lockReason === "upcoming_batch" && access.outstanding > 0) {
      card = {
        headline: `Confirm your ${access.batchLabel ?? "upcoming"} seat`,
        body: `${naira(access.outstanding)} confirms your seat before classes open. Full tuition is ${naira(access.tuitionFee)}.`,
        cta: "Confirm my seat",
      };
    } else if (access.lockReason === "unpaid_deposit" && access.outstanding > 0) {
      card =
        access.totalPaid > 0
          ? {
              headline: "Almost there",
              body: `Thank you for the ${naira(access.totalPaid)} so far. ${naira(access.outstanding)} more opens your classes.`,
              cta: "Finish my deposit",
            }
          : {
              headline: "Your seat is waiting",
              body: `You are registered, but no tuition has been paid yet, so your classes have not opened. ${naira(access.outstanding)} opens them (full tuition is ${naira(access.tuitionFee)}).`,
              cta: "Pay tuition",
            };
    }
  }

  const due = Boolean(card && enabled === true && !seenToday);
  const { open, close } = useMoment("fee-reminder", due);

  if (!open || !card || typeof document === "undefined") return null;

  const later = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, todayKey());
    } catch {
      /* one repeat beats a crash */
    }
    setSeenToday(true);
    close();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-5"
      role="dialog"
      aria-modal="true"
      aria-label={card.headline}
    >
      <div className="w-full max-w-sm overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--surface)] text-center shadow-[0_30px_80px_-20px_rgba(0,0,0,0.5)]">
        <div className="bg-[var(--accent-soft)] px-6 pt-6">
          <Mascot mood="greeting" className="mx-auto h-20 w-20" />
        </div>
        <div className="p-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--accent)]">Becca</p>
          <h2 className="mt-1.5 text-lg font-bold text-[var(--foreground)]">{card.headline}</h2>
          <p className="mt-3 text-sm leading-6 text-[var(--foreground-soft)]">{card.body}</p>

          <div className="mt-5 flex flex-col gap-2">
            <Link
              href="/programs"
              onClick={later}
              className="rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
            >
              {card.cta}
            </Link>
            <button type="button" onClick={later} className="text-xs font-medium text-[var(--muted)]">
              Later
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
