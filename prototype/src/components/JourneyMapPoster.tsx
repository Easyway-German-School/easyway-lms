"use client";

import { useCallback, useEffect, useState } from "react";
import { CrossIcon, MapIcon } from "@/components/icons";
import {
  journeyMapSrc,
  journeyReminderDue,
  markJourneyReminderSeen,
} from "@/lib/journey-map";
import { useMoment } from "@/lib/moment-queue";

/**
 * The German Journey Map on the dashboard, and its once-a-day reminder.
 *
 * Two things in one component because they show the same picture and must not
 * be able to disagree about which level's it is.
 *
 * IT HIDES ITSELF WHEN THERE IS NO ARTWORK. The poster is dropped into
 * `public/journey/<LEVEL>.png` (see lib/journey-map). Until the file for a
 * student's level exists, this renders nothing at all — no card, no popup, no
 * broken-image icon. That is deliberate: the alternative is every student at a
 * level whose poster has not been drawn yet opening their dashboard to a torn
 * picture, which looks like a broken portal rather than a missing asset.
 */
export default function JourneyMapPoster({
  level,
  /** Set false on pages that should show the card but never interrupt. */
  withDailyReminder = true,
}: {
  level: string | null | undefined;
  withDailyReminder?: boolean;
}) {
  const src = journeyMapSrc(level);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [due, setDue] = useState(false);
  // Last in the moment queue. Lovely, never urgent — so on a busy first visit
  // it goes to the dock instead of being the third modal in a row.
  const { open: reminderOpen, close: releaseTurn } = useMoment("poster", due);

  // Probe rather than trust: an <img onError> would still flash the broken
  // icon, and this decides whether the card exists at all.
  useEffect(() => {
    let cancelled = false;
    const probe = new Image();
    probe.onload = () => {
      if (!cancelled) setAvailable(true);
    };
    probe.onerror = () => {
      if (!cancelled) setAvailable(false);
    };
    probe.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  useEffect(() => {
    if (available !== true || !withDailyReminder) return;
    if (!journeyReminderDue(level)) return;
    // A beat after load, so it does not race the dashboard's own rendering and
    // does not greet somebody before their name has appeared on the screen.
    const timer = window.setTimeout(() => setDue(true), 1200);
    return () => window.clearTimeout(timer);
  }, [available, withDailyReminder, level]);

  const dismiss = useCallback(() => {
    setDue(false);
    releaseTurn();
    markJourneyReminderSeen(level);
  }, [level, releaseTurn]);

  // Escape closes it, like every other dialog in the portal.
  useEffect(() => {
    if (!reminderOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reminderOpen, dismiss]);

  if (available !== true) return null;

  const upperLevel = String(level ?? "A1").toUpperCase();

  return (
    <>
      <section className="overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
              <MapIcon />
            </span>
            <div>
              <h2 className="text-lg font-bold text-[var(--foreground)]">Your German journey</h2>
              <p className="text-xs text-[var(--muted)]">Where {upperLevel} sits on the road to fluency</p>
            </div>
          </div>
          <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-bold text-[var(--accent)]">
            {upperLevel}
          </span>
        </div>

        <div className="bg-[var(--surface-alt)] p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={`The German journey map for ${upperLevel}`}
            className="mx-auto block h-auto w-full max-w-3xl rounded-2xl"
          />
        </div>
      </section>

      {reminderOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Your German journey"
          className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/60 p-4 backdrop-blur-sm"
        >
          {/* Tapping the backdrop closes it. A daily reminder that traps you
              is an advert, not a reminder. */}
          <button aria-label="Close" onClick={dismiss} className="absolute inset-0 cursor-default" />

          <div className="relative z-10 w-full max-w-2xl overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
              <div>
                <p className="text-[0.7rem] font-bold uppercase tracking-[0.24em] text-[var(--accent)]">
                  Where you are going
                </p>
                <h2 className="mt-1 text-lg font-bold text-[var(--foreground)]">Your {upperLevel} journey</h2>
              </div>
              <button
                onClick={dismiss}
                aria-label="Close"
                className="grid h-9 w-9 place-items-center rounded-xl text-[var(--muted)] transition hover:bg-[var(--surface-alt)]"
              >
                <CrossIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto bg-[var(--surface-alt)] p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={`The German journey map for ${upperLevel}`}
                className="mx-auto block h-auto w-full rounded-2xl"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-4">
              <p className="text-xs text-[var(--muted)]">It is on your dashboard whenever you want it.</p>
              <button
                onClick={dismiss}
                className="rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white"
              >
                Los geht&apos;s
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
