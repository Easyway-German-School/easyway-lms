"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Mascot from "@/components/Mascot";
import { useMoment } from "@/lib/moment-queue";
import { buildTutorials, writeTutorialRun } from "@/lib/tutorials";

/**
 * "Come see the new Tutorials page" — a one-time advert for every student
 * whose portal is already unlocked, aimed especially at anyone who finds the
 * LMS hard to navigate. Fires once, ever, the first time each of them opens
 * the portal after this ships — no cron, no push notification, just the
 * moment queue and a server-side seen flag (`Student.tutorialsPromoSeenAt`),
 * same shape as WelcomeTour's own `welcomeTourSeenAt`.
 *
 * The primary action skips the catalog page entirely and starts the
 * dashboard tour immediately — one tap, no second screen to abandon on.
 */
export default function TutorialsPromoMoment() {
  const router = useRouter();
  const [due, setDue] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/student/tutorials-promo", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { due?: boolean } | null) => {
        if (cancelled) return;
        setDue(Boolean(data?.due));
        setChecked(true);
      })
      .catch(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { open, close } = useMoment("tutorials-promo", checked && due);

  const markSeen = () => {
    void fetch("/api/student/tutorials-promo", { method: "POST" }).catch(() => {});
  };

  if (!open || typeof document === "undefined") return null;

  const startDashboardTour = () => {
    markSeen();
    const dashboardTour = buildTutorials()[0];
    const firstStep = dashboardTour.steps[0];
    const expectedRoute = firstStep.route ?? "/dashboard";
    writeTutorialRun({ tutorialId: dashboardTour.id, stepIndex: 0, muted: false, expectedRoute });
    close();
    if (expectedRoute !== window.location.pathname) router.push(expectedRoute);
  };

  const browseAll = () => {
    markSeen();
    close();
    router.push("/tutorials");
  };

  const dismiss = () => {
    markSeen();
    close();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-5"
      role="dialog"
      aria-modal="true"
      aria-label="New: guided tutorials"
    >
      <div className="w-full max-w-sm overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--surface)] text-center shadow-[0_30px_80px_-20px_rgba(0,0,0,0.5)]">
        <div className="bg-[var(--accent-soft)] px-6 pt-6">
          <Mascot mood="cheerful" className="mx-auto h-20 w-20" />
        </div>
        <div className="p-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--accent)]">
            New from Becca
          </p>
          <h2 className="mt-1.5 text-lg font-bold text-[var(--foreground)]">
            Still finding your way around?
          </h2>

          <div className="mt-3 rounded-2xl bg-[var(--surface-alt)] p-3.5 text-left">
            <p className="text-sm leading-6 text-[var(--foreground-soft)]">
              I recorded six short tours — dashboard, classes, payments and more — so you never
              have to guess where anything is. No reading required: tap play and I&apos;ll walk
              you through it, one page at a time.
            </p>
          </div>

          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
              onClick={startDashboardTour}
              className="rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
            >
              Show me the dashboard
            </button>
            <button type="button" onClick={browseAll} className="text-xs font-semibold text-[var(--accent)]">
              See all six tours
            </button>
            <button type="button" onClick={dismiss} className="text-xs font-medium text-[var(--muted)]">
              Maybe later
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
