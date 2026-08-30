"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Mascot from "@/components/Mascot";
import { useMoment } from "@/lib/moment-queue";
import { useIsInstalledApp } from "@/lib/client/standalone";
import { useStudentAccess } from "@/lib/useStudentAccess";
import { isPhysicalGroupStudent } from "@/lib/delivery";

/**
 * "Install the app to keep your class notes offline."
 *
 * Physical group students get no video downloads — they sit in the room — but
 * the ready-made notes and their own notebook are worth having in your pocket
 * on the bus home. This is the one nudge that says so. Lowest priority in the
 * moment queue, snoozed for a week once dismissed, and gone for good once the
 * app is installed.
 */
const SNOOZE_KEY = "easyway-install-notes-moment";
const SNOOZE_MS = 7 * 24 * 3_600_000;

function snoozed(): boolean {
  try {
    const at = Number(window.localStorage.getItem(SNOOZE_KEY) || 0);
    return at > 0 && Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
}

export default function InstallForNotesMoment() {
  const installed = useIsInstalledApp();
  const { access } = useStudentAccess();
  const [mounted, setMounted] = useState(false);
  const [skip, setSkip] = useState(true);

  useEffect(() => {
    setMounted(true);
    setSkip(snoozed());
  }, []);

  const due = Boolean(mounted && !skip && !installed && access && isPhysicalGroupStudent(access));
  const { open, close } = useMoment("install-offline-notes", due);

  const dismiss = () => {
    try {
      window.localStorage.setItem(SNOOZE_KEY, String(Date.now()));
    } catch {
      /* fine — it just returns next session */
    }
    close();
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-5" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-6 text-center shadow-[0_30px_80px_-20px_rgba(0,0,0,0.5)]">
        <Mascot mood="presenting" className="mx-auto h-20 w-20" />
        <h2 className="mt-3 text-lg font-bold text-[var(--foreground)]">Notes in your pocket</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Install the EasyWay app and your class notes — the ready-made ones and your own — come with you, even with
          no signal. Add it from your browser menu: <strong>“Add to Home Screen”</strong>.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={dismiss}
            className="rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
          >
            Got it
          </button>
          <button type="button" onClick={dismiss} className="text-xs font-medium text-[var(--muted)]">
            Maybe later
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
