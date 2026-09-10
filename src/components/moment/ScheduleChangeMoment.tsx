"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Mascot from "@/components/Mascot";
import { useMoment } from "@/lib/moment-queue";

/**
 * "YOUR CLASS TIME CHANGED."
 *
 * The office switched a sitting (or an attendance mode) off on /admin/settings,
 * and this student was moved to the nearest one that still runs. A bell
 * notification and a portal card go out from the same action, but a change to
 * *when your class meets* is big enough that it should also be said to the
 * student's face on their next page. Becca delivers it.
 *
 * Queue-managed, so it never fights the welcome tour or a celebration, and it
 * drops to the dock if the visit's two-modal cap is already spent. Keyed on the
 * change's timestamp (sessionStorage), so a later change greets them again but
 * this one does not nag.
 */

type ScheduleChange = {
  kind: "slot" | "mode";
  level: string;
  from: string;
  to: string;
  at: string;
};

const SEEN_KEY = "easyway-schedule-change-seen";

function lastSeenAt(): string {
  try {
    return window.sessionStorage.getItem(SEEN_KEY) || "";
  } catch {
    return "";
  }
}

function markSeen(at: string) {
  try {
    window.sessionStorage.setItem(SEEN_KEY, at);
  } catch {
    /* fine — it just offers to greet again next session */
  }
}

const titleCase = (value: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value);

function describe(change: ScheduleChange): string {
  if (change.kind === "slot") {
    return `Your ${change.level} class now runs in the ${titleCase(change.to)} session${
      change.from ? ` — it used to be ${titleCase(change.from)}` : ""
    }.`;
  }
  const to = change.to === "physical" ? "on campus" : change.to;
  return `You're now attending your ${change.level} class ${to}${
    change.from ? ` (it was ${change.from})` : ""
  }.`;
}

export default function ScheduleChangeMoment() {
  const [change, setChange] = useState<ScheduleChange | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/student/schedule-change", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        const next: ScheduleChange | null = data?.change ?? null;
        if (next && next.at !== lastSeenAt()) setChange(next);
        setChecked(true);
      })
      .catch(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const due = Boolean(checked && change);
  const { open, close } = useMoment("class-schedule-changed", due);

  if (!open || !change || typeof document === "undefined") return null;

  const dismiss = () => {
    markSeen(change.at);
    close();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-5"
      role="dialog"
      aria-modal="true"
      aria-label="Your class schedule changed"
    >
      <div className="w-full max-w-sm overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--surface)] text-center shadow-[0_30px_80px_-20px_rgba(0,0,0,0.5)]">
        <div className="bg-[var(--accent-soft)] px-6 pt-6">
          <Mascot mood="presenting" className="mx-auto h-20 w-20" />
        </div>
        <div className="p-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--accent)]">
            Your class schedule changed
          </p>
          <h2 className="mt-1.5 text-lg font-bold text-[var(--foreground)]">
            {change.kind === "slot" ? "New class time" : "New way to attend"}
          </h2>

          <div className="mt-3 rounded-2xl bg-[var(--surface-alt)] p-3.5 text-left">
            <p className="text-sm leading-6 text-[var(--foreground-soft)]">{describe(change)}</p>
            <p className="mt-2 text-xs text-[var(--muted)]">
              Your timetable, your tutor and your class community are already updated to match. If this
              does not work for you, message the office and we will sort it out.
            </p>
          </div>

          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                markSeen(change.at);
                close();
                window.location.assign("/dashboard");
              }}
              className="rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
            >
              See my dashboard
            </button>
            <button type="button" onClick={dismiss} className="text-xs font-medium text-[var(--muted)]">
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
