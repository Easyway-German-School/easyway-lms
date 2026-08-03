"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import TuitionMascot from "@/components/TuitionMascot";
import { usePushNotifications } from "@/lib/use-push";
import { useMoment } from "@/lib/moment-queue";

/**
 * Asking a student to turn on notifications, once they have earned the right
 * to ask.
 *
 * The browser gives you exactly one permission prompt. A student who taps
 * "Block" is gone — there is no second chance, no re-prompt, and the fix
 * involves browser settings nobody will ever visit. So the real skill here is
 * NOT asking until the answer is likely to be yes.
 *
 * Which is why:
 *
 *   - the mascot asks, not a system dialog. The native prompt is a stranger
 *     demanding something. The character has already walked them through the
 *     portal, so it is somebody they have met.
 *
 *   - the reason is specific and about them: which class, which tutor, what
 *     they would miss. "Enable notifications" is a request; "hear when your
 *     tutor uploads Thursday's material" is a favour.
 *
 *   - "Not now" is offered as plainly as "Yes". Burying it produces a Block,
 *     which is permanent, instead of a Later, which is not. A soft no that
 *     preserves the ability to ask again is worth more than a hard yes rate.
 *
 *   - the native prompt only fires AFTER they say yes here. The permission
 *     dialog then arrives as the expected consequence of a decision they have
 *     already made, rather than as an interruption.
 */

/** Remembered locally: the server has no business tracking who ignored a modal. */
const SNOOZE_KEY = "ew:notif-invite:snoozed-until";
const ASK_COUNT_KEY = "ew:notif-invite:asks";

/**
 * How many times we are willing to ask, ever.
 *
 * Four. Past that it is nagging, and a student who has said "not now" four
 * times has communicated something clearer than a fifth modal will change.
 * The dock entry stays available for anybody who changes their mind.
 */
const MAX_ASKS = 4;

function snoozedUntil(): number {
  if (typeof window === "undefined") return 0;
  return Number(window.localStorage.getItem(SNOOZE_KEY) ?? 0);
}

function askCount(): number {
  if (typeof window === "undefined") return 0;
  return Number(window.localStorage.getItem(ASK_COUNT_KEY) ?? 0);
}

/** True when it is fair to raise this today. */
export function inviteIsDue(supported: boolean, enabled: boolean): boolean {
  if (typeof window === "undefined") return false;
  if (!supported || enabled) return false;
  // Already refused at the browser level — asking again shows a dialog that
  // cannot appear, so the modal would be a lie.
  if (typeof Notification !== "undefined" && Notification.permission === "denied") return false;
  if (askCount() >= MAX_ASKS) return false;
  return Date.now() >= snoozedUntil();
}

export default function NotificationInvite({
  nextClass,
  tutorName,
}: {
  /** e.g. "Thursday at 4pm" — makes the ask concrete rather than abstract. */
  nextClass?: string | null;
  tutorName?: string | null;
}) {
  const { supported, enabled, busy, enable, error } = usePushNotifications();
  const [due, setDue] = useState(false);
  const [justEnabled, setJustEnabled] = useState(false);

  // Read localStorage after mount: on the server there is no answer, and
  // guessing one would render the modal for a student who snoozed it.
  useEffect(() => {
    setDue(inviteIsDue(supported, enabled));
  }, [supported, enabled]);

  const { open, close } = useMoment("notifications", due);

  const snooze = (days: number) => {
    window.localStorage.setItem(SNOOZE_KEY, String(Date.now() + days * 24 * 60 * 60 * 1000));
    window.localStorage.setItem(ASK_COUNT_KEY, String(askCount() + 1));
    setDue(false);
    close();
  };

  const accept = async () => {
    // The native prompt fires inside here — after a deliberate tap, which is
    // the only moment a browser will honour the request anyway.
    await enable();
    window.localStorage.setItem(ASK_COUNT_KEY, String(askCount() + 1));
    setJustEnabled(true);
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[120] flex items-end justify-center bg-black/40 p-4 backdrop-blur-sm sm:items-center"
      >
        <motion.div
          initial={{ y: 40, scale: 0.96 }}
          animate={{ y: 0, scale: 1 }}
          exit={{ y: 40, opacity: 0 }}
          transition={{ type: "spring", damping: 22, stiffness: 260 }}
          className="w-full max-w-md overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl"
        >
          <div className="flex items-end gap-3 bg-gradient-to-br from-[var(--accent)]/12 to-transparent px-6 pt-6">
            <TuitionMascot pointing className="h-28 w-28 shrink-0" />
            <p className="mb-6 rounded-2xl rounded-bl-sm bg-[var(--surface)] px-4 py-3 text-sm shadow-sm">
              {justEnabled
                ? "Perfect — I'll tap you on the shoulder. Bis bald!"
                : "One thing before you go…"}
            </p>
          </div>

          <div className="px-6 pb-6">
            {justEnabled ? (
              <>
                <h2 className="text-xl font-bold">You&apos;re set</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                  You&apos;ll hear about your next class, new material from your tutor, and
                  your daily quest — even with the app closed.
                </p>
                <button
                  onClick={close}
                  className="mt-5 w-full rounded-2xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white"
                >
                  Danke!
                </button>
              </>
            ) : (
              <>
                <h2 className="text-xl font-bold">Can I remind you?</h2>

                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                  {nextClass
                    ? `Your next class is ${nextClass}. `
                    : "Your class times move around a little. "}
                  {tutorName ? `When ${tutorName} uploads` : "When your tutor uploads"} new
                  material, I can tell you — so you see it on your phone instead of finding
                  out in class.
                </p>

                {/* Three specifics beat one abstraction. A student can picture
                    each of these; "notifications" is not a thing anyone wants. */}
                <ul className="mt-4 space-y-2 text-sm">
                  {[
                    "Your class is starting in 30 minutes",
                    "New material is up for Thursday",
                    "Your streak is about to break",
                  ].map((line) => (
                    <li key={line} className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                      <span className="text-[var(--muted)]">{line}</span>
                    </li>
                  ))}
                </ul>

                {error && (
                  <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                    {error}
                  </p>
                )}

                <button
                  onClick={accept}
                  disabled={busy}
                  className="mt-5 w-full rounded-2xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {busy ? "One moment…" : "Yes, remind me"}
                </button>

                {/* Given equal weight on purpose. A buried "no" becomes a
                    browser-level Block, which is permanent; a visible one
                    becomes a snooze, which is not. */}
                <button
                  onClick={() => snooze(1)}
                  className="mt-2 w-full rounded-2xl border border-[var(--border)] px-5 py-3 text-sm font-semibold"
                >
                  Not now
                </button>

                <button
                  onClick={() => snooze(3650)}
                  className="mt-2 w-full py-1 text-xs text-[var(--muted)] underline"
                >
                  Don&apos;t ask again
                </button>
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
