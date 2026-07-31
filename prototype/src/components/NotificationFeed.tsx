"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
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
 * The full notification history — the page behind the bell.
 *
 * Shared by all three portals for the same reason NotificationCenter is:
 * /api/notifications answers for whoever is signed in, so there is nothing
 * role-specific left for the page to know. The student page it replaces was
 * three hardcoded fake alerts.
 */

type Notification = {
  id: string;
  title: string;
  message: string;
  kind: string;
  severity: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
  senderName: string | null;
};

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
];

function iconFor(kind: string) {
  const match = ICONS.find(([prefix]) => kind === prefix || kind.startsWith(`${prefix}.`));
  const Glyph = match?.[1] ?? BellIcon;
  return <Glyph className="h-5 w-5" />;
}

const TONES: Record<string, { chip: string; rail: string }> = {
  success: { chip: "bg-emerald-500/10 text-emerald-600", rail: "border-l-emerald-500" },
  warning: { chip: "bg-amber-500/10 text-amber-600", rail: "border-l-amber-500" },
  critical: { chip: "bg-red-500/10 text-red-600", rail: "border-l-red-500" },
  info: { chip: "bg-[var(--accent)]/10 text-[var(--accent)]", rail: "border-l-[var(--accent)]" },
};

function when(iso: string): string {
  const date = new Date(iso);
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function NotificationFeed() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/notifications?limit=100${filter === "unread" ? "&unread=true" : ""}`, {
        cache: "no-store",
      });
      if (response.ok) {
        const data = await response.json();
        setNotifications(data.notifications ?? []);
      }
    } catch {
      /* Leave whatever is on screen rather than blanking the page. */
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const unreadCount = useMemo(() => notifications.filter((n) => !n.readAt).length, [notifications]);

  async function markAllRead() {
    setNotifications((current) => current.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAllAsRead: true }),
    }).catch(() => {});
    void load();
  }

  async function markRead(id: string) {
    setNotifications((current) =>
      current.map((n) => (n.id === id ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n)),
    );
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notificationIds: [id] }),
    }).catch(() => {});
  }

  async function dismiss(id: string) {
    setNotifications((current) => current.filter((n) => n.id !== id));
    await fetch("/api/notifications", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notificationIds: [id] }),
    }).catch(() => {});
  }

  return (
    <div className="rounded-[32px] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow)] sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">Notifications</p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Alerts &amp; messages</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {unreadCount > 0 ? `${unreadCount} unread` : "You are all caught up"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-full border border-[var(--border)] p-1">
            {(["all", "unread"] as const).map((value) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold capitalize transition ${
                  filter === value ? "bg-[var(--accent)] text-white" : "text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {value}
              </button>
            ))}
          </div>

          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[var(--accent)]/20 transition hover:brightness-110"
            >
              <CheckIcon className="h-4 w-4" />
              Mark all read
            </button>
          )}
        </div>
      </div>

      <div className="mt-8 space-y-3">
        {isLoading ? (
          [0, 1, 2].map((row) => (
            <div key={row} className="h-24 animate-pulse rounded-3xl bg-[var(--surface-alt)]" />
          ))
        ) : notifications.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[var(--border)] px-6 py-16 text-center">
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-[var(--background)] text-[var(--muted)]">
              <BellIcon className="h-7 w-7" />
            </span>
            <p className="mt-4 text-base font-semibold">
              {filter === "unread" ? "Nothing unread" : "No notifications yet"}
            </p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Class updates, results and payment notices will appear here.
            </p>
          </div>
        ) : (
          notifications.map((notification, index) => {
            const tone = TONES[notification.severity] ?? TONES.info;
            const unread = !notification.readAt;

            return (
              <motion.div
                key={notification.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index * 0.03, 0.3) }}
                className={`flex gap-4 rounded-3xl border border-[var(--border)] border-l-4 ${tone.rail} bg-[var(--surface-alt)] p-5 shadow-sm transition ${
                  notification.link ? "cursor-pointer hover:shadow-md" : ""
                } ${unread ? "" : "opacity-75"}`}
                onClick={() => {
                  void markRead(notification.id);
                  if (notification.link) router.push(notification.link);
                }}
              >
                <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${tone.chip}`}>
                  {iconFor(notification.kind)}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold text-[var(--foreground)]">{notification.title}</h2>
                    {unread && (
                      <span className="rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--accent)]">
                        New
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted)]">{notification.message}</p>
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    {when(notification.createdAt)}
                    {notification.senderName ? ` · ${notification.senderName}` : ""}
                  </p>
                </div>

                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    void dismiss(notification.id);
                  }}
                  aria-label={`Dismiss ${notification.title}`}
                  className="h-8 w-8 shrink-0 self-start rounded-lg text-[var(--muted)] transition hover:bg-red-500/10 hover:text-red-500"
                >
                  <CrossIcon className="mx-auto h-4 w-4" />
                </button>
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
}
