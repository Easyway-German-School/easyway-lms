"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { CommunityIcon } from "@/components/icons";

/**
 * MESSAGES THAT REACH YOU WHEREVER YOU ARE IN THE PORTAL.
 *
 * The problem this solves is narrow and was fatal to the community: a message
 * only existed if you were already looking at the page it arrived on. A tutor
 * could post to the class group and a student doing an exercise two screens
 * away would find out about it the next time they happened to open Community,
 * which for most students means never. A group chat nobody notices is a group
 * chat nobody uses.
 *
 * So this mounts once per portal shell and stays mounted for the whole session.
 *
 * THE ONE RULE THAT MAKES IT USEFUL: the popup carries the actual message. Not
 * "New message in General" — the words somebody typed, and who typed them. A
 * notification that only tells you a notification happened costs the reader a
 * navigation to find out whether it mattered, and after the third time they
 * stop paying it.
 *
 * Deliberately NOT a browser notification. Those need a permission prompt that
 * most people decline on first sight, and this has to work on the first day
 * without asking for anything. Web push handles the phone when the portal is
 * closed; this handles the portal being open.
 */

type Update = {
  id: string;
  source: "chat" | "notification";
  title: string;
  body: string;
  link: string | null;
  at: string;
  severity: string;
  author: { name: string } | null;
};

/** How often we ask. Matched to the chat poll so the two feel like one thing. */
const POLL_ACTIVE_MS = 8_000;
/** Backed right off when nobody is looking. */
const POLL_HIDDEN_MS = 45_000;
/** How long a card sits there before it leaves on its own. */
const DISMISS_AFTER_MS = 7_000;
/**
 * Three at once, maximum.
 *
 * A busy morning in a class of forty can produce a dozen messages in a minute,
 * and a stack of twelve cards is not a notification — it is a wall the student
 * has to fight past to use the page they were on.
 */
const MAX_VISIBLE = 3;

const TONE: Record<string, string> = {
  info: "border-[var(--border)]",
  success: "border-emerald-400/50",
  warning: "border-amber-400/60",
  critical: "border-rose-400/60",
};

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export default function PortalUpdates() {
  const router = useRouter();
  const [visible, setVisible] = useState<Update[]>([]);

  /**
   * The server's clock, not ours.
   *
   * Every response carries `now`, and we send it straight back as `since`. A
   * phone whose clock is an hour fast would otherwise ask for messages from the
   * future and receive nothing, forever, with no symptom to debug — which is
   * exactly the class of bug that took out the live classroom's tokens once
   * already.
   */
  const sinceRef = useRef<string | null>(null);
  /** Ids already shown, so a re-poll overlapping a boundary cannot repeat one. */
  const seenRef = useRef<Set<string>>(new Set());

  const dismiss = useCallback((id: string) => {
    setVisible((current) => current.filter((update) => update.id !== id));
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function tick() {
      if (cancelled) return;
      try {
        const query = sinceRef.current ? `?since=${encodeURIComponent(sinceRef.current)}` : "";
        const res = await fetch(`/api/portal/updates${query}`, { cache: "no-store" });
        const data = await res.json();

        if (!cancelled && res.ok) {
          if (data.now) sinceRef.current = data.now;

          const fresh: Update[] = (data.updates ?? []).filter((update: Update) => !seenRef.current.has(update.id));
          if (fresh.length) {
            for (const update of fresh) seenRef.current.add(update.id);
            // Oldest first, so the newest ends up nearest the reader's thumb.
            setVisible((current) => [...current, ...fresh.reverse()].slice(-MAX_VISIBLE));
          }

          /**
           * Keep the seen-set from growing for the life of the session. It only
           * has to cover the overlap between two polls, so a few hundred is
           * generous; a term of messages would not be.
           */
          if (seenRef.current.size > 400) {
            seenRef.current = new Set([...seenRef.current].slice(-100));
          }
        }
      } catch {
        // Offline, or a cold start. The next tick is seconds away.
      } finally {
        if (!cancelled) {
          timer = window.setTimeout(
            tick,
            document.visibilityState === "visible" ? POLL_ACTIVE_MS : POLL_HIDDEN_MS,
          );
        }
      }
    }

    // The first call establishes the cursor and shows nothing, which is what
    // stops a page load replaying the last hour at somebody.
    void tick();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  // Each card retires itself. Kept off the poll so a card's life does not
  // depend on when the next request happens to land.
  useEffect(() => {
    if (visible.length === 0) return;
    const timer = window.setTimeout(() => setVisible((current) => current.slice(1)), DISMISS_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [visible]);

  const open = useCallback(
    (update: Update) => {
      dismiss(update.id);
      if (update.link) router.push(update.link);
    },
    [dismiss, router],
  );

  return (
    /**
     * Bottom-right on a desktop, and across the bottom on a phone — above the
     * thumb rather than under the notch. `pointer-events-none` on the stack with
     * `auto` on each card is what stops an empty container swallowing clicks on
     * whatever page is underneath.
     */
    <div className="pointer-events-none fixed inset-x-3 bottom-3 z-[60] flex flex-col gap-2 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-96">
      <AnimatePresence initial={false}>
        {visible.map((update) => (
          <motion.button
            key={update.id}
            layout
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.96 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            onClick={() => open(update)}
            className={`pointer-events-auto flex w-full items-start gap-3 rounded-2xl border bg-[var(--surface)] p-3 text-left shadow-xl backdrop-blur transition hover:brightness-105 ${
              TONE[update.severity] ?? TONE.info
            }`}
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[11px] font-bold text-[var(--accent)]">
              {update.author ? (
                initials(update.author.name)
              ) : (
                <CommunityIcon className="h-4 w-4" />
              )}
            </span>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold text-[var(--foreground)]">{update.title}</span>
              {/*
                Two lines of the real message. One is too few to tell whether a
                question is for you; three starts to be the message itself, at
                which point the popup is competing with the page behind it.
              */}
              <span className="mt-0.5 line-clamp-2 block text-sm leading-5 text-[var(--muted)]">{update.body}</span>
            </span>

            <span
              role="button"
              tabIndex={-1}
              aria-label="Dismiss"
              onClick={(event) => {
                event.stopPropagation();
                dismiss(update.id);
              }}
              className="shrink-0 rounded-lg px-1.5 py-0.5 text-xs text-[var(--muted)] transition hover:bg-[var(--surface-alt)] hover:text-[var(--foreground)]"
            >
              ✕
            </span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
