"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Mascot from "@/components/Mascot";
import { useMoment } from "@/lib/moment-queue";

/**
 * "YOU CAN @ TAG THINGS NOW." A toast, shown once ever, the first time
 * either a student or a tutor opens Community after this shipped.
 *
 * Plain localStorage rather than a server flag: this is a one-line feature
 * announcement, not news tied to this person's account state (nothing the
 * office needs to know whether they saw) — so there is no reason to spend a
 * notification row or an API round trip on it. Scoped to this browser, which
 * means a student on a new device sees it again once; that is a fine trade
 * for not needing a migration.
 */

const SEEN_KEY = "community-mentions-seen";

export default function CommunityMentionsMoment() {
  const [seen, setSeen] = useState(true);

  useEffect(() => {
    setSeen(Boolean(window.localStorage.getItem(SEEN_KEY)));
  }, []);

  const due = !seen;
  const { open, close } = useMoment("community-mentions", due);

  const dismiss = () => {
    window.localStorage.setItem(SEEN_KEY, "1");
    setSeen(true);
    close();
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+3.75rem)] z-[60] flex justify-center px-3"
    >
      <div className="pointer-events-auto relative w-full max-w-md overflow-hidden rounded-[22px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_18px_50px_-12px_rgba(0,0,0,0.45)]">
        <div className="flex items-start gap-3 p-3.5 pr-10">
          <span className="grid h-12 w-12 shrink-0 place-items-end overflow-hidden rounded-full bg-[var(--accent-soft)]">
            <Mascot mood="presenting" className="h-12 w-12" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--accent)]">Becca</p>
            <p className="text-[15px] font-extrabold leading-snug text-[var(--foreground)]">
              Type @ to tag something in chat
            </p>
            <p className="mt-0.5 text-[13px] leading-snug text-[var(--muted)]">
              @ a classmate or your tutor, or tag an assignment, a material or a video — it opens straight to the
              right page when someone taps it. New assignments now post a card here automatically too.
            </p>
            <div className="mt-2.5">
              <button
                type="button"
                onClick={dismiss}
                className="rounded-full bg-[var(--accent)] px-3.5 py-1.5 text-[13px] font-extrabold text-white transition active:scale-95"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
