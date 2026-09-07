"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Mascot from "@/components/Mascot";
import { useMoment } from "@/lib/moment-queue";
import { ProfileDetailsWizard } from "@/components/ProfileDetailsPrompt";
import type { BackfillField, BackfillPrefill } from "@/lib/profile-backfill";

/**
 * "THE OFFICE SET YOU UP BY HAND — I'M JUST MISSING A FEW BITS."
 *
 * The dashboard-moment face of the profile backfill. Only ever due for a
 * student the office onboarded off-form who still has admission gaps (see
 * src/lib/profile-backfill.ts). Queue-managed at a low priority, so it never
 * fights the tour or a celebration and usually waits in the dock — the
 * /profile card and the weekly Becca nudge are the surfaces that actually
 * carry this. Mounted once in StudentShell, alongside OfficeReplyMoment.
 *
 * A "skip for now" from inside the wizard records a fortnight's snooze on the
 * server; this also drops a session flag so it does not re-open on the next
 * page within the same visit.
 */

const SESSION_HIDE_KEY = "easyway-profile-details-hidden";

type BackfillGet = {
  due: boolean;
  missing: BackfillField[];
  prefill: BackfillPrefill;
  studentName: string;
};

export default function ProfileDetailsMoment() {
  const [data, setData] = useState<BackfillGet | null>(null);
  const [checked, setChecked] = useState(false);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let hidden = false;
    try {
      hidden = window.sessionStorage.getItem(SESSION_HIDE_KEY) === "true";
    } catch {
      /* private mode — just proceed */
    }
    // Hidden for this visit: never fetch, never render. `checked` stays false,
    // which keeps `due` false — exactly the outcome we want.
    if (hidden) return;

    fetch("/api/student/profile/backfill", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return;
        if (body && body.due) {
          setData({
            due: true,
            missing: Array.isArray(body.missing) ? body.missing : [],
            prefill: body.prefill,
            studentName: body.studentName ?? "there",
          });
        } else {
          // Not an off-form student, or nothing left to ask — don't re-query
          // on every page this visit. (A completion elsewhere clears on reload.)
          try {
            window.sessionStorage.setItem(SESSION_HIDE_KEY, "true");
          } catch {
            /* fine */
          }
        }
        setChecked(true);
      })
      .catch(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const due = Boolean(checked && data && !finished);
  const { open, close } = useMoment("profile-details", due);

  function hideForVisit() {
    try {
      window.sessionStorage.setItem(SESSION_HIDE_KEY, "true");
    } catch {
      /* fine */
    }
    setFinished(true);
    close();
  }

  if (!open || !data || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-5"
      role="dialog"
      aria-modal="true"
      aria-label="A few profile details"
    >
      <div className="w-full max-w-md overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.5)]">
        <div className="bg-[var(--accent-soft)] px-6 pt-6 text-center">
          <Mascot mood="curious" className="mx-auto h-20 w-20" />
        </div>
        <div className="p-6">
          <p className="text-center text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--accent)]">
            Quick one from Becca
          </p>
          <h2 className="mt-1.5 text-center text-lg font-bold text-[var(--foreground)]">
            The office set you up by hand
          </h2>
          <p className="mt-1.5 text-center text-sm text-[var(--muted)]">
            So a few things from the usual sign-up form never got asked. {data.missing.length}{" "}
            {data.missing.length === 1 ? "question" : "questions"}, mostly filled in already.
          </p>

          <div className="mt-5">
            <ProfileDetailsWizard
              missing={data.missing}
              prefill={data.prefill}
              studentName={data.studentName}
              tone="modal"
              onDone={hideForVisit}
              onSkipAll={hideForVisit}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
