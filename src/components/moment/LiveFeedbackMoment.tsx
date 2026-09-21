"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import Mascot from "@/components/Mascot";
import LiveFeedbackForm, { feedbackHeading, skippedSessions, type FeedbackRole } from "@/components/live/LiveFeedbackForm";
import { useMoment } from "@/lib/moment-queue";

type Due = { id: string; title: string; role: FeedbackRole };

/**
 * "How was your last class?" — the popup that finds a student or a tutor who left
 * a live class without rating it (closed the tab, lost signal, never saw the end
 * screen) and asks once they are back in the portal.
 *
 * The same component serves both shells. In the student shell it takes its turn
 * in the moment queue like every other interruption; the tutor shell has no
 * queue, and `useMoment` then simply opens whenever it is due.
 *
 * It never appears mid-class (a student whose class is on air, anyone inside
 * /live) — the ask is about a class that is over. "Not now" is remembered per
 * class on this device; a rating (or one given from another device) ends it.
 * Who is asked, and how often, is decided on the server: lib/live-feedback.ts.
 */
export default function LiveFeedbackMoment({ suspended = false }: { suspended?: boolean }) {
  const pathname = usePathname() ?? "";
  const inClassroom = pathname.startsWith("/live");
  const [due, setDue] = useState<Due | null>(null);

  useEffect(() => {
    if (suspended || inClassroom) return;
    let cancelled = false;
    fetch("/api/live/feedback", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { due: false }))
      .then((data: { due?: boolean; role?: FeedbackRole; session?: { id: string; title: string } }) => {
        if (cancelled || !data.due || !data.session || !data.role) return;
        if (skippedSessions().includes(data.session.id)) return;
        setDue({ id: data.session.id, title: data.session.title, role: data.role });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // Re-asked when leaving the classroom, which is exactly when a class has just ended.
  }, [suspended, inClassroom]);

  const { open, close } = useMoment("live-feedback", Boolean(due) && !suspended && !inClassroom);

  if (!open || !due || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-5"
      role="dialog"
      aria-modal="true"
      aria-label="Rate your class"
    >
      <div className="w-full max-w-sm overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.5)]">
        <div className="bg-[var(--accent-soft)] px-6 pt-6 text-center">
          <Mascot mood="curious" className="mx-auto h-20 w-20" />
        </div>
        <div className="p-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--accent)]">Becca asks</p>
          <h2 className="mt-1.5 text-lg font-bold text-[var(--foreground)]">{feedbackHeading(due.role)}</h2>
          <div className="mt-4">
            <LiveFeedbackForm
              sessionId={due.id}
              sessionTitle={due.title}
              role={due.role}
              onDone={() => {
                setDue(null);
                close();
              }}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
