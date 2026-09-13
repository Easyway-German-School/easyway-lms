"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Mascot from "@/components/Mascot";
import { useMoment } from "@/lib/moment-queue";
import { KIND } from "@/lib/notification-kinds";

/**
 * "YOU CAN SUBMIT ASSIGNMENTS NOW."
 *
 * The bell rings and the phone buzzes the moment a student's portal unlocks
 * with work already waiting for them (see assignment-availability-nudge.ts),
 * but a bell that nobody happens to open might as well not have rung. This
 * puts Becca in front of the same message on the student's very next page.
 *
 * Reuses the bell's own unread feed rather than a second endpoint: the exact
 * notification that rang is what is shown here, and "Later" marks it read
 * through the same `/api/notifications` PATCH the bell itself uses — so this
 * greets the student exactly once, on whichever page loads first, and never
 * disagrees with what the bell already knows.
 */

type Ping = { id: string; message: string; link: string | null };

export default function AssignmentsOpenMoment() {
  const [ping, setPing] = useState<Ping | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/notifications?unread=true&limit=25", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        const hit = (data?.notifications ?? []).find(
          (n: { kind?: string }) => n.kind === KIND.assignmentsAvailable,
        );
        if (hit) setPing({ id: hit.id, message: hit.message, link: hit.link ?? null });
        setChecked(true);
      })
      .catch(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const due = Boolean(checked && ping);
  const { open, close } = useMoment("assignments-open", due);

  if (!open || !ping || typeof document === "undefined") return null;

  const markRead = () => {
    fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notificationIds: [ping.id] }),
    }).catch(() => {});
  };

  const openAssignments = () => {
    markRead();
    close();
    window.location.assign(ping.link || "/assignment");
  };

  const dismiss = () => {
    markRead();
    close();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-5"
      role="dialog"
      aria-modal="true"
      aria-label="Assignments are open"
    >
      <div className="w-full max-w-sm overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--surface)] text-center shadow-[0_30px_80px_-20px_rgba(0,0,0,0.5)]">
        <div className="bg-[var(--accent-soft)] px-6 pt-6">
          <Mascot mood="presenting" className="mx-auto h-20 w-20" />
        </div>
        <div className="p-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--accent)]">Becca</p>
          <h2 className="mt-1.5 text-lg font-bold text-[var(--foreground)]">You can submit assignments now</h2>

          <div className="mt-3 rounded-2xl bg-[var(--surface-alt)] p-3.5 text-left">
            <p className="text-sm leading-6 text-[var(--foreground-soft)]">{ping.message}</p>
          </div>

          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
              onClick={openAssignments}
              className="rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
            >
              See my assignments
            </button>
            <button type="button" onClick={dismiss} className="text-xs font-medium text-[var(--muted)]">
              Later
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
