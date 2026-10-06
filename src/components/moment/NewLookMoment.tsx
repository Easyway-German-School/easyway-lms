"use client";

import { AnimatePresence, motion } from "framer-motion";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { CrossIcon } from "@/components/icons";
import Mascot from "@/components/Mascot";
import { MOMENTS, useMoment, useMomentQueue } from "@/lib/moment-queue";
import { useLook } from "@/lib/useLook";

/**
 * BECCA, ON THE NEW LOOK — a banner, never a dialog.
 *
 * The student portal once stacked so many popups on a first visit that people
 * could not get past them to skip the welcome tour. So this one is built to be
 * incapable of that:
 *
 *   NOT A MODAL.   It is a slim banner that slides in from the top, like a
 *                  message arriving. It does not dim the page, does not trap
 *                  focus and blocks nothing — everything under it stays
 *                  tappable. In the moment queue it is a TOAST (rank 35), so it
 *                  never spends one of the two modal slots and never delays a
 *                  tour, a payment or a level-up: every modal goes first.
 *   WAITS ITS TURN. It only opens when the queue says the screen is quiet, then
 *                  waits a further beat so the page has settled — it can never
 *                  land in the same breath as anything else.
 *   YIELDS AT ONCE. If anything of higher rank claims a turn while she is up
 *                  (a tour, a payment, a level-up that arrived late), she steps
 *                  aside immediately rather than make it wait out her clock.
 *   LEAVES BY ITSELF. After ~14 seconds it slides away on its own. Hover or
 *                  touch pauses the clock; the X, a swipe up, or Escape dismiss
 *                  it at once.
 *   ONCE, EVER.    Marked as seen the moment it appears, so ignoring it, swiping
 *                  it, or closing the tab all count as an answer. And the
 *                  server never offers it to a brand-new student (they have
 *                  never known the old look and are busy with the tour) — see
 *                  promptFor in lib/youth-look.ts.
 *
 * Two messages, picked by the server: "announce" (the student is in the first
 * wave and already has the new look — say so, with the way back) and "invite"
 * (a phone-heavy 25–34 — nothing has changed; just ask).
 */

const SHOW_AFTER_MS = 2500;
const AUTO_HIDE_MS = 14000;

export default function NewLookMoment() {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const { prompt, setLook, markPromptSeen, declinePrompt } = useLook();

  // What Becca is saying is captured the first time the server asks for it and
  // held until she leaves. Marking it seen clears `prompt` locally (so nothing
  // can bring her back); if she followed `prompt` she would vanish the instant
  // she appeared.
  const [shown, setShown] = useState<"announce" | "invite" | null>(null);
  const [finished, setFinished] = useState(false);
  useEffect(() => {
    if (prompt && !shown) setShown(prompt);
  }, [prompt, shown]);

  // Never inside the live classroom, which is full-screen and has its own controls.
  const due = shown !== null && !finished && !pathname.startsWith("/live");
  const { open, close: release } = useMoment("new-look", due);

  // Anything ranked above her that is waiting for the single active slot.
  const queue = useMomentQueue();
  const higherWaiting = Boolean(queue?.deferred.some((m) => m.priority > MOMENTS["new-look"].priority));

  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const seenRef = useRef(false);

  const dismiss = () => {
    setVisible(false);
    setFinished(true);
    release();
  };

  // Never make a more important moment wait for this one. Dismissing releases
  // the slot; she simply does not come back this visit (and, if she had not
  // yet appeared, she has not been "seen" either, so she can try again next time).
  useEffect(() => {
    if (open && higherWaiting) dismiss();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dismiss only calls stable setters and `release`
  }, [open, higherWaiting]);

  // The queue has said it is our turn; give the page a beat to settle first.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  // Seen the moment she is actually on screen — not when merely queued.
  useEffect(() => {
    if (visible && !seenRef.current) {
      seenRef.current = true;
      void markPromptSeen();
    }
  }, [visible, markPromptSeen]);

  // Leaves by herself — the clock pauses while a finger or cursor is on her.
  useEffect(() => {
    if (!visible || paused) return;
    const timer = window.setTimeout(dismiss, AUTO_HIDE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dismiss only calls stable setters and `release`
  }, [visible, paused, release]);

  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [visible, release]);

  async function choose(look: "youth" | "classic") {
    setBusy(true);
    setError("");
    try {
      await setLook(look, shown ?? undefined);
      dismiss();
    } catch {
      setError("Couldn't change that just now. You can do it from your profile any time.");
      setBusy(false);
    }
  }

  if (typeof document === "undefined" || !shown) return null;
  const announce = shown === "announce";

  return createPortal(
    <AnimatePresence>
      {visible && !finished && (
        <motion.div
          key="new-look-banner"
          role="status"
          aria-live="polite"
          // The wrapper ignores pointer events so nothing around the card is ever blocked.
          className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+3.75rem)] z-[60] flex justify-center px-3"
          initial={{ y: -24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -24, opacity: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
        >
          <motion.div
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.6, bottom: 0 }}
            onDragEnd={(_, info) => {
              if (info.offset.y < -28 || info.velocity.y < -300) dismiss();
            }}
            onPointerEnter={() => setPaused(true)}
            onPointerLeave={() => setPaused(false)}
            onTouchStart={() => setPaused(true)}
            onTouchEnd={() => setPaused(false)}
            className="pointer-events-auto relative w-full max-w-md overflow-hidden rounded-[22px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_18px_50px_-12px_rgba(0,0,0,0.45)]"
          >
            <div className="flex items-start gap-3 p-3.5 pr-11">
              <span className="grid h-12 w-12 shrink-0 place-items-end overflow-hidden rounded-full bg-[var(--accent-soft)]">
                <Mascot mood="cheerful" className="h-12 w-12" />
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--accent)]">Becca</p>
                <p className="text-[15px] font-extrabold leading-snug text-[var(--foreground)]">
                  {announce ? "Fresh look, same app" : "Try our new look?"}
                </p>
                <p className="mt-0.5 text-[13px] leading-snug text-[var(--muted)]">
                  {announce
                    ? "Everything's where you left it. Come and make your own avatar."
                    : "Your own avatar and livelier class chats. Prefer things as they are? Keep them. You can switch any time from your profile."}
                </p>

                {error ? <p className="mt-1.5 text-xs font-semibold text-[var(--danger)]">{error}</p> : null}

                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  {announce ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          dismiss();
                          router.push("/profile");
                        }}
                        className="rounded-full bg-[var(--accent)] px-3.5 py-1.5 text-[13px] font-extrabold text-white transition active:scale-95"
                      >
                        Make my avatar
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => choose("classic")}
                        className="rounded-full px-2.5 py-1.5 text-xs font-semibold text-[var(--muted)] transition hover:text-[var(--foreground)] disabled:opacity-60"
                      >
                        {busy ? "Switching…" : "Switch back"}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => choose("youth")}
                        className="rounded-full bg-[var(--accent)] px-3.5 py-1.5 text-[13px] font-extrabold text-white transition active:scale-95 disabled:opacity-60"
                      >
                        {busy ? "One moment…" : "Try it"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void declinePrompt("invite");
                          dismiss();
                        }}
                        className="rounded-full px-2.5 py-1.5 text-xs font-semibold text-[var(--muted)] transition hover:text-[var(--foreground)]"
                      >
                        Keep mine
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss"
              className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full text-[var(--muted)] transition hover:bg-[var(--surface-alt)]"
            >
              <CrossIcon className="h-4 w-4" />
            </button>

            {/* Time left — shrinks, pauses with the hover, and is the honest
                answer to "is this going to sit here forever?". */}
            <motion.span
              key={paused ? "paused" : "running"}
              className="absolute inset-x-0 bottom-0 h-[3px] origin-left bg-[var(--accent)]/60"
              initial={{ scaleX: paused ? 1 : 1 }}
              animate={{ scaleX: paused ? 1 : 0 }}
              transition={{ duration: paused ? 0 : AUTO_HIDE_MS / 1000, ease: "linear" }}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
