"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { COMMUNITY_PANEL_EVENT, useTypingFeed } from "@/lib/client/typing-feed";
import { describeTypersShort } from "@/lib/typing";
import { TypingAvatars, TypingDots } from "@/components/typing/TypingUI";
import { CrossIcon } from "@/components/icons";

/**
 * "ANNA IS TYPING IN GENERAL" — FROM ANY PAGE.
 *
 * The point of a class chat is that it is alive, and the strongest signal of
 * "alive" is somebody visibly mid-sentence. A message that already arrived is
 * the past; dots are a promise about the next ten seconds, and a promise you can
 * tap is the reason people open the app to check. So when anyone in the viewer's
 * class group starts typing, a small pill floats up wherever they are in the
 * portal — an exercise, the timetable, a payment page — and tapping it lands in
 * that room.
 *
 * Mounted in the student and tutor shells only. The office is not pinged (the
 * server answers `enabled: false` and the shared feed stops polling), and it is
 * deliberately not a browser notification or a push: a typing state lasts seven
 * seconds, which is far too short for a lock-screen alert to be anything but
 * noise.
 *
 * Kept out of the way on purpose:
 *   - hidden on /community itself and while the inline chat panel is open — the
 *     room already shows the dots, and two of them would be redundant;
 *   - at most two rooms at once (a hybrid student has two cohorts);
 *   - the ✕ hides that room until a DIFFERENT set of people is typing, so
 *     someone who keeps typing for a minute cannot pin a pill over the page.
 */

const MAX_PILLS = 2;

export default function TypingNudge() {
  const router = useRouter();
  const pathname = usePathname();
  const onCommunity = pathname === "/community" || pathname?.startsWith("/community/");

  // The inline chat panel (CommunityLauncher) announces when it is open.
  const [panelOpen, setPanelOpen] = useState(false);
  useEffect(() => {
    const onPanel = (event: Event) => setPanelOpen(Boolean((event as CustomEvent<{ open?: boolean }>).detail?.open));
    window.addEventListener(COMMUNITY_PANEL_EVENT, onPanel);
    return () => window.removeEventListener(COMMUNITY_PANEL_EVENT, onPanel);
  }, []);

  const feed = useTypingFeed();
  /** channelId → the typer set it was dismissed for. */
  const [dismissed, setDismissed] = useState<Record<string, string>>({});

  if (!feed.enabled || onCommunity || panelOpen) return null;

  const signatureOf = (typers: { id: string }[]) => typers.map((t) => t.id).join(",");
  const rooms = feed.rooms.filter((room) => dismissed[room.channelId] !== signatureOf(room.typers)).slice(0, MAX_PILLS);

  return (
    <div className="pointer-events-none fixed bottom-24 left-3 z-[55] flex max-w-[calc(100vw-6.5rem)] flex-col items-start gap-2 sm:bottom-6 sm:left-1/2 sm:max-w-md sm:-translate-x-1/2 sm:items-center">
      <AnimatePresence initial={false}>
        {rooms.map((room) => (
          <motion.div
            key={room.channelId}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.92 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
            className="pointer-events-auto flex max-w-full items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] py-1.5 pl-2 pr-1.5 shadow-[0_10px_30px_rgba(15,23,42,0.18)]"
          >
            <button
              type="button"
              onClick={() => router.push(`/community?channel=${room.channelId}`)}
              className="flex min-w-0 items-center gap-2.5 text-left"
              aria-label={`${describeTypersShort(room.typers.map((t) => t.name))} in ${room.channelName}. Open the chat.`}
            >
              <TypingAvatars typers={room.typers} size={28} />
              <span className="min-w-0 pr-1">
                <span className="block truncate text-xs font-semibold text-[var(--foreground)]">
                  {describeTypersShort(room.typers.map((t) => t.name))}
                </span>
                <span className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
                  <span className="truncate">in {room.channelName}</span>
                  <TypingDots className="text-[var(--accent)]" />
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setDismissed((current) => ({ ...current, [room.channelId]: signatureOf(room.typers) }))}
              aria-label="Hide"
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[var(--muted)] transition hover:bg-[var(--surface-alt)] hover:text-[var(--foreground)]"
            >
              <CrossIcon className="h-3 w-3" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
