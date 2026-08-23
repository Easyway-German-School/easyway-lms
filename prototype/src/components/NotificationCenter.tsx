"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertIcon,
  BellIcon,
  BookOpenIcon,
  CalendarIcon,
  CertificateIcon,
  CheckIcon,
  ClockIcon,
  CrossIcon,
  ExamIcon,
  InboxIcon,
  LecturerIcon,
  LevelUpIcon,
  PaymentIcon,
  ResultsIcon,
  UserPlusIcon,
} from "@/components/icons";

/**
 * The bell, shared by all three portals.
 *
 * It reads /api/notifications, which resolves whoever is signed in, so the
 * same component serves a student, a tutor and the office without being told
 * which it is.
 *
 * Three things it does that the previous version did not:
 *
 *   - Picks its icon from `kind`, a field on the row, instead of searching the
 *     title for the word "Payment". A retitled notification no longer loses
 *     its icon.
 *   - Raises a toast for anything that arrives while the tab is open, so an
 *     admin watching the dashboard learns about a payment without opening the
 *     panel. Critical ones also make a sound — see `chime`.
 *   - Deep-links. Every notification carries where it came from, so clicking
 *     "Payment received" opens the payment rather than the reader's memory.
 */

type Notification = {
  id: string;
  title: string;
  message: string;
  kind: string;
  severity: "info" | "success" | "warning" | "critical" | string;
  link: string | null;
  channel: string;
  status: string;
  readAt: string | null;
  createdAt: string;
  senderName: string | null;
  senderRole: string | null;
};

const POLL_MS = 20_000;

/** kind → glyph. Prefix match, so "payment.received" falls back to "payment". */
const ICONS: Array<[string, (props: { className?: string }) => React.ReactElement]> = [
  ["student.registered", UserPlusIcon],
  ["student.imported", UserPlusIcon],
  ["payment.failed", AlertIcon],
  ["gateway.error", AlertIcon],
  ["payment", PaymentIcon],
  ["tuition", ClockIcon],
  ["exam", ExamIcon],
  ["level.advance", LevelUpIcon],
  ["material", BookOpenIcon],
  ["assignment", ResultsIcon],
  ["result", ResultsIcon],
  ["class", CalendarIcon],
  ["lecturer", LecturerIcon],
  ["lead", InboxIcon],
  ["certificate", CertificateIcon],
  ["announcement", BellIcon],
];

function iconFor(kind: string) {
  const match = ICONS.find(([prefix]) => kind === prefix || kind.startsWith(`${prefix}.`));
  const Glyph = match?.[1] ?? BellIcon;
  return <Glyph className="h-5 w-5" />;
}

/**
 * Where a notification goes when nobody set a link on it.
 *
 * Every notification is tappable, so one without a destination is a dead tap —
 * and the class notices are the ones students actually chase ("is today's class
 * still on?"). Anything about a class lands on the timetable, which is the page
 * that answers the question they opened the notification to ask.
 *
 * A real `link` on the row always wins; this only fills the gap.
 */
const KIND_DESTINATIONS: Array<[string, string]> = [
  ["class", "/calendar"],
  ["attendance", "/calendar"],
  ["material", "/materials"],
  ["assignment", "/assignment"],
  ["result", "/results"],
  ["exam", "/exam-centre"],
  ["certificate", "/certificates"],
  ["payment", "/payments"],
  ["tuition", "/payments"],
  ["level.advance", "/programs"],
];

function destinationForKind(kind: string): string | null {
  const match = KIND_DESTINATIONS.find(([prefix]) => kind === prefix || kind.startsWith(`${prefix}.`));
  return match?.[1] ?? null;
}

const TONES: Record<string, { chip: string; dot: string; rail: string }> = {
  success: {
    chip: "bg-emerald-500/10 text-emerald-600",
    dot: "bg-emerald-500",
    rail: "border-l-emerald-500",
  },
  warning: {
    chip: "bg-amber-500/10 text-amber-600",
    dot: "bg-amber-500",
    rail: "border-l-amber-500",
  },
  critical: {
    chip: "bg-red-500/10 text-red-600",
    dot: "bg-red-500",
    rail: "border-l-red-500",
  },
  info: {
    chip: "bg-[var(--accent)]/10 text-[var(--accent)]",
    dot: "bg-[var(--accent)]",
    rail: "border-l-[var(--accent)]",
  },
};

const toneFor = (severity: string) => TONES[severity] ?? TONES.info;

function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Two notes, synthesised rather than shipped as an audio file so there is no
 * asset to 404 and nothing to download before the first alert can sound.
 *
 * Browsers refuse to start an AudioContext until the user has interacted with
 * the page, which is exactly right — it means a tab left open overnight cannot
 * start making noise on its own. A blocked chime is not an error, so it fails
 * silently.
 */
function chime() {
  try {
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    if (ctx.state === "suspended") {
      void ctx.resume();
    }
    const now = ctx.currentTime;
    [880, 1174.7].forEach((frequency, step) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      const at = now + step * 0.14;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.32);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.34);
    });
    window.setTimeout(() => void ctx.close().catch(() => {}), 1200);
  } catch {
    /* No audio available. The toast and the badge still landed. */
  }
}

export default function NotificationCenter({
  align = "right",
  className = "",
}: {
  /** Which edge of the button the panel hangs from. */
  align?: "left" | "right";
  className?: string;
}) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [toasts, setToasts] = useState<Notification[]>([]);

  // Ids seen on a previous poll. Seeded by the first load so opening the tab
  // does not toast the entire backlog.
  const known = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications?limit=25", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      const incoming: Notification[] = data.notifications ?? [];

      if (known.current === null) {
        known.current = new Set(incoming.map((n) => n.id));
      } else {
        const fresh = incoming.filter((n) => !known.current!.has(n.id) && !n.readAt);
        for (const n of incoming) known.current.add(n.id);

        if (fresh.length > 0) {
          setToasts((current) => [...fresh.slice(0, 3), ...current].slice(0, 3));
          if (fresh.some((n) => n.severity === "critical")) chime();
        }
      }

      setNotifications(incoming);
      setUnreadCount(data.unreadCount ?? 0);
    } catch {
      /* Offline or signed out. Keep whatever is on screen. */
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => {
      // Nothing to gain from polling a tab nobody is looking at, and it keeps
      // a backgrounded phone from burning battery on it.
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  // Toasts retire themselves.
  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = window.setTimeout(() => setToasts((current) => current.slice(0, -1)), 7000);
    return () => window.clearTimeout(timer);
  }, [toasts]);

  const markRead = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      // Optimistic: the panel should not sit still for a round trip.
      setNotifications((current) =>
        current.map((n) => (ids.includes(n.id) && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n)),
      );
      setUnreadCount((count) => Math.max(0, count - ids.length));
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationIds: ids }),
      }).catch(() => {});
      void load();
    },
    [load],
  );

  const markAllRead = useCallback(async () => {
    setNotifications((current) => current.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    setUnreadCount(0);
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAllAsRead: true }),
    }).catch(() => {});
    void load();
  }, [load]);

  const dismiss = useCallback(
    async (id: string) => {
      setNotifications((current) => current.filter((n) => n.id !== id));
      await fetch("/api/notifications", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationIds: [id] }),
      }).catch(() => {});
      void load();
    },
    [load],
  );

  const open = useCallback(
    (notification: Notification) => {
      void markRead([notification.id]);
      setToasts((current) => current.filter((t) => t.id !== notification.id));
      const destination = notification.link ?? destinationForKind(notification.kind);
      if (destination) {
        setIsOpen(false);
        router.push(destination);
      }
    },
    [markRead, router],
  );

  const grouped = useMemo(() => {
    const today: Notification[] = [];
    const earlier: Notification[] = [];
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    for (const n of notifications) {
      (new Date(n.createdAt) >= dayStart ? today : earlier).push(n);
    }
    return { today, earlier };
  }, [notifications]);

  function renderRow(notification: Notification) {
    const tone = toneFor(notification.severity);
    const unread = !notification.readAt;

    return (
      <div
        key={notification.id}
        role="button"
        tabIndex={0}
        onClick={() => open(notification)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            open(notification);
          }
        }}
        className={`flex w-full cursor-pointer gap-3 border-l-4 px-4 py-3.5 text-left transition hover:bg-[var(--background)] ${
          unread ? `${tone.rail} bg-[var(--accent)]/[0.04]` : "border-l-transparent"
        }`}
      >
        <span className={`mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tone.chip}`}>
          {iconFor(notification.kind)}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <p className={`flex-1 text-sm leading-snug ${unread ? "font-semibold text-[var(--foreground)]" : "font-medium text-[var(--muted)]"}`}>
              {notification.title}
            </p>
            {unread && <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />}
          </div>

          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[var(--muted)]">{notification.message}</p>

          <div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--muted)]">
            <span>{relativeTime(notification.createdAt)}</span>
            {notification.senderName && (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">{notification.senderName}</span>
              </>
            )}
          </div>
        </div>

        <button
          onClick={(event) => {
            event.stopPropagation();
            void dismiss(notification.id);
          }}
          aria-label={`Dismiss ${notification.title}`}
          className="-mr-1 h-7 w-7 shrink-0 rounded-lg text-[var(--muted)] transition hover:bg-red-500/10 hover:text-red-500"
        >
          <CrossIcon className="mx-auto h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <>
      <div className={`relative ${className}`}>
        <button
          onClick={() => setIsOpen((current) => !current)}
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
          aria-expanded={isOpen}
          className="relative grid h-10 w-10 place-items-center rounded-xl text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)]"
        >
          <motion.span
            animate={unreadCount > 0 && !reduceMotion ? { rotate: [0, -12, 10, -6, 0] } : {}}
            transition={{ duration: 0.7, repeat: Infinity, repeatDelay: 6 }}
            style={{ originY: 0.1 }}
          >
            <BellIcon className="h-5 w-5" />
          </motion.span>

          {unreadCount > 0 && (
            <span className="absolute right-1 top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-[var(--surface)]">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>

        <AnimatePresence>
          {isOpen && (
            <>
              <button
                aria-label="Close notifications"
                className="fixed inset-0 z-40 cursor-default"
                onClick={() => setIsOpen(false)}
              />

              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.97 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                role="dialog"
                aria-label="Notifications"
                // `top-16` alone assumes a 4rem header and no device notch/PWA
                // status-bar inset — on a phone with either, the panel could
                // render partly behind it. `max()` with `env(safe-area-inset-top)`
                // pushes it below whichever is actually taller.
                className={`fixed inset-x-3 top-[max(4rem,calc(env(safe-area-inset-top)+3.5rem))] z-50 flex max-h-[70vh] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl sm:absolute sm:inset-x-auto sm:top-[calc(100%+0.5rem)] sm:w-[400px] ${
                  align === "right" ? "sm:right-0" : "sm:left-0"
                }`}
              >
                <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
                  <div>
                    <h3 className="text-sm font-bold text-[var(--foreground)]">Notifications</h3>
                    <p className="text-[11px] text-[var(--muted)]">
                      {unreadCount > 0 ? `${unreadCount} unread` : "You are all caught up"}
                    </p>
                  </div>
                  {unreadCount > 0 && (
                    <button
                      onClick={markAllRead}
                      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--accent)] transition hover:bg-[var(--accent)]/10"
                    >
                      <CheckIcon className="h-3.5 w-3.5" />
                      Mark all read
                    </button>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto overscroll-contain">
                  {isLoading ? (
                    <div className="space-y-3 p-4">
                      {[0, 1, 2].map((row) => (
                        <div key={row} className="flex animate-pulse gap-3">
                          <div className="h-10 w-10 rounded-xl bg-[var(--border)]" />
                          <div className="flex-1 space-y-2 py-1">
                            <div className="h-3 w-2/3 rounded bg-[var(--border)]" />
                            <div className="h-3 w-full rounded bg-[var(--border)]" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : notifications.length === 0 ? (
                    <div className="px-6 py-12 text-center">
                      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--background)] text-[var(--muted)]">
                        <BellIcon className="h-6 w-6" />
                      </span>
                      <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">Nothing yet</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        Class updates, results and payment notices land here.
                      </p>
                    </div>
                  ) : (
                    <>
                      {grouped.today.length > 0 && (
                        <>
                          <p className="sticky top-0 z-10 bg-[var(--surface)]/95 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)] backdrop-blur">
                            Today
                          </p>
                          {grouped.today.map(renderRow)}
                        </>
                      )}
                      {grouped.earlier.length > 0 && (
                        <>
                          <p className="sticky top-0 z-10 bg-[var(--surface)]/95 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)] backdrop-blur">
                            Earlier
                          </p>
                          {grouped.earlier.map(renderRow)}
                        </>
                      )}
                    </>
                  )}
                </div>

                <div className="border-t border-[var(--border)] px-4 py-2.5 text-center">
                  <button
                    onClick={() => {
                      setIsOpen(false);
                      router.push("/notifications");
                    }}
                    className="text-xs font-semibold text-[var(--accent)] hover:underline"
                  >
                    See all notifications
                  </button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      {/*
        Toasts. Fixed to the viewport, so they are not clipped by the shell.

        They RISE IN FROM BELOW THE FOLD rather than sliding in from the side:
        the toast starts fully out of frame (`y: 120`, past its own height) and
        travels up into place. On a phone that is the bottom of the screen,
        which is where the thumb already is and where every messaging app the
        students use puts the same thing — and it means a notification never
        lands over the header, the bell, or whatever they were reading.
      */}
      {/* `env(safe-area-inset-bottom)` keeps this clear of a phone's home-indicator strip. */}
      <div className="pointer-events-none fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[120] flex flex-col gap-2 sm:inset-x-auto sm:right-4 sm:w-[22rem]">
        <AnimatePresence initial={false}>
          {toasts.map((toast) => {
            const tone = toneFor(toast.severity);
            return (
              <motion.button
                key={toast.id}
                layout
                initial={{ opacity: 0, y: 120, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 120, scale: 0.96 }}
                transition={{ type: "spring", stiffness: 320, damping: 32 }}
                onClick={() => open(toast)}
                className={`pointer-events-auto flex w-full gap-3 rounded-2xl border border-[var(--border)] border-l-4 ${tone.rail} bg-[var(--surface)] p-3.5 text-left shadow-2xl`}
              >
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${tone.chip}`}>
                  {iconFor(toast.kind)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[var(--foreground)]">{toast.title}</span>
                  <span className="mt-0.5 line-clamp-2 block text-xs text-[var(--muted)]">{toast.message}</span>
                </span>
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>
    </>
  );
}
