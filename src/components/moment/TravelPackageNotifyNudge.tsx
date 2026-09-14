"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Mascot from "@/components/Mascot";
import { useMoment } from "@/lib/moment-queue";
import { usePushNotifications } from "@/lib/use-push";
import { inviteIsDue, recordAsk, recordSnooze } from "@/components/NotificationInvite";

/**
 * "TURN ON NOTIFICATIONS SO YOUR TRAVEL PACKAGE UPDATES REACH YOU."
 *
 * A student who asked about the Travel Package from the public /programs page
 * is, almost always, someone who has not paid tuition yet and does not open
 * the portal from habit. Their next few messages from the office are the ones
 * that actually matter — which documents to send, what to pay and by when, a
 * date that will not move. An email might sit unread for a week; a phone
 * notification does not.
 *
 * So this is the one place we spend the browser's single permission prompt on
 * that group. It is raised ONLY right after the "office replied" moment for a
 * marketing-origin reply (see OfficeReplyMoment + /api/support/tickets/
 * unread-reply's `fromMarketing`), so the ask arrives as the natural next beat
 * after reading the answer, not as an ambush.
 *
 * MEMORY IS SHARED with the dashboard's generic NotificationInvite: same
 * snooze key, same four-asks cap. A student who said "don't ask again" to
 * either one is not asked by the other. `inviteIsDue` is the single gate.
 */

type UnreadReply = {
  ticketId: string;
  fromMarketing?: boolean;
  at: string;
};

const SEEN_KEY = "easyway-travel-notify-nudge-seen";

function seenMap(): Record<string, string> {
  try {
    return JSON.parse(window.sessionStorage.getItem(SEEN_KEY) || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function alreadySeen(ticketId: string, at: string): boolean {
  return seenMap()[ticketId] === at;
}

function markSeen(ticketId: string, at: string) {
  try {
    const map = seenMap();
    map[ticketId] = at;
    window.sessionStorage.setItem(SEEN_KEY, JSON.stringify(map));
  } catch {
    /* fine — offers again next session */
  }
}

export default function TravelPackageNotifyNudge() {
  const { supported, enabled, busy, permission, enable, error } = usePushNotifications();
  const [reply, setReply] = useState<UnreadReply | null>(null);
  const [checked, setChecked] = useState(false);
  const [justEnabled, setJustEnabled] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/support/tickets/unread-reply", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        const next: UnreadReply | null = data?.reply ?? null;
        if (next?.fromMarketing && !alreadySeen(next.ticketId, next.at)) setReply(next);
        setChecked(true);
      })
      .catch(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // `inviteIsDue` covers: push supported, not already on, not browser-blocked,
  // under the ask cap, past any snooze. We only add "there is a marketing
  // reply waiting".
  //
  // `|| justEnabled` latches the turn open across the moment the subscription
  // lands — otherwise `enabled` flips true, `inviteIsDue` goes false, and the
  // "you're all set" panel is torn down before it can be read. `dismissed` is
  // the only thing that ends it, set by every exit path.
  const wantsToShow = Boolean(checked && reply) && inviteIsDue(supported, enabled);
  const due = (wantsToShow || justEnabled) && !dismissed;
  const { open, close } = useMoment("notifications-travel", due);

  if (!open || !reply || typeof document === "undefined") return null;

  const accept = async () => {
    await enable();
    recordAsk();
    setJustEnabled(true);
    // If the browser prompt was blocked, `enabled` stays false and `error`
    // carries the reason — the modal shows it rather than a false success.
  };

  const dismiss = (days: number) => {
    recordSnooze(days);
    markSeen(reply.ticketId, reply.at);
    setDismissed(true);
    close();
  };

  const done = () => {
    markSeen(reply.ticketId, reply.at);
    setDismissed(true);
    close();
  };

  const enabledNow = justEnabled && enabled && permission === "granted";

  return createPortal(
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-5"
      role="dialog"
      aria-modal="true"
      aria-label="Turn on notifications for your Travel Package updates"
    >
      <div className="w-full max-w-sm overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--surface)] text-center shadow-[0_30px_80px_-20px_rgba(0,0,0,0.5)]">
        <div className="bg-[var(--accent-soft)] px-6 pt-6">
          <Mascot mood={enabledNow ? "cheerful" : "presenting"} className="mx-auto h-20 w-20" />
        </div>
        <div className="p-6">
          {enabledNow ? (
            <>
              <h2 className="text-lg font-bold text-[var(--foreground)]">You&apos;re all set</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--foreground-soft)]">
                I&apos;ll reach you on your phone the moment your Travel Package has news —
                a document to send, a payment step, or a date to keep.
              </p>
              <button
                type="button"
                onClick={done}
                className="mt-5 w-full rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
              >
                Danke!
              </button>
            </>
          ) : (
            <>
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--accent)]">
                Before you go
              </p>
              <h2 className="mt-1.5 text-lg font-bold text-[var(--foreground)]">
                Get your Travel Package updates on time
              </h2>
              <p className="mt-3 text-sm leading-6 text-[var(--foreground-soft)]">
                You asked us about the Travel Package. The updates that follow are
                time-sensitive — turn on notifications and I&apos;ll tell you the moment
                there&apos;s something you need to act on.
              </p>

              <ul className="mt-4 space-y-2 text-left text-sm">
                {[
                  "Your Travel Package update is ready",
                  "A document needs sending",
                  "A payment step or deadline is coming up",
                ].map((line) => (
                  <li key={line} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                    <span className="text-[var(--muted)]">{line}</span>
                  </li>
                ))}
              </ul>

              {error && (
                <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-left text-xs text-red-700">
                  {error}
                </p>
              )}

              <div className="mt-5 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={accept}
                  disabled={busy}
                  className="rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
                >
                  {busy ? "One moment…" : "Yes, notify me"}
                </button>
                <button
                  type="button"
                  onClick={() => dismiss(1)}
                  className="rounded-full border border-[var(--border)] px-6 py-2.5 text-sm font-semibold text-[var(--foreground)]"
                >
                  Not now
                </button>
                <button
                  type="button"
                  onClick={() => dismiss(3650)}
                  className="py-1 text-xs text-[var(--muted)] underline"
                >
                  Don&apos;t ask again
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
