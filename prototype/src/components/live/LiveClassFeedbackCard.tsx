"use client";

import { useEffect, useState } from "react";
import Mascot from "@/components/Mascot";
import LiveFeedbackForm, { feedbackHeading, skippedSessions, type FeedbackRole } from "./LiveFeedbackForm";

/**
 * "HOW WAS TODAY'S CLASS?" — the card on the end-of-class screen, for students and
 * for the tutor who taught it.
 *
 * It asks the server whether THIS class is waiting for the viewer's rating (see
 * /api/live/feedback and lib/live-feedback.ts for who is asked, and how often).
 * Anyone who leaves without answering is asked again by the popup on their next
 * visit (components/moment/LiveFeedbackMoment.tsx), so closing the tab loses
 * nothing.
 */
export default function LiveClassFeedbackCard({
  liveSessionId,
  sessionTitle,
}: {
  liveSessionId: string | null;
  sessionTitle: string;
}) {
  const [role, setRole] = useState<FeedbackRole | null>(null);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (!liveSessionId) return;
    let cancelled = false;
    fetch(`/api/live/feedback?sessionId=${encodeURIComponent(liveSessionId)}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { due: false }))
      .then((data: { due?: boolean; role?: FeedbackRole }) => {
        if (!cancelled && data.due && data.role && !skippedSessions().includes(liveSessionId)) setRole(data.role);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [liveSessionId]);

  if (!liveSessionId || !role || finished) return null;

  return (
    <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <Mascot mood="curious" className="h-14 w-14 shrink-0" />
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--accent)]">Becca asks</p>
          <h2 className="mt-1 text-lg font-bold text-[var(--foreground)]">{feedbackHeading(role)}</h2>
        </div>
      </div>
      <div className="mt-4">
        <LiveFeedbackForm
          sessionId={liveSessionId}
          sessionTitle={sessionTitle}
          role={role}
          onDone={(outcome) => {
            // A sent card keeps its thank-you on screen (the form waits before
            // calling this); a skip just tucks the card away.
            if (outcome === "skipped" || outcome === "sent") setFinished(true);
          }}
        />
      </div>
    </div>
  );
}
