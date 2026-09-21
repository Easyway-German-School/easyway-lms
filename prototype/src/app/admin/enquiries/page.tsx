"use client";

export const dynamic = "force-dynamic";

/**
 * THE HELP DESK, from the office's side.
 *
 * A queue and a conversation, built phone-first because the office answers
 * from a phone as often as from a desk.
 *
 *   phone   The queue IS the screen. Tapping a request opens the conversation
 *           full-screen, with a back arrow, a chat bubble layout and a "Type
 *           here…" bar that stays above the keyboard — the same shape as the
 *           support chat the student is looking at on their end. Back returns
 *           to the queue.
 *   desktop Both panes side by side, so a secretary can sit here for ten
 *           minutes and clear the queue without the page ever changing.
 *
 * (It used to be two boxes stacked vertically at every width, which on a phone
 * meant a short queue, then a short conversation, then a page-long scroll to
 * find the reply box — the "not built for mobile" feel.)
 *
 * Typing works both ways, like the student's panel: the office sees a student's
 * dots in the conversation and on their row in the queue, and the student sees
 * the office's. See lib/typing.ts for the model.
 *
 * The `?ticket=` parameter is what the notification links to, so the office
 * clicking a bell lands on the exact conversation, already open and marked
 * read.
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import AdminShell from "@/components/AdminShell";
import BrandLoader from "@/components/BrandLoader";
import {
  CheckCircleIcon,
  ChevronRightIcon,
  InboxIcon,
  PencilIcon,
  RefreshIcon,
  SearchIcon,
  TicketIcon,
  TrashIcon,
} from "@/components/icons";
import {
  TICKET_STATUS_LABELS,
  TICKET_TOPIC_LABELS,
  type TicketAttachment,
  type TicketStatus,
  type TicketTopic,
} from "@/lib/support-copy";
import { MessageAttachments } from "@/components/support/TicketAttachments";
import {
  ChatBubbleRow,
  ChatComposer,
  ChatHeader,
  ChatNotice,
  ChatScroller,
  ChatStamp,
  ChatTypingRow,
  SupportAvatar,
  needsStamp,
  stampLabel,
} from "@/components/support/ChatKit";
import { TypingDots } from "@/components/typing/TypingUI";
import { startPolling } from "@/lib/client/poll";
import { useTicketLive, useTicketTypingMap } from "@/lib/client/use-ticket-live";
import { useTypingSender } from "@/lib/client/use-typing-sender";
import { describeTypers } from "@/lib/typing";

type Ticket = {
  id: string;
  subject: string;
  topic: string;
  status: string;
  fromPath: string | null;
  unread: boolean;
  messageCount: number;
  askerName: string | null;
  askerEmail: string;
  studentId: string | null;
  level: string | null;
  branchName: string | null;
  assignedTo: string | null;
  lastMessageAt: string;
  createdAt: string;
};

type ThreadMessage = {
  id: string;
  body: string;
  authorRole: string;
  authorName: string | null;
  mine: boolean;
  createdAt: string;
  edited?: boolean;
  attachments?: TicketAttachment[];
};

type Thread = {
  id: string;
  subject: string;
  topic: string;
  status: string;
  fromPath: string | null;
  createdAt: string;
  asker: {
    name: string | null;
    email: string;
    studentId: string | null;
    level: string | null;
    branchName: string | null;
  } | null;
  messages: ThreadMessage[];
};

const STATUS_TONE: Record<string, string> = {
  open: "bg-amber-100 text-amber-700",
  pending: "bg-emerald-100 text-emerald-700",
  resolved: "bg-[var(--surface-alt)] text-[var(--muted)]",
};

const FILTERS: Array<{ value: string; label: string; count?: TicketStatus }> = [
  { value: "open", label: "Needs an answer", count: "open" },
  { value: "pending", label: "Waiting on student", count: "pending" },
  { value: "resolved", label: "Resolved", count: "resolved" },
  { value: "all", label: "Everything" },
];

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function firstNameOf(name: string | null | undefined, fallback: string) {
  return (name ?? "").trim().split(/\s+/)[0] || fallback;
}

function EnquiriesInner() {
  const searchParams = useSearchParams();
  const requested = searchParams.get("ticket");

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState("open");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(requested);
  const [thread, setThread] = useState<Thread | null>(null);
  const [reply, setReply] = useState("");
  const [replyFiles, setReplyFiles] = useState<TicketAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  // An office message being corrected in place. `null` when nothing is open
  // for editing; the id + working text otherwise.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ status: filter });
      if (search.trim()) params.set("q", search.trim());
      const res = await fetch(`/api/admin/enquiries?${params}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setTickets(data.tickets ?? []);
      setCounts(data.counts ?? {});
    } finally {
      setLoading(false);
    }
  }, [filter, search]);

  useEffect(() => {
    load();
  }, [load]);

  // Who is typing in which request, for the queue rows. One poll for the list.
  const typingByTicket = useTicketTypingMap(true);

  /** Pull a fresh copy of the open thread without touching the reply box or an edit in progress. */
  const refreshThread = useCallback(async (id: string) => {
    const res = await fetch(`/api/support/tickets/${id}`, { cache: "no-store" });
    if (!res.ok) return null;
    const fresh = (await res.json()) as Thread;
    setThread((current) =>
      current && current.id === fresh.id ? { ...current, status: fresh.status, messages: fresh.messages } : current,
    );
    setTickets((current) => current.map((t) => (t.id === id ? { ...t, unread: false } : t)));
    return fresh;
  }, []);

  const openThread = useCallback(async (id: string) => {
    setSelected(id);
    setThread(null);
    setReply("");
    setReplyFiles([]);
    setEditingId(null);
    // The SAME thread endpoint the student uses. It decides what to return and
    // which unread flag to clear from the caller's role — see the route.
    const res = await fetch(`/api/support/tickets/${id}`, { cache: "no-store" });
    if (!res.ok) return;
    setThread((await res.json()) as Thread);
    // The row's dot goes out immediately: the server cleared the flag on that
    // same request, and waiting for a refetch to agree makes it look sticky.
    setTickets((current) => current.map((t) => (t.id === id ? { ...t, unread: false } : t)));
  }, []);

  // Deep link from the bell. Runs once, on whatever the notification named.
  useEffect(() => {
    if (requested) void openThread(requested);
  }, [requested, openThread]);

  /**
   * The queue and its counts refresh on a slow clock (paused while the tab is
   * hidden). The OPEN conversation does not use it: it has its own 3-second
   * "anything new / who is typing" check below, so a student's message shows up
   * within seconds instead of the next queue tick.
   */
  useEffect(() => startPolling(load, { intervalMs: 15_000, immediate: false }), [load]);

  const live = useTicketLive({
    ticketId: selected,
    known: thread && thread.id === selected ? { count: thread.messages.length, status: thread.status } : null,
    onStale: () => (selected ? refreshThread(selected) : undefined),
  });

  const { onDraftChange: onTypingDraftChange, stop: stopTyping } = useTypingSender(selected, (typing) =>
    fetch("/api/support/typing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketId: selected, typing }),
      keepalive: true,
    }),
  );

  // A full-screen conversation on a phone must not let the queue behind it scroll.
  useEffect(() => {
    if (!selected || window.innerWidth >= 1024) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [selected]);

  async function act(action: "reply" | "resolve" | "reopen") {
    if (!selected) return;
    if (action === "reply" && !reply.trim() && replyFiles.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/support/tickets/${selected}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "reply" ? { body: reply, attachments: replyFiles } : { action },
        ),
      });
      if (res.ok) {
        setReply("");
        setReplyFiles([]);
        stopTyping();
        await refreshThread(selected);
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  // Save an in-place correction to an office message.
  async function saveEdit() {
    if (!selected || !editingId || !editText.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/support/tickets/${selected}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "edit", messageId: editingId, body: editText }),
      });
      if (res.ok) {
        setEditingId(null);
        setEditText("");
        await refreshThread(selected);
      }
    } finally {
      setBusy(false);
    }
  }

  // Take a message back. On the student's side it — and the popup and bell that
  // announced it — simply vanish; here the bubble goes with the next refetch.
  async function removeMessage(messageId: string) {
    if (!selected) return;
    if (!window.confirm("Delete this message? It disappears from the student's side too, as if it was never sent.")) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/support/tickets/${selected}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", messageId }),
      });
      if (res.ok) {
        if (editingId === messageId) setEditingId(null);
        await refreshThread(selected);
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  function closeConversation() {
    setSelected(null);
    setThread(null);
    setEditingId(null);
  }

  const askerName = thread?.asker?.name ?? thread?.asker?.email ?? "Student";

  return (
    <div className="space-y-4">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold text-[var(--foreground)] sm:text-3xl">Enquiries</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--muted)]">
          Every &ldquo;need help?&rdquo; a student or tutor sends from the portal lands here. Answering notifies
          them in-app and on their phone, and the whole conversation stays on the student&rsquo;s record.{" "}
          <span className="whitespace-nowrap">
            Looking for people who have not enrolled yet? That is the{" "}
            <Link href="/admin/leads" className="font-semibold text-[var(--accent)] hover:underline">
              lead funnel
            </Link>
            .
          </span>
        </p>
      </motion.div>

      <div className="lg:grid lg:grid-cols-[23rem_1fr] lg:gap-4">
        {/* ------------------------------------------------------- the queue */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] lg:h-[calc(100vh-14rem)] lg:min-h-[30rem]">
          <div className="space-y-3 border-b border-[var(--border)] p-3">
            {/* The counts live on the filters: three stat cards above the queue
                pushed it a full screen down on a phone. */}
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {FILTERS.map((option) => {
                const active = filter === option.value;
                const count = option.count ? counts[option.count] ?? 0 : null;
                return (
                  <button
                    key={option.value}
                    onClick={() => setFilter(option.value)}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition active:scale-95 ${
                      active
                        ? "bg-[var(--accent)] text-white"
                        : "bg-[var(--surface-alt)] text-[var(--muted)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    {option.label}
                    {count !== null ? (
                      <span
                        className={`rounded-full px-1.5 text-[10px] font-bold leading-4 ${
                          active ? "bg-white/25 text-white" : "bg-[var(--surface)] text-[var(--foreground-soft)]"
                        }`}
                      >
                        {count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2">
              <label className="relative min-w-0 flex-1">
                <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Name, email or subject"
                  // 16px on a phone: anything smaller makes iOS zoom the page on focus.
                  className="w-full rounded-full bg-[var(--surface-alt)] py-2.5 pl-10 pr-4 text-base text-[var(--foreground)] outline-none ring-1 ring-transparent transition placeholder:text-[var(--muted)] focus:ring-[var(--accent)] sm:text-sm"
                />
              </label>
              <button
                onClick={load}
                aria-label="Refresh"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--surface-alt)] text-[var(--muted)] transition hover:text-[var(--accent)] active:scale-95 sm:h-10 sm:w-10"
              >
                <RefreshIcon className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 lg:overflow-y-auto">
            {loading ? (
              <p className="p-6 text-center text-sm text-[var(--muted)]">Loading…</p>
            ) : tickets.length === 0 ? (
              <div className="p-10 text-center">
                <InboxIcon className="mx-auto h-8 w-8 text-[var(--muted)]" />
                <p className="mt-2 text-sm text-[var(--muted)]">
                  {filter === "open" ? "Nothing waiting on the office." : "Nothing here."}
                </p>
              </div>
            ) : (
              <ul>
                {tickets.map((ticket) => {
                  const typers = typingByTicket[ticket.id] ?? [];
                  const person = ticket.askerName ?? ticket.askerEmail;
                  return (
                    <li key={ticket.id} className="border-b border-[var(--border)] last:border-b-0">
                      <button
                        onClick={() => openThread(ticket.id)}
                        className={`flex w-full items-center gap-3 px-3 py-3 text-left transition active:bg-[var(--surface-alt)] ${
                          selected === ticket.id ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--surface-alt)]"
                        }`}
                      >
                        <SupportAvatar name={person} staff={false} size={46} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-2">
                            <span
                              className={`min-w-0 flex-1 truncate text-[15px] text-[var(--foreground)] ${
                                ticket.unread ? "font-bold" : "font-semibold"
                              }`}
                            >
                              {person}
                            </span>
                            <span className="shrink-0 text-[11px] text-[var(--muted)]">
                              {timeAgo(ticket.lastMessageAt)}
                            </span>
                          </span>
                          <span
                            className={`mt-0.5 block truncate text-sm ${
                              ticket.unread ? "font-medium text-[var(--foreground)]" : "text-[var(--muted)]"
                            }`}
                          >
                            {ticket.subject}
                          </span>
                          <span className="mt-1 flex items-center gap-1.5 overflow-hidden text-[11px]">
                            {typers.length > 0 ? (
                              <span className="flex items-center gap-1.5 font-semibold text-[var(--accent)]">
                                <TypingDots />
                                {describeTypers(typers.map((t) => t.name))}
                              </span>
                            ) : (
                              <>
                                <span
                                  className={`shrink-0 rounded-full px-2 py-0.5 font-semibold ${
                                    STATUS_TONE[ticket.status] ?? STATUS_TONE.open
                                  }`}
                                >
                                  {TICKET_STATUS_LABELS[ticket.status as TicketStatus] ?? ticket.status}
                                </span>
                                <span className="truncate text-[var(--muted)]">
                                  {TICKET_TOPIC_LABELS[ticket.topic as TicketTopic] ?? ticket.topic}
                                  {ticket.level ? ` · ${ticket.level}` : ""}
                                  {ticket.branchName ? ` · ${ticket.branchName}` : ""}
                                </span>
                              </>
                            )}
                          </span>
                        </span>
                        {ticket.unread ? (
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--accent)]" />
                        ) : (
                          <ChevronRightIcon className="h-4 w-4 shrink-0 text-[var(--muted)] lg:hidden" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* ------------------------------------------------- the conversation
            Full-screen over everything on a phone once a request is open; a
            normal pane beside the queue from `lg`. With nothing open it is
            hidden on a phone (the queue is the screen) and a placeholder on
            desktop. */}
        <div
          className={
            selected
              ? "fixed inset-0 z-[65] flex h-[100dvh] flex-col overflow-hidden bg-[var(--surface)] lg:static lg:z-auto lg:h-[calc(100vh-14rem)] lg:min-h-[30rem] lg:rounded-3xl lg:border lg:border-[var(--border)]"
              : "hidden min-h-[24rem] flex-col rounded-3xl border border-[var(--border)] bg-[var(--surface)] lg:flex lg:h-[calc(100vh-14rem)]"
          }
        >
          {!selected || !thread ? (
            selected ? (
              <>
                <ChatHeader fullScreen onBack={closeConversation} backClassName="lg:hidden" title="Opening…" />
                <div className="grid flex-1 place-items-center bg-[var(--surface-alt)]">
                  <BrandLoader size="lg" message="Opening the conversation." />
                </div>
              </>
            ) : (
              <div className="grid flex-1 place-items-center p-10 text-center">
                <div>
                  <TicketIcon className="mx-auto h-10 w-10 text-[var(--muted)]" />
                  <p className="mt-3 text-sm text-[var(--muted)]">Pick a request to read and answer it.</p>
                </div>
              </div>
            )
          ) : (
            <>
              <ChatHeader
                fullScreen
                onBack={closeConversation}
                backClassName="lg:hidden"
                title={askerName}
                subtitle={
                  <span className="truncate text-[11px] text-[var(--muted)]">
                    {[thread.asker?.level, thread.asker?.branchName].filter(Boolean).join(" · ") ||
                      TICKET_TOPIC_LABELS[thread.topic as TicketTopic] ||
                      "Student"}
                  </span>
                }
                right={
                  thread.status === "resolved" ? (
                    <button
                      onClick={() => act("reopen")}
                      disabled={busy}
                      className="rounded-full px-3 py-1.5 text-xs font-semibold text-[var(--accent)] transition hover:bg-[var(--accent-soft)] disabled:opacity-50"
                    >
                      Reopen
                    </button>
                  ) : (
                    <button
                      onClick={() => act("resolve")}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-[var(--accent)] transition hover:bg-[var(--accent-soft)] disabled:opacity-50"
                    >
                      <CheckCircleIcon className="h-4 w-4" />
                      <span className="hidden sm:inline">Mark </span>resolved
                    </button>
                  )
                }
              />

              {/* The subject and where they were standing — the single most
                  useful field on the whole ticket, captured automatically
                  because a frustrated person never includes it. */}
              <div className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2.5">
                <h2 className="text-sm font-semibold leading-5 text-[var(--foreground)]">{thread.subject}</h2>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--muted)]">
                  <span
                    className={`rounded-full px-2 py-0.5 font-semibold ${STATUS_TONE[thread.status] ?? STATUS_TONE.open}`}
                  >
                    {TICKET_STATUS_LABELS[thread.status as TicketStatus] ?? thread.status}
                  </span>
                  <span>{TICKET_TOPIC_LABELS[thread.topic as TicketTopic] ?? thread.topic}</span>
                  {thread.fromPath ? (
                    <span className="rounded-full bg-[var(--surface-alt)] px-2 py-0.5 font-medium">
                      sent from {thread.fromPath}
                    </span>
                  ) : null}
                  {thread.asker?.studentId ? (
                    <Link
                      href={`/admin/students/${thread.asker.studentId}`}
                      className="font-semibold text-[var(--accent)] hover:underline"
                    >
                      Open their file
                    </Link>
                  ) : null}
                </div>
              </div>

              <ChatScroller resetKey={thread.id} watch={`${thread.messages.length}:${live.typers.length}`}>
                <div className="space-y-3">
                  {thread.messages.map((message, index) => {
                    const previous = thread.messages[index - 1];
                    const fromOffice = message.authorRole === "admin";
                    const editing = editingId === message.id;
                    const firstOfRun = !previous || (previous.authorRole === "admin") !== fromOffice;
                    return (
                      <div key={message.id} className="space-y-3">
                        {needsStamp(previous?.createdAt, message.createdAt) ? (
                          <ChatStamp>{stampLabel(message.createdAt)}</ChatStamp>
                        ) : null}
                        <ChatBubbleRow
                          mine={fromOffice}
                          authorName={
                            fromOffice
                              ? firstNameOf(message.authorName, "The office")
                              : firstNameOf(message.authorName, "Student")
                          }
                          staff={fromOffice}
                          showAvatar={firstOfRun}
                          showName={firstOfRun}
                          edited={message.edited}
                          body={editing ? "" : message.body}
                          extras={
                            <>
                              {editing ? (
                                <div className="w-[min(85vw,26rem)] space-y-2">
                                  <textarea
                                    value={editText}
                                    onChange={(event) => setEditText(event.target.value.slice(0, 4000))}
                                    rows={4}
                                    autoFocus
                                    className="w-full resize-none rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-base text-[var(--foreground)] sm:text-sm"
                                  />
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={saveEdit}
                                      disabled={busy || !editText.trim()}
                                      className="rounded-full bg-[var(--accent)] px-4 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                                    >
                                      Save
                                    </button>
                                    <button
                                      onClick={() => {
                                        setEditingId(null);
                                        setEditText("");
                                      }}
                                      disabled={busy}
                                      className="rounded-full border border-[var(--border)] px-4 py-1.5 text-xs font-semibold text-[var(--foreground-soft)] transition hover:bg-[var(--surface-alt)]"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : null}
                              {!editing ? (
                                <MessageAttachments
                                  attachments={message.attachments}
                                  align={fromOffice ? "end" : "start"}
                                />
                              ) : null}
                            </>
                          }
                          footer={
                            // Only the office's own lines, and never while one is
                            // already open for editing. Always shown: a phone has
                            // no :hover to reveal them.
                            fromOffice && !editing ? (
                              <div className="mt-1 flex gap-3 px-1 text-[11px] font-semibold text-[var(--muted)]">
                                <button
                                  onClick={() => {
                                    setEditingId(message.id);
                                    setEditText(message.body);
                                  }}
                                  className="inline-flex items-center gap-1 hover:text-[var(--accent)]"
                                >
                                  <PencilIcon className="h-3 w-3" />
                                  Edit
                                </button>
                                <button
                                  onClick={() => removeMessage(message.id)}
                                  disabled={busy}
                                  className="inline-flex items-center gap-1 hover:text-rose-500"
                                >
                                  <TrashIcon className="h-3 w-3" />
                                  Delete
                                </button>
                              </div>
                            ) : null
                          }
                        />
                      </div>
                    );
                  })}
                  <ChatTypingRow typers={live.typers} />
                  {thread.status === "resolved" ? (
                    <ChatNotice>Resolved. A new message from the student reopens it.</ChatNotice>
                  ) : null}
                </div>
              </ChatScroller>

              <ChatComposer
                value={reply}
                onChange={(next) => {
                  setReply(next);
                  onTypingDraftChange(next);
                }}
                onSend={() => act("reply")}
                busy={busy}
                files={replyFiles}
                onFilesChange={setReplyFiles}
                placeholder="Answer them…"
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminEnquiriesPage() {
  return (
    <AdminShell>
      <Suspense fallback={<BrandLoader fill size="lg" message="Opening the help desk." />}>
        <EnquiriesInner />
      </Suspense>
    </AdminShell>
  );
}
