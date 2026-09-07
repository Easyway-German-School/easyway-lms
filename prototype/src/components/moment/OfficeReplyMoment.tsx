"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Mascot from "@/components/Mascot";
import { useMoment } from "@/lib/moment-queue";

/**
 * "THE OFFICE REPLIED."
 *
 * A student who sent an enquiry — the Travel Package card on /programs, a
 * payment question, anything through the Help panel — was told to expect an
 * answer here. When it arrives it already rings the bell and dots the Help
 * button, but neither of those puts the answer in front of someone who asked
 * for it. This does: on the next portal page, the reply greets them with its
 * first lines and one button into the conversation.
 *
 * Queue-managed, so it never fights the welcome tour or a celebration, and it
 * drops to the dock if the visit's two-modal cap is already spent. Dismissing
 * it does NOT mark the reply read — the bell and the Help badge stay lit until
 * the student actually opens the thread. Keyed on the reply's timestamp, so a
 * second answer on the same ticket brings it back once.
 */

type UnreadReply = {
  ticketId: string;
  subject: string;
  topic: string;
  from: string;
  preview: string;
  image?: string | null;
  at: string;
};

const SEEN_KEY = "easyway-office-reply-seen";

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
    /* fine — it just offers to greet again next session */
  }
}

export default function OfficeReplyMoment() {
  const [reply, setReply] = useState<UnreadReply | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/support/tickets/unread-reply", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        const next: UnreadReply | null = data?.reply ?? null;
        if (next && !alreadySeen(next.ticketId, next.at)) setReply(next);
        setChecked(true);
      })
      .catch(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const due = Boolean(checked && reply);
  const { open, close } = useMoment("office-reply", due);

  if (!open || !reply || typeof document === "undefined") return null;

  const fromTutor = reply.topic === "tutor";

  const openThread = () => {
    markSeen(reply.ticketId, reply.at);
    close();
    // A full navigation, not a client-side push: the Help panel reads `?help=`
    // once when it mounts (see HelpLauncher), so a soft transition would land
    // on the dashboard with the param but the panel still shut. This is the
    // same URL the reply notification links to, and it opens the thread.
    window.location.assign(`/dashboard?help=${reply.ticketId}`);
  };

  const dismiss = () => {
    markSeen(reply.ticketId, reply.at);
    close();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-5"
      role="dialog"
      aria-modal="true"
      aria-label="A reply from the office"
    >
      <div className="w-full max-w-sm overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--surface)] text-center shadow-[0_30px_80px_-20px_rgba(0,0,0,0.5)]">
        <div className="bg-[var(--accent-soft)] px-6 pt-6">
          <Mascot mood="presenting" className="mx-auto h-20 w-20" />
        </div>
        <div className="p-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--accent)]">
            {fromTutor ? "Your tutor replied" : "The office replied"}
          </p>
          <h2 className="mt-1.5 text-lg font-bold text-[var(--foreground)]">{reply.subject}</h2>

          <div className="mt-3 rounded-2xl bg-[var(--surface-alt)] p-3.5 text-left">
            <p className="text-[11px] font-semibold text-[var(--muted)]">{reply.from}</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--foreground-soft)] line-clamp-5">
              {reply.preview}
            </p>
            {reply.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={reply.image}
                alt="Attached by the office"
                className="mt-2 max-h-32 w-auto rounded-lg border border-[var(--border)] object-cover"
              />
            ) : null}
          </div>

          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
              onClick={openThread}
              className="rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
            >
              Open the conversation
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
